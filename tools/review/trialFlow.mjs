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
  { const rv = (await readJ(path.join(tdir(root, id), 'space_review.json')))?.items || {}; const vals = Object.values(rv);
    space.judged = vals.length; space.unapplied = Object.values(rv).filter(v => ['swap', 'adjust', 'remove', 'replan'].includes(v.verdict) && v.at > (build?.at || '')).length; space.regenerate = vals.filter(v => v.verdict === 'regenerate').length; }
  space.done = cine.done && Boolean(space.approval?.valid);
  // 04
  const list = build?.puzzle?.list || []; const pr = await readJ(path.join(tdir(root, id), 'puzzle_review.json'));
  const rev = pr?.reviews || {};
  const puzzle = { total: list.length, approved: list.filter(p => rev[p.id]?.verdict === 'approve').length, revise: list.filter(p => rev[p.id]?.verdict === 'revise').length, solvable: build?.puzzle?.solvable ?? null };
  puzzle.pending = puzzle.total - puzzle.approved - puzzle.revise;
  puzzle.done = space.done && puzzle.total > 0 && puzzle.approved === puzzle.total;
  return { id, title: t.title, spaceKind: t.spaceKind || 'outdoor', story, cine, space, puzzle };
}

// ── 03 공간·에셋 사람 판정(10/28 미르: 「실제 공간 안을 다니며 에셋을 고르고·고치고·반려」) ──
//   space_review.json { items: { <item_id>: { verdict, note, pick, adjust, reviewer, at, name, room } }, history: [] }
//   반영: 빼기 · 다른 에셋 · 그대로 고정 · 위치·크기 → 08(코드, 비용 0) / 수정 요청(메모) → 07 그 항목만 다시 고르기(Claude) → 08
export const SPACE_VERDICTS = { approve: '좋음(그대로 고정)', swap: '다른 에셋으로', adjust: '위치·크기 조정', remove: '빼기', replan: '수정 요청(에이전트가 다시 고름)', regenerate: '새로 만들기 요청' };
const NEEDS_BUILD = ['swap', 'adjust', 'remove', 'replan'];
const reviewF = (root, id) => path.join(tdir(root, id), 'space_review.json');
async function readReview(root, id) { return (await readJ(reviewF(root, id))) || { items: {}, history: [] }; }

export async function spaceReview(root, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) fail(400, '시험 id 가 잘못됐습니다.');
  const D = tdir(root, id);
  const plan = await readJ(path.join(D, 'indoor_plan.json')); const sel = await readJ(path.join(D, 'indoor_selection.json'));
  const build = await readJ(path.join(D, 'indoor_build.json')); const vd = await readJ(path.join(D, 'rooms/viewer_data.json'));
  const rv = await readReview(root, id);
  if (!plan || !sel || !build) return { ready: false, items: [], review: rv.items, verdicts: SPACE_VERDICTS };
  const L = await mod(root, 'tools/review/library.mjs'); const { items: lib } = await L.buildLibrary(root); const byId = new Map(lib.map(x => [x.id, x]));
  const thumb = aid => byId.get(aid)?.thumbnail || null;
  const roomName = new Map((plan.rooms || []).map(r => [r.id, r.name || r.role]));
  const placed = new Map(); (vd?.ITEMS || []).forEach((it, i) => (it.meta?.log || []).forEach(l => { if (l.id && String(l.result || '').startsWith('놓음')) placed.set(l.id, { roomIdx: i, roomName: it.name, node: l.name, where: l.where }); }));
  const selBy = new Map(sel.selections.map(x => [x.item_id, x]));
  const items = (plan.contents || []).map(c => { const x = selBy.get(c.item_id); const pl = placed.get(c.item_id);
    return { item_id: c.item_id, name: c.name_ko, room: c.room, roomName: pl?.roomName || roomName.get(c.room) || c.room, role: c.role, host: (c.serves || []).length > 0, place: c.place, kind: x ? 'asset' : c.place === 'marker' || c.role === 'marker' ? 'marker' : c.fixture ? 'fixture' : 'other',
      placed: Boolean(pl), node: pl?.node || null, roomIdx: pl?.roomIdx ?? null,
      pick: x?.pick ? { id: x.pick.id, nameKo: x.pick.nameKo, thumbnail: x.pick.thumbnail || thumb(x.pick.id), needsReplacement: x.pick.needsReplacement } : null,
      candidates: (x?.candidates || []).map(cd => ({ ...cd, thumbnail: thumb(cd.id) })), reason: x?.reason || '', missing: x?.missing || null };
  });
  const unapplied = Object.entries(rv.items).filter(([, v]) => NEEDS_BUILD.includes(v.verdict) && v.at > (build.at || '')).map(([k]) => k);
  return { ready: true, buildAt: build.at, items, review: rv.items, unapplied, verdicts: SPACE_VERDICTS, history: (rv.history || []).slice(-30).reverse() };
}

