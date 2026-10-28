// trialBrief.mjs — 에이전트 시험의 설화·기획 사람 확인(10/28 미르: 「설화가 입력되면 요약도 하고, 사람 확인이 꼭 필요한 지점을 전처럼 리스트로 컨펌하게, 아래로는 게임 문서 양식 원본」)
//   01 사실 계약서(A) · 02 시놉시스(B) · 04 Scene 구성표(C)를 「핵심 검수 카드」(brief.mjs 와 같은 규칙·인용 검사)로 만든다.
//   자동: 01 이 끝나면 설화 요약, 04 가 끝나면 카드(agentTrial.startStep 이 부른다). 판정은 사람이 — 카드가 판정 전·문제면 05 부터 막는다(briefGate).
//   저장: .local/review/briefs/trial-<id>.json · 서버가 요청마다 새로 읽는다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const mod = async (root, rel) => import(pathToFileURL(path.join(root, rel)).href + `?t=${Date.now()}`);
const DATA = root => path.join(root, '.local/review');

/** 시험을 brief.mjs 가 다루는 「프로젝트 모양」으로. id 가 p:<검수 id> 면 검수 기록(프로젝트) 그대로 */
export async function asProject(root, id) {
  if (String(id).startsWith('p:')) { const db = JSON.parse(await fs.readFile(path.join(DATA(root), 'projects.json'), 'utf8')); const p = db.projects.find(x => x.id === id.slice(2)); if (!p) fail(404, '검수 기록을 찾을 수 없습니다.'); return p; }
  if (!/^[a-f0-9-]{36}$/.test(id)) fail(400, '시험 id 가 잘못됐습니다.');
  const dir = path.join(DATA(root), 'trials', id); const t = JSON.parse(await fs.readFile(path.join(dir, 'trial.json'), 'utf8'));
  const read = f => fs.readFile(path.join(dir, f), 'utf8').catch(() => '');
  return { id: `trial-${id}`, title: t.title, revision: 1, sourceText: await read('AI-01.md'), synopsis: await read('AI-02.md'), sceneNotes: await read('AI-04.md'), _trial: t };
}

async function briefSystem(root) {
  const src = await fs.readFile(path.join(root, 'tools/llm/story-brief.mjs'), 'utf8');
  const m = src.match(/const SYSTEM = `([\s\S]*?)`;/); if (!m) fail(500, '카드 규칙(story-brief.mjs SYSTEM)을 읽지 못했습니다.');
  return m[1];
}

export async function make(root, id) {
  const p = await asProject(root, id);
  if (!p.sourceText.trim() || !p.synopsis.trim() || !p.sceneNotes.trim()) fail(409, '01·02·04 문서가 모두 있어야 카드를 만듭니다.');
  const { callClaude } = await mod(root, 'tools/llm/claude.mjs'); const B = await mod(root, 'tools/review/brief.mjs');
  const body = B.BRIEF_DOCS.map(d => `<doc id="${d.key}" name="${d.label}">\n${p[d.field] || '(비어 있음)'}\n</doc>`).join('\n\n');
  const r = await callClaude({ tier: 'judgment', system: await briefSystem(root), maxTokens: 16000, messages: [{ role: 'user', content: `검수: ${p.title}\n\n${body}` }] });
  let raw = null; try { raw = JSON.parse(r.text.replace(/^```(?:json)?\s*|\s*```\s*$/g, '').trim()); } catch { const m = r.text.match(/\{[\s\S]*\}/); try { raw = m ? JSON.parse(m[0]) : null; } catch { raw = null; } }
  if (!raw) fail(502, '카드 답을 읽지 못했습니다 — 다시 만들어 주세요.');
  const u = r.usage || {}; const cost = ((u.input_tokens || 0) * 2 + (u.output_tokens || 0) * 10) / 1e6;
  const checked = B.validateBrief(p, raw);
  await B.storeBrief(DATA(root), p, { createdAt: new Date().toISOString(), model: r.model, usage: { ...u, cost_usd: +cost.toFixed(5) }, truncated: r.stopReason === 'max_tokens', ...checked });
  await fs.rm(path.join(DATA(root), 'briefs', `${p.id}.making.err`), { force: true }).catch(() => {});
  return get(root, id, { auto: false });
}

