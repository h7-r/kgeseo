// storyDirector.mjs — 05b 장면 연출 에이전트(10/27 미르: 「장면 연출은 따로 떼라」)
//   05 퍼즐이 다 정해진 뒤에 돈다. 공간마다 이야기 컷(intro: 앞에서 알게 된 것 → 이 공간에서 무엇을 왜) · 회상 장면 맞추기 패널 · 결말(새 사실 + 현장 봉인)을 쓰고,
//   컷마다 그림을 맥북 FLUX(mflux, 로컬·무료)로 그린 뒤 Claude 가 그림을 직접 보고 검수한다(얼굴·글자·컷 글과 일치·앞 컷과 같은 집). 걸리면 그 컷만 다시 그린다.
//   결과: cinematics.json + 트라이얼 폴더 cine/*.png. 08 이 방 폴더로 옮겨 뷰어에 싣는다.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const SYSTEM = `너는 지역 설화 방탈출 게임 「왜곡」의 장면 연출 에이전트다. 퍼즐은 이미 정해졌다(05). 너는 플레이어가 공간을 넘어갈 때마다 이야기를 읽고, 다음 공간에서 무엇을 왜 풀어야 하는지 알게 하는 이야기 컷과, 한 판을 닫는 결말을 쓴다.
원칙(10/27 미르)
- 한 판의 게임은 하나의 서사로 완결되고, 새로운 사실을 알며 끝난다. 현장에 가야만 확인할 수 있는 마지막 봉인 하나만 완주자에게 제안한다.
- 컷은 공간에서 다음 공간으로 넘어갈 때마다 이야기를 읽게 하고, 다음 공간에서 무엇을 왜 풀어야 하는지 당위를 준다.
- 01 설화 사실만 쓴다. U(해석 유보) 항목은 단정하지 않는다. NG(금지 왜곡)는 어기지 않는다. 원문 방언·옛말은 풀어 쓴 지금 말로.
- 퍼즐의 답, 뒤 공간에서 밝혀질 것은 앞 컷에서 말하지 않는다.
쓸 것(JSON 하나)
1) bible — 컷 그림이 서로 이어지게 하는 고정 묘사(영어). {"house":"이 처갓집의 생김새 한 줄(기와지붕·흙마당·마루·창호)","people":{"groom":"…","woman":"…", …}}. 화풍은 코드가 정한다(수묵 만화풍) — 화풍·분위기를 바꾸는 말은 쓰지 않는다. 사람은 어두운 실루엣이나 뒷모습으로 그린다 — 얼굴 없음. 옷차림·머리 모양으로만 구별(예: groom = young man in a white durumagi coat and black gat hat, woman = long loose black hair, plain white hanbok skirt).
   · 한 컷 = 한 화면 한 장면. 물건은 조선 민가 것만: 잠자리는 온돌 바닥에 바로 편 요와 이불(침대 아님), 의자·다리 긴 탁자·전등·전선·유리창 없음.
2) cinematics — 장면마다 intro 하나 + 결말 하나.
   - intro: {"scene_id":"scene-0N","kind":"intro","panels":[1~2개],"goal":"이 공간에서 무엇을 왜 찾는지 한 문장 — 플레이어에게 하는 말"}
     · 첫 장면 = 게임의 시작(왜곡 영역에 들어선 까닭, 무엇이 어긋나 있나). 다음 장면 = 앞 장면에서 알게 된 것(04 「나갈 때 들고 가는 것」·앞 퍼즐 learns)을 잇고 이 장면의 질문으로 끝난다.
     · 회상 장면 맞추기(hoesang)가 있는 장면은 그 회상이 intro 역할 — panels 는 [] 로, goal 만.
   - 결말: {"kind":"ending","panels":[2~4개],"reveal":"이 판을 끝까지 풀어 새로 알게 된 사실 한 문장(01 근거)","left_open":"아직 모르는 것 한 문장(02 결말의 열린 것)","field":{"place":"02 현장 연결의 장소 이름 그대로","seal":"그곳에 가야만 풀리는 마지막 봉인 — 현장에서 무엇을 직접 보고 확인하면 풀리는지 한 문장","question":"현장에서 답할 물음"}}
