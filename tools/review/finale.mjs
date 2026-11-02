// finale.mjs — 마지막 방의 「진상 복원」 장치(10/28 미르: 「마지막 방에서 대단한 걸 끝내고 서사가 완료되어야」)
//   모은 단서로 왜곡된 기록(사람들이 잘못 기억·기록한 것)을 하나씩 바로잡는다 — 줄마다 「맞는 답 + 그것을 증명하는 단서」를 골라야 풀린다(하나씩 눌러 보면 풀리는 장치가 되지 않게).
//   다 바로잡으면 왜곡이 걷히고 결말 이야기 컷 → 엔딩 → 현장 봉인. 05b 끝에서 자동으로, 예전 시험은 검수 화면에서 따로(Claude 한 번, 몇십 원).
//   저장: cinematics.json 의 결말(kind:ending).finale
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SYSTEM = `너는 「왜곡」 방탈출의 마지막 장치를 만드는 연출가다. 세계관: 현재의 한국. 합동수사본부 조사관(플레이어)이 기억·기록·설화가 서로 어긋난 「왜곡 구역」에 들어가 설화 원래의 관계를 되찾는다(시간 여행이 아니다. 「신고」 같은 현대 행정 말은 쓰지 않는다).
마지막 장치 = 「왜곡된 기록 바로잡기」: 이 판에서 모은 단서로, 사람들이 잘못 알고 있던 기록 3줄을 하나씩 바로잡는다. 다 바로잡으면 왜곡이 걷히고 결말로 간다.
규칙:
- 줄은 정확히 3개. 각 줄 = 왜곡된 기록(distorted, 사람들이 잘못 아는 한 문장) · 물음(question) · 보기 2~3개(options) · 답(answer, 보기 중 하나) · 증명 단서(proof, 아래 단서 id 중 1~2개 — 이 단서 글만 읽어도 답이 나와야 한다) · 바로잡힌 기록(restored, 한 문장).
- 답은 결말에서 밝혀지는 사실(아래 [결말 — 밝혀진 것])과 같은 방향이고, 01 사실(F)에 근거한다. 「아직 모르는 것」(해석 유보·남은 물음)은 줄로 만들지 않는다 — 단정하지 않는다.
- 오답 보기는 그럴듯해야 한다(왜곡된 기록 쪽 해석). 답을 보기 글자에서 바로 알 수 없게.
- 같은 단서를 두 줄의 증명으로 쓰지 않는다. 퍼즐 정답 문자열을 그대로 옮기지 않는다.
- 쉬운 우리말. 방언 원문 그대로 쓰지 않는다.
JSON 만: {"title":"왜곡된 기록 바로잡기","intro":"한 문장 — 무엇을 하는지","claims":[{"id":"R1","distorted":"…","question":"…","options":["…","…"],"answer":"…","proof":["CL-…"],"restored":"…"}],"success":"다 바로잡았을 때 한 문장(왜곡이 걷히는 모습)"}`;

const tdir = (root, id) => path.join(root, '.local/review/trials', id);
const readJ = async f => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return null; } };
const extract = t => { const s = String(t || ''); const a = s.indexOf('{'), b = s.lastIndexOf('}'); try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; } };

export function checkFinale(f, clueIds) {
  const bad = [];
  if (!f || !Array.isArray(f.claims)) return ['claims 없음'];
  if (f.claims.length !== 3) bad.push(`줄이 ${f.claims.length}개 — 3개`);
  const used = new Set();
  for (const c of f.claims) {
    const o = c.options || [];
    if (o.length < 2 || o.length > 3) bad.push(`${c.id}: 보기 ${o.length}개 — 2~3개`);
    if (!o.includes(c.answer)) bad.push(`${c.id}: 답이 보기에 없음`);
    const pr = c.proof || []; if (!pr.length) bad.push(`${c.id}: 증명 단서 없음`);
    for (const p of pr) { if (!clueIds.has(p)) bad.push(`${c.id}: 없는 단서 ${p}`); if (used.has(p)) bad.push(`${c.id}: 단서 ${p} 를 두 줄에 씀`); used.add(p); }
    for (const k of ['distorted', 'question', 'restored']) if (!String(c[k] || '').trim()) bad.push(`${c.id}: ${k} 비었음`);
  }
  return bad;
}