// 10/28 미르: 「버튼이 따로 있다 — 설화를 입력하면 자동으로 다 채워져 나와 있어야」 → 화면이 읽을 때 카드가 없고 문서가 다 있으면 뒤에서 만든다(버튼 없음). 같은 것을 두 번 만들지 않게 표시 파일
const lockOf = (root, p) => path.join(DATA(root), 'briefs', `${p.id}.making`);
async function making(root, p) { try { const t = Number(await fs.readFile(lockOf(root, p), 'utf8')); return Date.now() - t < 10 * 60e3; } catch { return false; } }
function kick(root, id, p) {
  (async () => { await fs.mkdir(path.dirname(lockOf(root, p)), { recursive: true }); await fs.writeFile(lockOf(root, p), String(Date.now()));
    try { await make(root, id); } catch (e) { await fs.writeFile(lockOf(root, p) + '.err', String(e.message || e)).catch(() => {}); } finally { await fs.rm(lockOf(root, p), { force: true }).catch(() => {}); } })();
}
export async function get(root, id, { auto = true } = {}) {
  const p = await asProject(root, id); const B = await mod(root, 'tools/review/brief.mjs');
  const cur = await B.currentBrief(DATA(root), p);
  const ready = Boolean(String(p.sourceText || '').trim() && String(p.synopsis || '').trim() && String(p.sceneNotes || '').trim());
  let busy = await making(root, p);
  if (auto && !cur.brief && ready && !busy) { kick(root, id, p); busy = true; }
  const lastError = cur.brief || busy ? null : await fs.readFile(lockOf(root, p) + '.err', 'utf8').catch(() => null);
  const ap = p._trial ? await approvalOf(root, p, cur.brief) : null;
  return { ...cur, command: '', auto: true, making: busy, lastError, blockers: B.briefBlockers(cur.brief), ready, approval: ap, ...(p._trial ? await chainOf(root, p._trial) : {}) };
}

/** 화면용: 01~04 문서 상태 + 승인 뒤 이어서 도는 단계(05~05b) 상태 */
async function chainOf(root, t) {
  const T = await mod(root, 'tools/review/agentTrial.mjs'); const list = T.stepsFor(t);
  const i4 = list.findIndex(s => s.id === 's04'); const di = list.findIndex(s => s.director);
  const row = s => ({ id: s.id, label: s.label || s.title || s.id, status: t.steps?.[s.id]?.status || 'idle', error: t.steps?.[s.id]?.error || null });
  return { docs: list.slice(0, i4 + 1).map(row), chain: list.slice(i4 + 1, di >= 0 ? di + 1 : i4 + 2).map(row) };
}

