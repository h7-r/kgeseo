// cineReview.mjs — 이야기 컷 사람 검수(10/28 미르: 「그림을 보고 검수·선택·미세 조정·반려는 클로드가 아니라 사람이 — 에이전트 페이지 좌측 메뉴에 정식 공정으로」)
//   05b 가 컷마다 후보 그림을 그려 두면, 사람이 후보 중 고르고 · 글·그림 지시를 고쳐 다시 그리고 · 승인하거나 반려한다.
//   결정은 cinematics.json 에 남기고(humanReview 기록), 실내는 방 뷰어(rooms/viewer_data.json), 나주는 미리보기 폴더에 바로 반영한다.
//   서버가 요청마다 이 파일을 새로 읽는다(고쳐도 서버를 다시 켤 필요 없음).
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ID = /^[a-f0-9-]{36}$/;
const tdir = (root, id) => path.join(root, '.local/review/trials', id);
const readJ = async f => JSON.parse(await fs.readFile(f, 'utf8'));
const exists = f => fs.access(f).then(() => true, () => false);
const h8 = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const director = async root => import(pathToFileURL(path.join(root, 'tools/review/storyDirector.mjs')).href + `?t=${Date.now()}`);
// 10/28: 맥이 잠들어 끊긴 단계는 「running」으로 남는다 — 3분 넘게 저장이 없으면 끊긴 것으로 본다. 끊겼어도 결과가 저장돼 있으면 끝난 것으로
const live = (t, sid) => t.steps?.[sid]?.status === 'running' && Date.now() - Date.parse(t.updatedAt || 0) < 180e3;
const doneish = (t, sid) => { const x = t.steps?.[sid]; return x?.status === 'done' || (x?.status === 'running' && Boolean(x.result) && !live(t, sid)); };
const STATUS = ['pending', 'approved', 'rejected'];

async function sceneTitles(root, id) { try { const a = await readJ(path.join(tdir(root, id), 'AI-04.json')); return Object.fromEntries((a.scenes || []).map(s => [s.scene_id, s.title || s.scene_id])); } catch { return {}; } }
async function jobsOf(root, id) {
  const dir = path.join(tdir(root, id), 'cine'); const out = {};
  for (const f of await fs.readdir(dir).catch(() => [])) if (/^_job_.*\.json$/.test(f)) { try { const j = await readJ(path.join(dir, f)); out[j.key] = j; } catch { /* 쓰는 중 */ } }
  return out;
}

export async function list(root) {
  const base = path.join(root, '.local/review/trials'); const items = []; const { panelRefs } = await director(root);
  for (const id of await fs.readdir(base).catch(() => [])) {
    if (!ID.test(id) || !(await exists(path.join(base, id, 'cinematics.json')))) continue;
    try {
      const t = await readJ(path.join(base, id, 'trial.json')); const doc = await readJ(path.join(base, id, 'cinematics.json'));
      const P = panelRefs(doc); const n = s => P.filter(x => (x.q.review?.status || 'pending') === s).length;
      items.push({ id, title: t.title || id, spaceKind: t.spaceKind || 'outdoor', createdAt: t.createdAt, panels: P.length, pending: n('pending'), approved: n('approved'), rejected: n('rejected') });
    } catch { /* 깨진 시험은 건너뜀 */ }
  }
  return { trials: items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) };
}