export async function setSpaceItem(root, id, input = {}) {
  const reviewer = String(input.reviewer || '').trim().slice(0, 100); if (!reviewer) fail(422, '검수자 이름을 적어 주세요.');
  const itemId = String(input.item_id || ''); if (!/^[\w.-]{1,40}$/.test(itemId)) fail(400, '항목 ID 형식이 아닙니다.');
  const D = tdir(root, id); const plan = await readJ(path.join(D, 'indoor_plan.json')); const sel = await readJ(path.join(D, 'indoor_selection.json'));
  const c = (plan?.contents || []).find(x => x.item_id === itemId) || fail(404, '이 공간에 없는 항목입니다.');
  const verdict = input.verdict ?? null; if (verdict !== null && !SPACE_VERDICTS[verdict]) fail(400, '판정 값이 잘못됐습니다.');
  const note = String(input.note || '').slice(0, 1000);
  const rv = await readReview(root, id);
  if (verdict === null) { delete rv.items[itemId]; rv.history.push({ item_id: itemId, verdict: null, reviewer, at: new Date().toISOString() }); }
  else {
    const e = { verdict, note, reviewer, at: new Date().toISOString(), name: c.name_ko, room: c.room };
    const cur = sel?.selections?.find(x => x.item_id === itemId)?.pick || null;
    if (verdict === 'remove' && (c.serves || []).length) fail(409, '퍼즐 단서가 나오는 물건이라 뺄 수 없습니다 — 「다른 에셋으로」 또는 「수정 요청」을 쓰세요.');
    if (['replan', 'regenerate'].includes(verdict) && !note.trim()) fail(422, '어떻게 고칠지 메모를 적어 주세요(에이전트가 그대로 따릅니다).');
    if (verdict === 'approve') { if (!cur) fail(409, '고른 에셋이 없는 항목입니다.'); e.pick = cur; }
    if (verdict === 'swap') {
      const L = await mod(root, 'tools/review/library.mjs'); const { items: lib } = await L.buildLibrary(root);
      const a = lib.find(x => x.id === input.assetId) || fail(404, '라이브러리에 없는 에셋입니다.');
      e.pick = { id: a.id, nameKo: a.nameKo, url: a.url, source: a.source, thumbnail: a.thumbnail || null, boundsM: a.boundsM || null, needsReplacement: Boolean(a.needsReplacement) };
    }
    if (verdict === 'adjust') {
      const a = input.adjust || {}; const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
      e.adjust = { dx: num(a.dx, -4, 4, 0), dz: num(a.dz, -4, 4, 0), rot: num(a.rot, -180, 180, 0), scale: num(a.scale, 0.5, 2, 1) };
      if (!e.adjust.dx && !e.adjust.dz && !e.adjust.rot && e.adjust.scale === 1) fail(422, '바꾼 값이 없습니다.');
    }
    rv.items[itemId] = e; rv.history.push({ item_id: itemId, ...e });
  }
  if (rv.history.length > 2000) rv.history = rv.history.slice(-2000);
  await fs.writeFile(reviewF(root, id), JSON.stringify(rv, null, 2));
  return spaceReview(root, id);
}

