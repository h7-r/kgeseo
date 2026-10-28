// trialBrief.mjs — 에이전트 시험의 설화·기획 사람 확인(10/28 미르: 「설화가 입력되면 요약도 하고, 사람 확인이 꼭 필요한 지점을 전처럼 리스트로 컨펌하게, 아래로는 게임 문서 양식 원본」)
//   01 사실 계약서(A) · 02 시놉시스(B) · 04 Scene 구성표(C)를 「핵심 검수 카드」(brief.mjs 와 같은 규칙·인용 검사)로 만든다.
//   자동: 01 이 끝나면 설화 요약, 04 가 끝나면 카드(agentTrial.startStep 이 부른다). 판정은 사람이 — 카드가 판정 전·문제면 05 부터 막는다(briefGate).
//   저장: .local/review/briefs/trial-<id>.json · 서버가 요청마다 새로 읽는다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const mod = async (root, rel) => import(pathToFileURL(path.join(root, rel)).href + `?t=${Date.now()}`);
const DATA = root => path.join(root, '.local/review');

/** 시험을 brief.mjs 가 다루는 「프로젝트 모양」으로 */
export async function asProject(root, id) {
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
  return get(root, id);
}

export async function get(root, id) {
  const p = await asProject(root, id); const B = await mod(root, 'tools/review/brief.mjs');
  const cur = await B.currentBrief(DATA(root), p);
  return { ...cur, command: '', auto: true, blockers: B.briefBlockers(cur.brief), ready: Boolean(p.sourceText && p.synopsis && p.sceneNotes) };
}

export async function decide(root, id, itemId, input) {
  const p = await asProject(root, id); const B = await mod(root, 'tools/review/brief.mjs');
  await B.decideBriefItem(DATA(root), p, { ...input, itemId });
  return get(root, id);
}

/** 05 부터: 카드가 있고 판정 전·문제가 남아 있으면 막는다. 카드가 아직 없으면(만드는 중·실패) 막지 않고 알림만 */
export async function gate(root, id) {
  const g = await get(root, id).catch(() => null); if (!g?.brief) return null;
  return g.blockers.length ? g.blockers.map(b => b.message).join(' ') : null;
}

/** 단계가 끝난 뒤 자동으로(실패해도 단계는 성공) */
export async function afterStep(root, id, stepId) {
  if (stepId === 's01') { const ss = await mod(root, 'tools/review/storySummary.mjs'); await ss.make(root, `trial:${id}`); return '설화 요약 만듦'; }
  if (stepId === 's04') { await make(root, id); return '핵심 검수 카드 만듦'; }
  return null;
}

export async function handle(root, method, urlPath, input) {
  const m = urlPath.match(/^\/__review\/trial-brief\/([a-f0-9-]{36})(?:\/(make)|\/items\/([a-zA-Z0-9-]+))?$/); if (!m) fail(404, '경로를 찾을 수 없습니다.');
  const [, id, act, itemId] = m;
  if (method === 'GET' && !act && !itemId) return [200, await get(root, id)];
  if (method === 'POST' && act === 'make') return [200, await make(root, id)];
  if (method === 'POST' && itemId) return [200, await decide(root, id, itemId, input || {})];
  fail(405, '지원하지 않는 요청입니다.');
}