3) recall — 회상 장면 맞추기 퍼즐의 패널을 다듬는다: [{"puzzle_id":"PZ-..","panels":[…]}]. 패널 id 와 개수·차례(정답)는 그대로 두고 caption·fact_ids·uses·image_prompt 만 고친다.
패널 = {"id":"C1","caption":"30~70자, 지금 말로 쓴 서술","fact_ids":["F-.."],"uses":["house","woman"],"image_prompt":"English. ONE moment: place in the house, time of night, light, key objects; people only as dark silhouettes or seen from behind"}
- uses 는 이 컷에 나오는 bible 항목(house 와 people 의 키). 그림 지시문에는 bible 문장을 다시 쓰지 않는다(코드가 붙인다).
- 한 컷 = 한 순간. 글이 말하는 것이 그림에 보여야 한다(달이 해로 바뀌면 하늘의 해가, 여인이 나타나면 여인의 실루엣이).
- 사람(10/27 미르가 「탁월하다」고 한 대청 회상 컷 기준): 컷 그림에서는 사람을 어두운 실루엣·뒷모습으로 그린다. 각색 조건의 「인물 모형 없음」은 3D 공간 이야기다 — 컷에서 사람을 빼라는 뜻이 아니다. bible.people 에 「그리지 않음」을 쓰지 않는다.
- bible 은 짧게: house 15단어 이내(지붕·마당·마루·창호만 — 살림·이부자리 금지), people 은 실루엣 생김새(옷·머리)만 — 흔적·물건(이불·신·갓)은 bible 에 쓰지 않는다(쓰면 모든 컷에 같은 물건이 붙는다).
- 컷마다 장소·구도를 바꾼다(11차 1회: 모든 컷이 「마당 전경 + 마루에 편 이부자리」로 같아졌다). 예: 창호지에 비친 그림자 클로즈업 · 하늘의 달이 해로 바뀌는 장면 · 등잔 켠 부엌 안 · 물 고인 곳간 안 · 대문 밖 길 · 디딤돌의 신 클로즈업. 마당 전경은 게임 전체에 한두 번만. 이부자리는 그리지 않는다.
- 그림 생성기는 방 안 살림(이불·상·궤)을 서양식 침대·탁자로 잘못 그린다. 방 안 살림을 크게 그리는 컷은 피하고, 마당·마루·창호·문·하늘의 빛·디딤돌의 신처럼 바깥에서 보이는 것으로 장면을 잡는다.
JSON 만 답한다: {"bible":{…},"cinematics":[…],"recall":[…]}`;

const JUDGE = `너는 「왜곡」 이야기 컷 그림 검수자다. 그림 한 장과 그 컷 글·고정 묘사를 받는다. 사진에 보이는 것만 판정한다.
점검: F1 사람 얼굴(이목구비)이 또렷이 보임(어두운 실루엣·뒷모습은 괜찮다) · F2 글자·낙관·워터마크가 보임 · F3 컷 글의 주인공(무엇이 — 사람·물건·하늘의 해/달)이 그림에 아예 없음(빛 세기·소품 하나 차이는 통과) · F4 고정 묘사와 어긋남(여인이어야 하는데 남자로 보임, 기와집이어야 하는데 초가) · F5 조선 민가에 어색한 것이 눈에 띔(서양식 침대·의자·구두·전선·유리창, 마당에 깔린 이부자리) · F6 한 장에 여러 칸(만화 페이지)으로 나뉨.
확실하지 않으면 통과시킨다.
JSON 만: {"ok":true|false,"fails":["F1"],"why":"한 문장","fix":"다시 그릴 때 덧붙일 영어 지시(없으면 빈 문자열)"}`;

const STYLE = 'Single full-frame illustration, not a comic page, no panel borders. Korean traditional ink-wash manhwa style, Joseon-era countryside hanok, muted earthy palette, soft moonlight and oil-lamp light, cinematic wide shot, painterly brush texture, quiet eerie mood. People only as dark silhouettes or seen from behind, no faces. Only Joseon-era things, paper-lattice doors, no glass windows, no electric lights, no wires, no western furniture. No text, no letters, no watermark.'; // 10/27: 화풍은 코드 고정(05b 가 「귀여운 동화풍」으로 바꾼 일). 이부자리를 문구에 넣으면 모든 컷 마당에 이불이 깔려(11차 2·3회) 넣지 않는다

function run(cmd, args, { cwd, timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd }); let err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${path.basename(cmd)} 시간 초과`)); }, timeoutMs);
    p.stderr.on('data', d => { err += d; }); p.stdout.on('data', () => {});
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', c => { clearTimeout(t); c === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} 실패(${c}): ${err.slice(-400)}`)); });
  });
}
const exists = f => fs.access(f).then(() => true, () => false);
const h8 = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const safe = s => String(s).replace(/[^\w-]/g, '');