export async function detail(root, id) {
  const doc = await readJ(path.join(tdir(root, id), 'cinematics.json')).catch(() => fail(404, '이 시험에는 이야기 컷(cinematics.json)이 없습니다.'));
  const t = await readJ(path.join(tdir(root, id), 'trial.json')).catch(() => ({}));
  const titles = await sceneTitles(root, id); const jobs = await jobsOf(root, id);
  const { panelRefs } = await director(root);
  const sections = [];
  for (const x of panelRefs(doc)) {
    let s = sections.find(v => v.section === x.section);
    if (!s) { s = { section: x.section, kind: x.section === 'ending' ? 'ending' : x.section.startsWith('recall:') ? 'recall' : 'intro', title: x.section === 'ending' ? '결말' : x.section.startsWith('recall:') ? `회상 ${x.section.slice(7)}` : `${titles[x.c.scene_id] || x.c.scene_id}`, goal: x.c.goal || '', reveal: x.c.reveal || '', left_open: x.c.left_open || '', field: x.c.field || null, panels: [] }; sections.push(s); }
    const q = x.q; s.panels.push({ key: x.key, id: q.id, caption: q.caption || '', image_prompt: q.image_prompt || '', image_prompt_ko: q.image_prompt_ko && q.image_prompt_ko_src === q.image_prompt ? q.image_prompt_ko : null, img: q.img || null, candidates: q.candidates || (q.img ? [q.img] : []), review: q.review?.status ? q.review : { status: 'pending' }, aiReview: q.aiReview || (q.review && 'ok' in q.review ? q.review : null) /* 10/27 이전 판: Claude 그림 판정이 review 자리에 있었다 */, job: jobs[x.key] || null });
  }
  const all = sections.flatMap(s => s.panels); const pending = all.filter(p => p.review.status === 'pending').length;
  let left = [];
  try { const T = await import(pathToFileURL(path.join(root, 'tools/review/agentTrial.mjs')).href + `?t=${Date.now()}`); const L = T.stepsFor(t); const di = L.findIndex(x => x.director); if (di >= 0) left = L.slice(di + 1).map(x => x.id).filter(sid => !doneish(t, sid)); } catch { /* 없어도 됨 */ }
  const next = { id: 's06', status: t.steps?.s06?.status || null, pending, ready: pending === 0, left, running: left.some(sid => live(t, sid)) };
  return { next, trial: { id, title: t.title || id, spaceKind: t.spaceKind || 'outdoor' }, bible: doc.bible || {}, sections, history: (doc.humanReview || []).slice(-40).reverse() };
}

/** 사람 결정 — pick(후보 고르기) · approve(승인) · reject(반려) · reset(검수 전으로) · edit(글·그림 지시 고치기) */
export async function decide(root, id, input = {}) {
  const f = path.join(tdir(root, id), 'cinematics.json'); const doc = await readJ(f);
  const { panelRefs } = await director(root); const now = new Date().toISOString(); const act = String(input.action || '');
  // 10/28 미르: 「대본은 직접 수정 및 입력도 가능해야」 — 장면 글(goal·결말)·컷 추가·컷 빼기
  const secOf = sec => (doc.cinematics || []).find(c => sec === 'ending' ? c.kind === 'ending' : c.kind === 'intro' && `intro:${c.scene_id}` === sec) || fail(404, '장면을 찾을 수 없습니다.');
  const T = (v, n) => String(v ?? '').trim().slice(0, n);
  if (act === 'section' || act === 'add' || act === 'remove') {
    if (act === 'section') { const c = secOf(input.section); if (c.kind === 'intro' && input.goal != null) c.goal = T(input.goal, 300); if (c.kind === 'ending') { if (input.reveal != null) c.reveal = T(input.reveal, 500); if (input.left_open != null) c.left_open = T(input.left_open, 500); c.field ||= {}; if (input.place != null) c.field.place = T(input.place, 120); if (input.seal != null) c.field.seal = T(input.seal, 400); if (input.question != null) c.field.question = T(input.question, 200); } }
    if (act === 'add') { const c = secOf(input.section); const cap = T(input.caption, 300); if (!cap) fail(422, '컷 글을 입력하세요.'); c.panels ||= []; const ids = new Set(c.panels.map(q => String(q.id))); let k = 1; while (ids.has(`H${k}`)) k++;
      const q = { id: `H${k}`, caption: cap, image_prompt: T(input.image_prompt, 1200) || '', fact_ids: [], uses: ['house'], candidates: [], review: { status: 'pending', by: 'human', at: now, note: '사람이 추가한 컷' } };
      const at = input.after_key ? c.panels.findIndex(z => `${input.section}|${z.id}` === input.after_key) : -1; c.panels.splice(at >= 0 ? at + 1 : c.panels.length, 0, q); input.key = `${input.section}|${q.id}`; }
    if (act === 'remove') { const x = panelRefs(doc).find(v => v.key === input.key) || fail(404, '컷을 찾을 수 없습니다.'); const c = x.c; if ((c.panels || []).length <= 1) fail(422, '장면에 컷이 하나뿐입니다 — 빼지 말고 고치거나 반려하세요.'); c.panels = c.panels.filter(q => q !== x.q); }
    (doc.humanReview ||= []).push({ key: input.key || input.section, action: act, at: now });
    await fs.writeFile(f, JSON.stringify(doc, null, 2)); const synced = await sync(root, id, doc); return { ok: true, synced, ...(await detail(root, id)) };
  }
  const x = panelRefs(doc).find(v => v.key === input.key); if (!x) fail(404, '컷을 찾을 수 없습니다.');
  const q = x.q;
  if (act === 'pick') { const c = q.candidates || []; if (!c.includes(input.img)) fail(422, '후보에 없는 그림입니다.'); q.img = input.img; }
  else if (act === 'approve' || act === 'reject' || act === 'reset') { if (act === 'approve' && !q.img) fail(422, '고른 그림이 없습니다 — 그림 없이 쓰려면 반려(글만)로.'); q.review = { status: act === 'reset' ? 'pending' : act === 'approve' ? 'approved' : 'rejected', by: 'human', at: now, note: String(input.note || '').slice(0, 500) }; }
  else if (act === 'edit') { if (typeof input.caption === 'string' && input.caption.trim()) q.caption = input.caption.trim().slice(0, 300); /* 사람이 고친 글은 그 사람의 결정 — 상태 그대로 */
    if (typeof input.image_prompt === 'string' && input.image_prompt.trim() && input.image_prompt.trim() !== q.image_prompt) { q.image_prompt = input.image_prompt.trim().slice(0, 1200); if (q.review?.status === 'approved') q.review = { status: 'pending', by: 'human', at: now, note: '그림 지시 고침 — 다시 그려 확인' }; } }
  else fail(422, '알 수 없는 결정입니다.');
  if (!STATUS.includes(q.review?.status || 'pending')) q.review = { status: 'pending' };
  (doc.humanReview ||= []).push({ key: input.key, action: act, img: act === 'pick' ? input.img : undefined, note: input.note || undefined, at: now });
  await fs.writeFile(f, JSON.stringify(doc, null, 2));
  const synced = await sync(root, id, doc);
  return { ok: true, synced, ...(await detail(root, id)) };
}