/** 사람 판정을 공간에 반영 — 수정 요청이 있으면 07(그 항목만) → 08, 없으면 08 만(코드, 비용 0) */
export async function applySpace(root, id) {
  const s = await status(root, id); if (!s.cine.done) fail(409, '이야기 컷 검수가 먼저 끝나야 합니다.');
  if (s.space.steps.some(r => r.status === 'running')) fail(409, '공간 단계가 도는 중입니다.');
  const r = await spaceReview(root, id); if (!r.unapplied.length) fail(409, '반영할 판정이 없습니다.');
  const memo = Object.fromEntries(r.unapplied.filter(k => r.review[k].verdict === 'replan').map(k => [k, { note: r.review[k].note }]));
  const steps = [];
  if (Object.keys(memo).length) { await fs.writeFile(path.join(tdir(root, id), 'space_rework.json'), JSON.stringify({ items: memo, at: new Date().toISOString() }, null, 2)); steps.push('s07'); }
  steps.push('s08');
  const { spawn } = await import('node:child_process'); const { openSync } = await import('node:fs');
  const log = openSync(path.join(tdir(root, id), 'run-chain.log'), 'a');
  const ch = spawn(process.execPath, [path.join(root, 'tools/review/runChain.mjs'), root, id, '--force', ...steps], { detached: true, stdio: ['ignore', log, log] }); ch.unref();
  return { started: steps, memo: Object.keys(memo).length };
}

export async function approveSpace(root, id, input = {}) {
  const reviewer = String(input.reviewer || '').trim().slice(0, 100); if (!reviewer) fail(422, '검수자 이름을 적어 주세요.');
  const s = await status(root, id);
  if (!s.cine.done) fail(409, '이야기 컷 검수가 끝나지 않았습니다(설화·기획 승인 · 컷 승인·반려가 먼저).');
  const notDone = s.space.steps.filter(r => r.status === 'running' || (r.status !== 'done' && r.id !== 's09')); // 09 는 실패해도 승인 가능(사람이 대신 봄), 도는 중이면 기다림
  if (notDone.length) fail(409, `공간 단계가 아직 끝나지 않았습니다(${notDone.map(r => r.id.slice(1)).join('·')}).`);
  if (!s.space.built) fail(409, '방 세트(08 결과)가 없습니다.');
  if (s.space.unapplied) fail(409, `공간에 아직 반영하지 않은 판정이 ${s.space.unapplied}건 있습니다 — 「반영해서 다시 만들기」를 먼저 눌러 주세요.`);
  const f = path.join(tdir(root, id), 'trial.json'); const t = JSON.parse(await fs.readFile(f, 'utf8'));
  t.spaceApproval = { by: reviewer, at: new Date().toISOString(), note: String(input.note || '').slice(0, 2000), buildAt: s.space.buildAt, regressRed: s.space.regressRed };
  t.updatedAt = new Date().toISOString();
  await fs.writeFile(f, JSON.stringify(t, null, 2));
  return status(root, id);
}

export async function handle(root, method, urlPath, input) {
  const m = urlPath.match(/^\/__review\/trial-flow\/([a-f0-9-]{36})(?:\/(space\/approve|space\/review|space\/item|space\/apply))?$/); if (!m) fail(404, '경로를 찾을 수 없습니다.');
  const [, id, act] = m;
  if (method === 'GET' && !act) return [200, await status(root, id)];
  if (method === 'GET' && act === 'space/review') return [200, await spaceReview(root, id)];
  if (method === 'POST' && act === 'space/item') return [200, await setSpaceItem(root, id, input || {})];
  if (method === 'POST' && act === 'space/apply') return [202, await applySpace(root, id)];
  if (method === 'POST' && act === 'space/approve') return [200, await approveSpace(root, id, input || {})];
  fail(405, '지원하지 않는 요청입니다.');
}