/** 검사 — 고칠 것 목록 */
export function checkDirector(out, { facts, d02, puzzles }) {
  const bad = []; const C = out.cinematics || [];
  const fid = new Set([...(facts?.facts || []), ...(facts?.open || [])].map(f => f.id));
  const P = (puzzles || []).filter(p => p.presentation !== 'ending_cinematic' && p.puzzle_type);
  const scIds = [...new Set(P.map(p => p.scene_id))];
  const bibleKeys = new Set(['house', ...Object.keys(out.bible?.people || {})]);
  const places = (d02?.field_link || []).map(f => String(f.place || '').trim()).filter(Boolean);
  const pan = (tag, ps) => { for (const q of ps || []) {
    const c = String(q.caption || ''); if (c.length < 15 || c.length > 90) bad.push(`${tag} ${q.id}: 컷 글 ${c.length}자 — 30~70자`);
    if (!/[a-z]{3}/i.test(String(q.image_prompt || ''))) bad.push(`${tag} ${q.id}: image_prompt(영어) 없음`);
    const bf = (q.fact_ids || []).filter(f => !fid.has(f)); if (!(q.fact_ids || []).length || bf.length) bad.push(`${tag} ${q.id}: fact_ids 가 01 사실이 아님(${bf.join(',') || '없음'})`);
    const bu = (q.uses || []).filter(u => !bibleKeys.has(u)); if (bu.length) bad.push(`${tag} ${q.id}: uses 에 bible 에 없는 키(${bu.join(',')})`);
  } };
  if (!out.bible?.house) bad.push('bible.house 없음 — 컷끼리 같은 집으로 이어지지 않는다');
  { const all = [...C.flatMap(c => c.panels || []), ...(out.recall || []).flatMap(r => r.panels || [])]; const bed = all.filter(q => /bedding|quilt|mattress|futon|\byo\b/i.test(String(q.image_prompt || ''))).map(q => q.id); if (bed.length > 1) bad.push(`이부자리를 그리는 컷 ${bed.length}개(${bed.join(',')}) — 그리지 않는다(서양식 침대로 나온다)`);
    const wide = all.filter(q => /courtyard|yard/i.test(String(q.image_prompt || '')) && /wide|whole|overview|establishing/i.test(String(q.image_prompt || ''))).map(q => q.id); if (wide.length > 2) bad.push(`마당 전경 컷 ${wide.length}개(${wide.join(',')}) — 두 개까지, 나머지는 다른 장소·구도로`);
    if (/bedding|quilt|mattress|\byo\b|sleeping/i.test(String(out.bible?.house || ''))) bad.push('bible.house 에 이부자리 — 넣으면 모든 컷에 이불이 깔린다'); const bp = JSON.stringify(out.bible?.people || {}); if (/bedding|quilt|shoe|hat|gat|straw|sash|footprint/i.test(bp)) bad.push('bible.people 에 물건·흔적이 들어 있음 — 실루엣 생김새만'); }
  for (const sc of scIds) {
    const it = C.find(c => c.kind === 'intro' && c.scene_id === sc); const hasRecall = P.some(p => p.scene_id === sc && p.solve?.device?.kind === 'hoesang');
    if (!it) { bad.push(`${sc}: 이야기 컷(intro) 없음 — 이 공간에서 무엇을 왜 푸는지`); continue; }
    if (!String(it.goal || '').trim()) bad.push(`${sc}: intro goal(무엇을 왜) 없음`);
    const n = (it.panels || []).length; if (!hasRecall && (n < 1 || n > 2)) bad.push(`${sc}: intro 컷 ${n}개 — 1~2개`); if (hasRecall && n) bad.push(`${sc}: 회상 장면이 있는 장면은 intro panels 를 [] 로`);
    pan(`${sc} intro`, it.panels);
  }
  const en = C.find(c => c.kind === 'ending');
  if (!en) bad.push('결말 컷(ending) 없음 — 새로 알게 된 사실 + 현장 봉인으로 마무리');
  else {
    const n = (en.panels || []).length; if (n < 2 || n > 4) bad.push(`결말 컷 ${n}개 — 2~4개`); pan('ending', en.panels);
    if (!String(en.reveal || '').trim()) bad.push('결말 reveal(새로 알게 된 사실) 없음');
    if (!en.field?.place || !en.field?.seal) bad.push('결말 field(현장 장소·봉인) 없음');
    else if (places.length && !places.includes(String(en.field.place).trim())) bad.push(`결말 현장 「${en.field.place}」이(가) 02 현장 연결(${places.join(', ')})에 없음`);
  }
  for (const p of P.filter(p => p.solve?.device?.kind === 'hoesang')) {
    const r = (out.recall || []).find(x => x.puzzle_id === p.puzzle_id); const want = (p.solve.device.spec?.panels || []).map(q => String(q.id));
    if (!r) { bad.push(`${p.puzzle_id}: 회상 패널(recall) 없음`); continue; }
    const got = (r.panels || []).map(q => String(q.id)); if (got.join() !== want.join()) bad.push(`${p.puzzle_id}: 회상 패널 id·차례는 05 그대로(${want.join(',')})`);
    pan(`${p.puzzle_id} recall`, r.panels);
  }
  return bad;
}