/** 다시 그리기 — 고친 그림 지시로 후보를 n 장 더 그린다(맥북 FLUX, 로컬·무료). 오래 걸려 따로 띄우고 진행은 job 파일로 */
export async function redraw(root, id, input = {}) {
  if (input.image_prompt || input.caption) await decide(root, id, { key: input.key, action: 'edit', image_prompt: input.image_prompt, caption: input.caption });
  const dir = path.join(tdir(root, id), 'cine'); await fs.mkdir(dir, { recursive: true });
  const n = Math.max(1, Math.min(4, Number(input.n) || 2));
  const job = path.join(dir, `_job_${h8(input.key)}.json`);
  try { const j = await readJ(job); if (j.status === 'running' && Date.now() - Date.parse(j.startedAt) < 15 * 60e3) fail(409, '이 컷은 이미 그리는 중입니다.'); } catch (e) { if (e.status) throw e; }
  await fs.writeFile(job, JSON.stringify({ key: input.key, status: 'running', n, done: 0, startedAt: new Date().toISOString() }));
  const ch = spawn(process.execPath, [path.join(root, 'tools/review/cineReview.mjs'), '--redraw', root, id, input.key, String(n)], { detached: true, stdio: 'ignore' }); ch.unref();
  return { started: true, ...(await detail(root, id)) };
}

async function redrawWorker(root, id, key, n) {
  const dir = path.join(tdir(root, id), 'cine'); const job = path.join(dir, `_job_${h8(key)}.json`); const f = path.join(tdir(root, id), 'cinematics.json');
  const bin = process.env.MFLUX_BIN || path.join(process.env.HOME || '', 'flux-test/.venv/bin/mflux-generate-flux2');
  const { panelRefs, promptFor } = await director(root);
  const made = []; let error = null;
  try {
    const doc0 = await readJ(f); const x = panelRefs(doc0).find(v => v.key === key); if (!x) throw new Error('컷 없음');
    const prompt = promptFor(doc0.bible, x.q);
    for (let t = 0; t < n; t++) {
      const seed = 1000 + Math.floor(Math.random() * 90000); const file = `cine_${String(x.tag).replace(/[^\w-]/g, '')}_${String(x.q.id).replace(/[^\w-]/g, '')}_${h8(prompt + seed)}.png`;
      await new Promise((res, rej) => { const p = spawn(bin, ['--model', 'flux2-klein-4b', '--prompt', prompt, '--steps', '4', '--width', '1024', '--height', '576', '--seed', String(seed), '--output', path.join(dir, file)], { cwd: dir }); let err = ''; p.stderr.on('data', d => { err += d; }); p.on('error', rej); p.on('close', c => c === 0 ? res() : rej(new Error(err.slice(-300)))); });
      made.push(file); await fs.writeFile(job, JSON.stringify({ key, status: 'running', n, done: made.length, startedAt: new Date().toISOString() }));
    }
  } catch (e) { error = String(e.message || e).slice(0, 300); }
  // 그 사이 사람이 고른 것이 있을 수 있으니 다시 읽어 후보만 붙인다
  try { const doc = await readJ(f); const x = panelRefs(doc).find(v => v.key === key); if (x && made.length) { x.q.candidates = [...new Set([...(x.q.candidates || (x.q.img ? [x.q.img] : [])), ...made])]; (doc.humanReview ||= []).push({ key, action: 'redraw', made, at: new Date().toISOString() }); await fs.writeFile(f, JSON.stringify(doc, null, 2)); } } catch (e) { error ||= String(e.message); }
  await fs.writeFile(job, JSON.stringify({ key, status: error ? 'failed' : 'done', n, done: made.length, error, finishedAt: new Date().toISOString() }));
}