// ── 설화·기획 승인(10/28 미르: 「중앙 내용을 다 검토하고 승인한 다음에 이야기 컷으로 넘어가는 단계」) ──
//   사람이 요약·카드·문서를 보고 승인 → trial.json 의 storyApproval 에 남기고, 05(퍼즐)→05b(장면 연출)를 뒤에서 돌린다. 끝나면 「02 이야기 컷 검수」.
//   승인 뒤 문서나 카드 판정이 바뀌면 승인은 무효(지문 비교) — 05 부터 다시 막힌다.
const fingerprint = (p, brief) => crypto.createHash('sha256').update([p.sourceText, p.synopsis, p.sceneNotes, JSON.stringify((brief?.items || []).map(i => [i.id, i.decision || null]))].join('\u0000')).digest('hex').slice(0, 16);
async function approvalOf(root, p, brief) {
  const a = p._trial?.storyApproval; if (!a) return null;
  return { ...a, valid: a.fingerprint === fingerprint(p, brief) };
}
const trialPath = (root, id) => path.join(DATA(root), 'trials', id, 'trial.json');
export async function approve(root, id, input = {}) {
  if (String(id).startsWith('p:')) fail(400, '에이전트 시험에서만 쓰는 승인입니다.');
  const reviewer = String(input.reviewer || '').trim().slice(0, 100); if (!reviewer) fail(422, '검수자 이름을 적어 주세요.');
  const p = await asProject(root, id); const B = await mod(root, 'tools/review/brief.mjs'); const T = await mod(root, 'tools/review/agentTrial.mjs');
  const list = T.stepsFor(p._trial); const i4 = list.findIndex(s => s.id === 's04'); const di = list.findIndex(s => s.director);
  const notDone = list.slice(0, i4 + 1).filter(s => p._trial.steps?.[s.id]?.status !== 'done').map(s => s.id);
  if (notDone.length) fail(409, `문서가 아직 다 나오지 않았습니다(${notDone.join('·')}).`);
  if (list.some(s => p._trial.steps?.[s.id]?.status === 'running')) fail(409, '다른 단계가 돌고 있습니다.');
  const cur = await B.currentBrief(DATA(root), p); if (!cur.brief) fail(409, '사람 확인 카드가 아직 없습니다.');
  const bl = B.briefBlockers(cur.brief); if (bl.length) fail(409, `카드 판정이 남았습니다 — ${bl.map(b => b.message).join(' ')}`);
  const t = JSON.parse(await fs.readFile(trialPath(root, p._trial.id), 'utf8'));
  t.storyApproval = { by: reviewer, at: new Date().toISOString(), note: String(input.note || '').slice(0, 2000), fingerprint: fingerprint(p, cur.brief), cards: cur.brief.items.length };
  t.updatedAt = new Date().toISOString();
  await fs.writeFile(trialPath(root, p._trial.id), JSON.stringify(t, null, 2));
  // 05 ~ 05b 를 이어서(이미 끝난 단계는 건너뜀). 05b 가 끝나면 이야기 컷 사람 검수
  const chain = list.slice(i4 + 1, di >= 0 ? di + 1 : i4 + 2).map(s => s.id).filter(sid => t.steps?.[sid]?.status !== 'done');
  let started = [];
  if (chain.length) {
    const { spawn } = await import('node:child_process'); const { openSync } = await import('node:fs');
    const log = openSync(path.join(DATA(root), 'trials', t.id, 'run-chain.log'), 'a');
    const ch = spawn(process.execPath, [path.join(root, 'tools/review/runChain.mjs'), root, t.id, ...chain], { detached: true, stdio: ['ignore', log, log] }); ch.unref(); started = chain;
  }
  return { ...(await get(root, id, { auto: false })), started };
}

export async function decide(root, id, itemId, input) {
  const p = await asProject(root, id); const B = await mod(root, 'tools/review/brief.mjs');
  await B.decideBriefItem(DATA(root), p, { ...input, itemId });
  return get(root, id, { auto: false });
}

/** 05 부터: 카드가 있고 판정 전·문제가 남아 있으면 막는다. 카드가 아직 없으면(만드는 중·실패) 막지 않고 알림만 */
export async function gate(root, id) {
  const g = await get(root, id, { auto: false }).catch(() => null); if (!g?.brief) return String(id).startsWith('p:') ? null : '사람 확인 카드가 아직 없습니다.';
  if (g.blockers.length) return g.blockers.map(b => b.message).join(' ');
  if (!String(id).startsWith('p:') && !g.approval?.valid) return g.approval ? '승인 뒤 문서·카드가 바뀌어 승인이 무효가 됐습니다 — 다시 승인해 주세요.' : '「설화·기획 승인」을 아직 누르지 않았습니다.';
  return null;
}

/** 단계가 끝난 뒤 자동으로(실패해도 단계는 성공) */
export async function afterStep(root, id, stepId) {
  if (stepId === 's01') { const ss = await mod(root, 'tools/review/storySummary.mjs'); await ss.make(root, `trial:${id}`); return '설화 요약 만듦'; }
  if (stepId === 's04') { await make(root, id); return '핵심 검수 카드 만듦'; }
  return null;
}

export async function handle(root, method, urlPath, input) {
  const m = urlPath.match(/^\/__review\/trial-brief\/(?:(p)\/)?([a-zA-Z0-9-]{8,})(?:\/(make|approve)|\/items\/([a-zA-Z0-9-]+))?$/); if (!m) fail(404, '경로를 찾을 수 없습니다.');
  const [, isP, rawId, act, itemId] = m; const id = isP ? `p:${rawId}` : rawId;
  if (method === 'GET' && !act && !itemId) return [200, await get(root, id)];
  if (method === 'POST' && act === 'make') return [200, await make(root, id)];
  if (method === 'POST' && act === 'approve') return [200, await approve(root, id, input || {})];
  if (method === 'POST' && itemId) return [200, await decide(root, id, itemId, input || {})];
  fail(405, '지원하지 않는 요청입니다.');
}