/** cinematics.json 결말에 finale 를 만들어 붙인다. llmCall(system,user) → 글 */
export async function makeFinale(root, id, llmCall) {
  const D = tdir(root, id); const cf = path.join(D, 'cinematics.json');
  const doc = await readJ(cf); const pz = await readJ(path.join(D, 'puzzle.json')); const a01 = await readJ(path.join(D, 'AI-01.json'));
  if (!doc || !pz) throw Object.assign(new Error('이야기 컷(05b)·퍼즐(05)이 있어야 마지막 장치를 만듭니다.'), { status: 409 });
  const en = (doc.cinematics || []).find(c => c.kind === 'ending'); if (!en) throw Object.assign(new Error('결말 컷이 없습니다.'), { status: 409 });
  const P = (pz.puzzles || []).filter(p => p.presentation !== 'ending_cinematic');
  const clues = P.flatMap(p => (p.clues || []).map(c => ({ id: c.clue_id, puzzle: p.puzzle_id, text: c.text || '', content: c.content || '' })));
  const clueIds = new Set(clues.map(c => c.id));
  const a04 = await readJ(path.join(D, 'AI-04.json')); const lastSc = [...(a04?.scenes || [])].sort((x, y) => (x.order || 0) - (y.order || 0)).pop();
  const facts = [...(a01?.facts || []).map(f => `- ${f.id} ${f.text}`), ...(a01?.open || []).map(f => `- ${f.id} [해석 유보 — 단정 금지] ${f.text || f.issue || ''}`)].join('\n');
  const user = `[01 사실]\n${facts}\n\n[퍼즐과 단서 — 플레이어가 끝까지 오면 모두 갖고 있다]\n${P.map(p => `## ${p.puzzle_id} ${p.title} → 알게 되는 것: ${p.learns || ''}\n${(p.clues || []).map(c => `- ${c.clue_id}: ${c.text}${c.content ? ` / 내용: ${c.content}` : ''}`).join('\n')}`).join('\n')}\n\n[마지막 방 — 이 장치가 놓이는 곳. intro·success 는 이 방 모습으로]\n${lastSc ? `${lastSc.title || lastSc.scene_id} — ${lastSc.purpose || ''}` : ''}\n\n[결말 — 밝혀진 것]\n${en.reveal || ''}\n[아직 모르는 것 — 줄로 만들지 말 것]\n${en.left_open || ''}`;
  let f = extract(await llmCall(SYSTEM, user)); let bad = checkFinale(f, clueIds);
  if (bad.length) { f = extract(await llmCall(SYSTEM, `${user}\n\n[네가 쓴 것]\n${JSON.stringify(f)}\n\n[검사에서 걸린 것 — 모두 고쳐 전체 JSON 을 다시]\n${bad.map(b => `- ${b}`).join('\n')}`)); bad = checkFinale(f, clueIds); }
  if (!f) throw Object.assign(new Error('마지막 장치 답을 읽지 못했습니다.'), { status: 502 });
  const proofText = Object.fromEntries(clues.map(c => [c.id, c.text]));
  f.claims = (f.claims || []).map(c => ({ ...c, proof_text: (c.proof || []).map(p => proofText[p] || p) }));
  f.check = bad; f.at = new Date().toISOString();
  const d2 = await readJ(cf); const e2 = (d2.cinematics || []).find(c => c.kind === 'ending'); e2.finale = f;
  await fs.writeFile(cf, JSON.stringify(d2, null, 2));
  // 방 뷰어에도 바로(방을 다시 짓지 않고)
  const vf = path.join(D, 'rooms/viewer_data.json'); const vd = await readJ(vf);
  if (vd) { for (const sc of vd.SC || []) if (sc.ending) sc.ending.finale = f; await fs.writeFile(vf, JSON.stringify(vd)); }
  return f;
}

/** 검수 화면에서(예전 시험) — Claude 판단 단계 한 번 */
export async function makeFinaleClaude(root, id) {
  const { callClaude } = await import(pathToFileURL(path.join(root, 'tools/llm/claude.mjs')).href);
  return makeFinale(root, id, async (system, user) => (await callClaude({ tier: 'judgment', system, maxTokens: 4000, messages: [{ role: 'user', content: user }] })).text);
}