/** 결정을 게임 화면에 바로 반영 — 실내 방 뷰어 · 나주 미리보기 */
async function sync(root, id, doc) {
  const out = []; const T = tdir(root, id); const show = q => (q.review?.status === 'approved' ? q : { ...q, img: undefined }); /* 승인한 그림만 게임에 */
  const vdF = path.join(T, 'rooms/viewer_data.json');
  if (await exists(vdF)) {
    const vd = await readJ(vdF); const C = doc.cinematics || [];
    for (const sc of vd.SC || []) { const it = C.find(c => c.kind === 'intro' && c.scene_id === sc.id); if (it) sc.intro = { goal: it.goal || '', panels: (it.panels || []).map(show) }; if (sc.ending) { const en = C.find(c => c.kind === 'ending'); if (en) sc.ending = { ...sc.ending, panels: (en.panels || []).map(show), reveal: en.reveal || sc.ending.reveal, left_open: en.left_open ?? sc.ending.left_open, field: en.field || sc.ending.field } } }
    for (const q of C.flatMap(c => c.panels || [])) if (q.img && q.review?.status === 'approved') { const src = path.join(T, 'cine', q.img), dst = path.join(T, 'rooms', q.img); if (await exists(src) && !(await exists(dst))) await fs.copyFile(src, dst); }
    await fs.writeFile(vdF, JSON.stringify(vd)); out.push('방 뷰어');
  }
  const base = path.join(root, 'naju01/cine-preview');
  for (const name of await fs.readdir(base).catch(() => [])) {
    const cf = path.join(base, name, 'cinematics.json'); let cd; try { cd = await readJ(cf); } catch { continue; }
    if (!String(cd.from || '').startsWith(id)) continue;
    cd.cinematics = (doc.cinematics || []).map(c => ({ ...c, panels: (c.panels || []).map(show) }));
    for (const q of cd.cinematics.flatMap(c => c.panels || [])) if (q.img) { const src = path.join(T, 'cine', q.img), dst = path.join(base, name, q.img); if (await exists(src) && !(await exists(dst))) await fs.copyFile(src, dst); }
    await fs.writeFile(cf, JSON.stringify(cd, null, 1)); out.push(`나주 미리보기(${name})`);
  }
  return out;
}

/** 서버에서 부른다: [상태, 본문] */
/** 10/28 미르: 「이야기 컷 승인이 모두 끝나면 다음 에이전트 탭으로」 — 05b 뒤 남은 단계(06~09)를 이어서 돌린다(이미 끝난 단계는 건너뜀) */
export async function cont(root, id) {
  const T = await import(pathToFileURL(path.join(root, 'tools/review/agentTrial.mjs')).href + `?t=${Date.now()}`);
  const t = await T.readTrial(root, id); const L = T.stepsFor(t); const di = L.findIndex(s => s.director);
  if (di < 0) fail(409, '이 시험에는 장면 연출 단계가 없습니다.');
  const n = await T.cinePending(root, id); if (n > 0) fail(409, `검수 전 컷이 ${n}개 남았습니다.`);
  await T.cineGate(root, t, L[di + 1]?.id || L[di].id); // 설화·기획 승인도 다시 확인
  if (L.some(s => live(t, s.id) && !doneish(t, s.id))) return { started: [], running: true };
  const rest = L.slice(di + 1).map(s => s.id).filter(sid => !doneish(t, sid));
  if (rest.length) {
    const { openSync } = await import('node:fs');
    const log = openSync(path.join(tdir(root, id), 'run-chain.log'), 'a');
    const ch = spawn(process.execPath, [path.join(root, 'tools/review/runChain.mjs'), root, id, ...rest], { detached: true, stdio: ['ignore', log, log] }); ch.unref();
  }
  return { started: rest, running: false };
}

