// trialFlow.mjs — 에이전트 시험의 정식 공정 흐름(10/28 미르: 「에이전트 시험 탭은 혼자 전체 흐름을 보려고 만든 것 — 이야기 컷이 끝나면 공간·에셋, 그다음 퍼즐로」)
//   01 설화와 기획(승인) → 02 이야기 컷(컷 모두 승인·반려) → 03 공간·에셋(06~09 결과 보고 승인) → 04 퍼즐 연결(퍼즐마다 승인 → 끝)
//   GET  /__review/trial-flow/<id>                 각 공정 상태(좌측 메뉴 · 승인 칸)
//   POST /__review/trial-flow/<id>/space/approve   공간·에셋 승인 { reviewer, note }
//   서버가 요청마다 이 파일을 새로 읽는다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const mod = async (root, rel) => import(pathToFileURL(path.join(root, rel)).href + `?t=${Date.now()}`);
const tdir = (root, id) => path.join(root, '.local/review/trials', id);
const readJ = async f => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return null; } };
const live = (t, sid) => t.steps?.[sid]?.status === 'running' && Date.now() - Date.parse(t.updatedAt || 0) < 180e3;
const doneish = (t, sid) => { const x = t.steps?.[sid]; return x?.status === 'done' || (x?.status === 'running' && Boolean(x.result) && !live(t, sid)); };
const stOf = (t, sid) => doneish(t, sid) ? 'done' : live(t, sid) ? 'running' : (t.steps?.[sid]?.status === 'running' ? 'failed' : t.steps?.[sid]?.status || 'idle');

export async function status(root, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) fail(400, '시험 id 가 잘못됐습니다.');
  const T = await mod(root, 'tools/review/agentTrial.mjs'); const TB = await mod(root, 'tools/review/trialBrief.mjs');
  const t = await T.readTrial(root, id); const L = T.stepsFor(t);
  const i4 = L.findIndex(s => s.id === 's04'); const di = L.findIndex(s => s.director);
  const row = s => ({ id: s.id, label: s.label, status: stOf(t, s.id), error: t.steps?.[s.id]?.error || null });
  // 01
  const brief = await TB.get(root, id, { auto: false }).catch(() => null);
  const items = brief?.brief?.items || [];
  const story = { docs: L.slice(0, i4 + 1).map(row), cards: { total: items.length, ok: items.filter(i => i.decision === 'ok').length, issue: items.filter(i => i.decision === 'issue').length, pending: items.filter(i => !i.decision).length }, approval: brief?.approval || null, done: Boolean(brief?.approval?.valid) };
  // 02
  const chain = di >= 0 ? L.slice(i4 + 1, di + 1).map(row) : [];
  const hasCine = Boolean(await readJ(path.join(tdir(root, id), 'cinematics.json')));
  const pending = hasCine ? await T.cinePending(root, id) : null;
  // 09(시각 자기 검수)는 퍼즐을 고칠 때 05·05b 를 안에서 다시 돌린다(by: s09) — 그동안은 02 가 끝난 것으로 보고, 바뀐 컷이 생기면 pending 으로 다시 막힌다
  const by09 = sid => t.steps?.[sid]?.by === 's09';
  const cine = { steps: chain.map(r => by09(r.id) && r.status === 'running' ? { ...r, label: `${r.label} (09 가 고치며 다시 돌림)` } : r), has: hasCine, pending, done: story.done && hasCine && pending === 0 && chain.every(r => r.status === 'done' || by09(r.id)) };
  // 03
  const spaceSteps = di >= 0 ? L.slice(di + 1).map(row) : [];
  const build = t.spaceKind === 'indoor' ? await readJ(path.join(tdir(root, id), 'indoor_build.json')) : null;
  const sa = t.spaceApproval || null;
  const space = { steps: spaceSteps, built: Boolean(build), buildAt: build?.at || null, regressRed: (build?.regress || []).filter(x => !x.ok && !x.warn).map(x => x.id), approval: sa ? { ...sa, valid: Boolean(build) && sa.buildAt === build.at } : null };
  space.done = cine.done && Boolean(space.approval?.valid);
  // 04
  const list = build?.puzzle?.list || []; const pr = await readJ(path.join(tdir(root, id), 'puzzle_review.json'));
  const rev = pr?.reviews || {};
  const puzzle = { total: list.length, approved: list.filter(p => rev[p.id]?.verdict === 'approve').length, revise: list.filter(p => rev[p.id]?.verdict === 'revise').length, solvable: build?.puzzle?.solvable ?? null };
  puzzle.pending = puzzle.total - puzzle.approved - puzzle.revise;
  puzzle.done = space.done && puzzle.total > 0 && puzzle.approved === puzzle.total;
  return { id, title: t.title, spaceKind: t.spaceKind || 'outdoor', story, cine, space, puzzle };
}

export async function approveSpace(root, id, input = {}) {
  const reviewer = String(input.reviewer || '').trim().slice(0, 100); if (!reviewer) fail(422, '검수자 이름을 적어 주세요.');
  const s = await status(root, id);
  if (!s.cine.done) fail(409, '이야기 컷 검수가 끝나지 않았습니다(설화·기획 승인 · 컷 승인·반려가 먼저).');
  const notDone = s.space.steps.filter(r => r.status === 'running' || (r.status !== 'done' && r.id !== 's09')); // 09 는 실패해도 승인 가능(사람이 대신 봄), 도는 중이면 기다림
  if (notDone.length) fail(409, `공간 단계가 아직 끝나지 않았습니다(${notDone.map(r => r.id.slice(1)).join('·')}).`);
  if (!s.space.built) fail(409, '방 세트(08 결과)가 없습니다.');
  const f = path.join(tdir(root, id), 'trial.json'); const t = JSON.parse(await fs.readFile(f, 'utf8'));
  t.spaceApproval = { by: reviewer, at: new Date().toISOString(), note: String(input.note || '').slice(0, 2000), buildAt: s.space.buildAt, regressRed: s.space.regressRed };
  t.updatedAt = new Date().toISOString();
  await fs.writeFile(f, JSON.stringify(t, null, 2));
  return status(root, id);
}

export async function handle(root, method, urlPath, input) {
  const m = urlPath.match(/^\/__review\/trial-flow\/([a-f0-9-]{36})(?:\/(space\/approve))?$/); if (!m) fail(404, '경로를 찾을 수 없습니다.');
  const [, id, act] = m;
  if (method === 'GET' && !act) return [200, await status(root, id)];
  if (method === 'POST' && act === 'space/approve') return [200, await approveSpace(root, id, input || {})];
  fail(405, '지원하지 않는 요청입니다.');
}