export async function runDirector({ root, trial, step, docs, readJsonOut, writeOut, extractJson, llm, fail, trialDirOf, notes = [] }) {
  const facts = docs['01']?.json, d02 = docs['02']?.json || {}, scenes = docs['04']?.json?.scenes || [];
  if (!facts || !scenes.length) fail(409, 'previous_step_missing', '01·04 결과가 없습니다.');
  const puzzleDoc = await readJsonOut(root, trial, 'puzzle.json').catch(() => null);
  if (!puzzleDoc?.puzzles?.length) fail(409, 'previous_step_missing', '05 퍼즐 초안이 없습니다.');
  const P = puzzleDoc.puzzles.filter(p => p.presentation !== 'ending_cinematic' && p.puzzle_type);
  const factLines = [...(facts.facts || []).map(f => `- ${f.id} [${f.category}] ${f.text}`), ...(facts.open || []).map(f => `- ${f.id} [해석 유보] ${f.text || f.issue || ''}${f.rule ? ` — ${f.rule}` : ''}`), ...(facts.ng || []).map(f => `- ${f.id} [금지 왜곡] ${f.text || f.change || ''}`)].join('\n');
  const orderLines = (facts.order || []).map(o => `${o.seq}. ${o.event} [${(o.facts || []).join(',')}]`).join('\n');
  const sceneLines = scenes.map(s => [`## ${s.scene_id} · ${s.title || ''} — ${s.purpose || ''}`, `- 질문: ${(s.questions || []).join(' / ')}`, s.exit?.carry_info?.length ? `- 나갈 때 들고 가는 것: ${s.exit.carry_info.join(' / ')}` : '',
    ...P.filter(p => p.scene_id === s.scene_id).map(p => `- 퍼즐 ${p.puzzle_id} 「${p.title}」(${p.solve?.device?.kind || p.solve?.interaction}) → 풀면 알게 되는 것: ${p.learns || ''}${p.solve?.device?.kind === 'hoesang' ? `\n  · 회상 장면 맞추기 — 05 패널(차례대로): ${(p.solve.device.spec?.panels || []).map(q => `${q.id} 「${q.caption}」[${(q.fact_ids || []).join(',')}]`).join(' / ')}` : ''}`)].filter(Boolean).join('\n')).join('\n\n');
  const endLines = ['- 결말 상태: ' + (d02.ending?.final_state || ''), '- 마지막 그림: ' + (d02.ending?.last_image || ''), '- 열린 채 남는 것: ' + (d02.ending?.left_open || ''), ...(d02.field_link || []).map(f => `- 현장: ${f.place} · 물음 「${f.online_question || ''}」 · 현장에서 볼 것: ${f.onsite || ''}`)].join('\n');
  const adapt = trial.adaptation?.text ? `\n\n[각색 조건 — 제작팀 방침, 원전 사실 아님]\n${trial.adaptation.text}` : '';
  const user = ['[01 설화 사실]', factLines, '', '[01 사건 순서]', orderLines, '', '[04 장면 + 05 퍼즐]', sceneLines, '', '[02 결말 · 현장 연결]', endLines].join('\n') + adapt;

  let out = extractJson(await llm(root, trial, step, { system: SYSTEM, user }));
  if (out.__error) fail(422, 'json_invalid', `JSON 을 읽지 못했습니다: ${out.__error}`);
  let bad = checkDirector(out, { facts, d02, puzzles: P }); const before = bad.slice();
  for (let r = 1; r <= 2 && bad.length; r++) {
    const o2 = extractJson(await llm(root, trial, step, { system: SYSTEM, user: `${user}\n\n[네가 쓴 것]\n${JSON.stringify(out)}\n\n[자동 검사에서 걸린 것 — 모두 고쳐 전체 JSON 을 다시 써라]\n${bad.map(x => `- ${x}`).join('\n')}` }));
    if (!o2.__error) { const b2 = checkDirector(o2, { facts, d02, puzzles: P }); if (b2.length <= bad.length) { out = o2; bad = b2; } }
  }

  // 그림 — 컷마다 한 장, Claude 가 보고 검수, 걸리면 그 컷만 다시(최대 2번)
  const bin = process.env.MFLUX_BIN || path.join(process.env.HOME || '', 'flux-test/.venv/bin/mflux-generate-flux2');
  const haveBin = await exists(bin);
  const dir = path.join(trialDirOf(root, trial.id), 'cine'); await fs.mkdir(dir, { recursive: true });
  const bible = out.bible || {}; const people = bible.people || {};
  const promptOf = q => [STYLE, (q.uses || []).includes('house') || !(q.uses || []).length ? `The house: ${bible.house || ''}` : '', ...(q.uses || []).filter(u => people[u]).map(u => `${u}: ${people[u]}`), `Scene: ${q.image_prompt || q.caption || ''}`].filter(Boolean).join(' ');
  const jobs = [...(out.cinematics || []).flatMap(c => (c.panels || []).map((q, k) => ({ tag: c.kind === 'ending' ? 'ending' : `intro-${c.scene_id}`, q, k }))), ...(out.recall || []).flatMap(r => (r.panels || []).map((q, k) => ({ tag: r.puzzle_id, q, k })))];
  const judged = { ok: 0, redrawn: 0, failed: 0 };
  if (!haveBin) notes.push(`그림 생성기(mflux)를 찾지 못함(${bin}) — 글만`);
  for (const { tag, q, k } of jobs) {
    if (!haveBin) break;
    let extra = '', last = null;
    for (let t = 0; t <= 2; t++) {
      const prompt = promptOf(q) + (extra ? ` ${extra}` : '');
      const file = `cine_${safe(tag)}_${safe(q.id)}_${h8(prompt + t)}.png`; const f = path.join(dir, file);
      if (!(await exists(f))) {
        try { await run(bin, ['--model', 'flux2-klein-4b', '--prompt', prompt, '--steps', '4', '--width', '1024', '--height', '576', '--seed', String(11 + k + t * 100), '--output', f], { cwd: dir }); }
        catch (e) { notes.push(`${tag} ${q.id}: 그림 생성 실패 — ${String(e.message).slice(0, 140)}`); break; }
      }
      q.img = file; last = file;
      // 검수 — 작게 줄여(macOS sips) 보낸다. 못 줄이면 원본
      let img = f, mt = 'image/png'; const small = f.replace(/\.png$/, '_s.jpg');
      try { if (!(await exists(small))) await run('sips', ['-s', 'format', 'jpeg', '-Z', '640', f, '--out', small], { timeoutMs: 30000 }); img = small; mt = 'image/jpeg'; } catch { /* 원본 그대로 */ }
      let v = null;
      try {
        const text = await llm(root, trial, { ...step, maxTokens: 1500, effort: 'low' }, { system: JUDGE, user: [{ type: 'text', text: `[컷 글] ${q.caption}\n[고정 묘사] house: ${bible.house || ''} · ${(q.uses || []).filter(u => people[u]).map(u => `${u}: ${people[u]}`).join(' · ')}\n[그림 지시] ${q.image_prompt}` }, { type: 'image', source: { type: 'base64', media_type: mt, data: (await fs.readFile(img)).toString('base64') } }] });
        v = extractJson(text);
      } catch (e) { notes.push(`${tag} ${q.id}: 그림 검수 실패 — ${String(e.message).slice(0, 120)}`); }
      q.review = v && !v.__error ? { ok: !!v.ok, fails: v.fails || [], why: v.why || '', try: t } : { ok: null, try: t };
      if (!v || v.__error || v.ok) break;
      if (t < 2) { extra = String(v.fix || '') + ' ' + (v.fails || []).map(x => ({ F1: 'Absolutely no visible faces.', F2: 'No text, letters or seals anywhere.', F5: 'Strictly Joseon-era objects only, no beds or chairs, show the scene from the courtyard.', F6: 'One single continuous image, no panels.' })[x] || '').join(' '); judged.redrawn++; }
    }
    if (q.review?.ok) judged.ok++; else if (q.review && q.review.ok === false) judged.failed++;
    if (last) q.img = last;
  }
  const doc = { ...out, check: { issues: bad, before: before.length !== bad.length ? before : undefined, images: judged, notes } };
  await writeOut(root, trial, 'cinematics.json', JSON.stringify(doc, null, 2));
  return { intros: (out.cinematics || []).filter(c => c.kind === 'intro').length, ending: !!(out.cinematics || []).find(c => c.kind === 'ending'), panels: jobs.length, issues: bad.length, images: judged };
}