// 10/28 미르: 그림 지시(영어)를 한글로 같이 보이고, 한글로 덧붙인 요청을 영어 지시로 고쳐 쓴다 — Claude Haiku(호출당 약 1~3원)
const KO_SYS = '너는 그림 생성용 영어 지시문을 다루는 번역가다. 설명·인사 없이 요청한 JSON 만 출력한다.';
async function promptKo(root, id, input = {}) {
  const f = path.join(tdir(root, id), 'cinematics.json'); const doc = await readJ(f); const { panelRefs } = await director(root);
  const x = panelRefs(doc).find(v => v.key === input.key) || fail(404, '컷을 찾을 수 없습니다.');
  const base = String(input.image_prompt ?? x.q.image_prompt ?? '').slice(0, 2000);
  const { callClaude } = await import(pathToFileURL(path.join(root, 'tools/llm/claude.mjs')).href);
  const ask = async user => { const r = await callClaude({ tier: 'mechanical', system: KO_SYS, maxTokens: 1200, messages: [{ role: 'user', content: user }] }); const m = String(r.text || '').match(/\{[\s\S]*\}/); try { return JSON.parse(m[0]); } catch { fail(502, '번역 답을 읽지 못했습니다 — 다시 눌러 주세요.'); } };
  const ins = String(input.instruction_ko || '').trim().slice(0, 600);
  if (!ins) {
    if (!base) return { ko: '' };
    if (x.q.image_prompt_ko && x.q.image_prompt_ko_src === base) return { ko: x.q.image_prompt_ko };
    const j = await ask(`아래 영어 그림 지시를 자연스러운 한국어로 옮겨라. 고유명사는 한글로. JSON: {"ko": "..."}\n\n${base}`);
    if (base === x.q.image_prompt) { x.q.image_prompt_ko = String(j.ko || ''); x.q.image_prompt_ko_src = base; await fs.writeFile(f, JSON.stringify(doc, null, 2)); }
    return { ko: String(j.ko || '') };
  }
  const j = await ask(`지금 영어 그림 지시와 사람이 한국어로 적은 고칠 점이다. 고칠 점을 반영해 영어 지시를 다시 써라.
규칙: 영어로, 한 단락, 지금 지시의 장면·구도·시대 배경은 고칠 점이 바꾸라고 하지 않는 한 그대로 둔다. 화풍 문구는 넣지 않는다(따로 붙는다). 그림 속 글자·현대 물건은 넣지 않는다. 지금 지시에 있는 「no people」 같은 금지는 사람이 풀라고 하지 않는 한 유지.
JSON: {"en": "새 영어 지시", "ko": "새 지시의 한국어 번역"}

[지금 지시]
${base}

[고칠 점(한국어)]
${ins}`);
  if (!j.en) fail(502, '고친 지시를 만들지 못했습니다 — 다시 눌러 주세요.');
  return { en: String(j.en).trim(), ko: String(j.ko || '').trim() };
}

export async function handle(root, method, urlPath, input) {
  const m = urlPath.match(/^\/__review\/cine(?:\/([a-f0-9-]{36})(?:\/(decide|redraw|continue|prompt-ko))?)?$/);
  if (!m) fail(404, '이야기 컷 검수 경로를 찾을 수 없습니다.');
  const [, id, act] = m;
  if (!id && method === 'GET') return [200, await list(root)];
  if (id && !act && method === 'GET') return [200, await detail(root, id)];
  if (id && act === 'decide' && method === 'POST') return [200, await decide(root, id, input || {})];
  if (id && act === 'continue' && method === 'POST') return [202, await cont(root, id)];
  if (id && act === 'prompt-ko' && method === 'POST') return [200, await promptKo(root, id, input || {})];
  if (id && act === 'redraw' && method === 'POST') return [202, await redraw(root, id, input || {})];
  fail(405, '지원하지 않는 요청입니다.');
}

if (process.argv[2] === '--redraw') { const [, , , root, id, key, n] = process.argv; await redrawWorker(root, id, key, Number(n) || 2); }
