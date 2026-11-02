// storySummary.mjs — 설화 전문 요약 정리본(10/28 미르: 「설화와 기획 맨 위에 지금 이 설화가 어떤 스토리인지 전문 요약 정리본이 먼저 보여야」)
//   검수 프로젝트의 설화 원문(sourceText)만 읽어 줄거리·인물·사건 순서·배경·결말·아직 모르는 것을 정리한다. 각색(시놉시스)은 섞지 않는다.
//   만들기는 단추를 누를 때 한 번(Claude 판단 급, 약 $0.03~0.10). 원문이 바뀌면 「원문이 바뀜」으로 표시하고 다시 만들 수 있다.
//   저장: .local/review/summaries/<검수 id>.json · 원본 projects.json 은 바꾸지 않는다. 서버가 요청마다 이 파일을 새로 읽는다.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const sha = s => crypto.createHash('sha256').update(String(s || '')).digest('hex');
const SYSTEM = `너는 지역 설화 기반 게임 「왜곡」의 자료 정리 담당이다. 설화 원문(또는 사실 계약서)을 처음 보는 사람이 3분 안에 이 이야기가 무엇인지 알게 정리한다.
규칙
- 원문에 있는 것만 쓴다. 덧붙이지 않는다. 원문이 「해석 유보」「미확인」으로 둔 것은 단정하지 않고 open 에 둔다. 게임 창작(GF)·각색은 쓰지 않는다.
- 지금 쓰는 쉬운 우리말로 풀어 쓴다(방언·옛말은 뜻으로). 인물 이름·지명은 원문 그대로.
- story 는 처음부터 끝까지 이어지는 줄거리 3~6문단(문단마다 2~4문장). 누가·어디서·무엇을·왜·어떻게 끝났나가 보이게.
JSON 하나만 답한다:
{"title":"설화 이름","one_line":"한 문장 요약","place_time":"무대(지역·장소)와 때(시대)","people":[{"name":"","who":"누구인지 한 줄"}],"story":["문단",…],"events":["일어난 차례대로 한 줄씩",…],"ending":"어떻게 끝나나 한두 문장","open":["원문이 답하지 않거나 해석이 갈리는 것",…],"source_note":"원문 성격(채록·구술·기록 등)과 출처가 보이면 한 줄"}`;

// 10/28 미르: 「에이전트 시험의 설화와 기획이 텅 비어 있다」 — 에이전트 시험(원문 trial.source.text)도 같은 요약을 쓴다. id 가 trial:<uuid> 이면 시험
const isTrial = id => String(id).startsWith('trial:');
async function projectOf(root, id) {
  if (isTrial(id)) { const tid = id.slice(6); if (!/^[a-f0-9-]{36}$/.test(tid)) fail(400, '시험 id 가 잘못됐습니다.'); const t = JSON.parse(await fs.readFile(path.join(root, '.local/review/trials', tid, 'trial.json'), 'utf8')); return { id, title: t.title, sourceName: t.source?.name || '', sourceText: t.source?.text || '' }; }
  const db = JSON.parse(await fs.readFile(path.join(root, '.local/review/projects.json'), 'utf8'));
  return db.projects.find(p => p.id === id) || fail(404, '검수 프로젝트를 찾을 수 없습니다.');
}
const fileOf = (root, id) => isTrial(id) ? path.join(root, '.local/review/trials', id.slice(6), 'story_summary.json') : path.join(root, '.local/review/summaries', `${id}.json`);

// 10/28 미르: 「버튼 없이 설화를 입력하면 자동으로」 — 화면이 읽을 때 요약이 없거나 원문이 바뀌었으면 뒤에서 만든다
const lockOf = (root, id) => fileOf(root, id) + '.making';
async function makingNow(root, id) { try { return Date.now() - Number(await fs.readFile(lockOf(root, id), 'utf8')) < 5 * 60e3; } catch { return false; } }
function kick(root, id) { (async () => { await fs.mkdir(path.dirname(lockOf(root, id)), { recursive: true }); await fs.writeFile(lockOf(root, id), String(Date.now())); try { await make(root, id); } catch (e) { await fs.writeFile(lockOf(root, id) + '.err', String(e.message || e)).catch(() => {}); } finally { await fs.rm(lockOf(root, id), { force: true }).catch(() => {}); } })(); }
export async function get(root, id, { auto = true } = {}) {
  const p = await projectOf(root, id); const hash = sha(p.sourceText);
  let saved = null; try { saved = JSON.parse(await fs.readFile(fileOf(root, id), 'utf8')); } catch { /* 아직 없음 */ }
  const has = Boolean((p.sourceText || '').trim()); const stale = Boolean(saved && saved.sourceHash !== hash);
  let busy = await makingNow(root, id);
  if (auto && has && (!saved || stale) && !busy) { kick(root, id); busy = true; }
  const lastError = busy || (saved && !stale) ? null : await fs.readFile(lockOf(root, id) + '.err', 'utf8').catch(() => null);
  return { projectId: id, hasSource: has, sourceChars: (p.sourceText || '').length, summary: saved?.summary || null, at: saved?.at || null, costUsd: saved?.costUsd ?? null, stale, making: busy, lastError };
}

export async function make(root, id) {
  const p = await projectOf(root, id); const text = String(p.sourceText || '').trim();
  if (!text) fail(422, '설화 원문이 비어 있습니다 — 아래 「설화 자료 입력」에 원문을 넣고 저장한 뒤 만드세요.');
  const { callClaude } = await import(pathToFileURL(path.join(root, 'tools/llm/claude.mjs')).href);
  const r = await callClaude({ tier: 'judgment', system: SYSTEM, maxTokens: 6000, messages: [{ role: 'user', content: `[설화 이름(검수 제목)] ${p.title || ''}\n[출처] ${p.sourceName || ''}\n\n[설화 원문]\n${text.slice(0, 60000)}` }] });
  const m = r.text.match(/\{[\s\S]*\}/); let summary; try { summary = JSON.parse(m ? m[0] : r.text); } catch { fail(502, '요약 답을 읽지 못했습니다 — 다시 눌러 주세요.'); }
  const u = r.usage || {}; const costUsd = +(((u.input_tokens || 0) * 2 + (u.output_tokens || 0) * 10) / 1e6).toFixed(4);
  await fs.mkdir(path.dirname(fileOf(root, id)), { recursive: true });
  await fs.writeFile(fileOf(root, id), JSON.stringify({ summary, sourceHash: sha(p.sourceText), at: new Date().toISOString(), model: r.model, costUsd }, null, 2));
  await fs.rm(lockOf(root, id) + '.err', { force: true }).catch(() => {});
  return get(root, id, { auto: false });
}

export async function handle(root, method, urlPath) {
  const m = urlPath.match(/^\/__review\/story-summary\/(?:(trial)\/)?([a-zA-Z0-9-]+)$/); if (!m) fail(404, '경로를 찾을 수 없습니다.');
  const id = m[1] ? `trial:${m[2]}` : m[2];
  if (method === 'GET') return [200, await get(root, id)];
  if (method === 'POST') return [200, await make(root, id)];
  fail(405, '지원하지 않는 요청입니다.');
}
