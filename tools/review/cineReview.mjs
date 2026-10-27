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
    if (!s) { s = { section: x.section, title: x.section === 'ending' ? '결말' : x.section.startsWith('recall:') ? `회상 ${x.section.slice(7)}` : `${titles[x.c.scene_id] || x.c.scene_id}`, goal: x.c.goal || '', reveal: x.c.reveal || '', field: x.c.field || null, panels: [] }; sections.push(s); }
    const q = x.q; s.panels.push({ key: x.key, id: q.id, caption: q.caption || '', image_prompt: q.image_prompt || '', img: q.img || null, candidates: q.candidates || (q.img ? [q.img] : []), review: q.review || { status: 'pending' }, aiReview: q.aiReview || null, job: jobs[x.key] || null });
  }
  return { trial: { id, title: t.title || id, spaceKind: t.spaceKind || 'outdoor' }, bible: doc.bible || {}, sections, history: (doc.humanReview || []).slice(-40).reverse() };
}

/** 사람 결정 — pick(후보 고르기) · approve(승인) · reject(반려) · reset(검수 전으로) · edit(글·그림 지시 고치기) */
export async function decide(root, id, input = {}) {
  const f = path.join(tdir(root, id), 'cinematics.json'); const doc = await readJ(f);
  const { panelRefs } = await director(root); const x = panelRefs(doc).find(v => v.key === input.key); if (!x) fail(404, '컷을 찾을 수 없습니다.');
  const q = x.q; const now = new Date().toISOString(); const act = String(input.action || '');
  if (act === 'pick') { const c = q.candidates || []; if (!c.includes(input.img)) fail(422, '후보에 없는 그림입니다.'); q.img = input.img; }
  else if (act === 'approve' || act === 'reject' || act === 'reset') { if (act === 'approve' && !q.img) fail(422, '고른 그림이 없습니다 — 그림 없이 쓰려면 반려(글만)로.'); q.review = { status: act === 'reset' ? 'pending' : act === 'approve' ? 'approved' : 'rejected', by: 'human', at: now, note: String(input.note || '').slice(0, 500) }; }
  else if (act === 'edit') { if (typeof input.caption === 'string' && input.caption.trim()) q.caption = input.caption.trim().slice(0, 300); if (typeof input.image_prompt === 'string' && input.image_prompt.trim()) q.image_prompt = input.image_prompt.trim().slice(0, 1200); q.review = { status: 'pending', by: 'human', at: now, note: '글·그림 지시 고침' }; }
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
  const out = []; const T = tdir(root, id); const show = q => (q.review?.status === 'rejected' ? { ...q, img: undefined } : q);
  const vdF = path.join(T, 'rooms/viewer_data.json');
  if (await exists(vdF)) {
    const vd = await readJ(vdF); const C = doc.cinematics || [];
    for (const sc of vd.SC || []) { const it = C.find(c => c.kind === 'intro' && c.scene_id === sc.id); if (it) sc.intro = { goal: it.goal || '', panels: (it.panels || []).map(show) }; if (sc.ending) { const en = C.find(c => c.kind === 'ending'); if (en) sc.ending = { ...sc.ending, panels: (en.panels || []).map(show), reveal: en.reveal || sc.ending.reveal } } }
    for (const q of C.flatMap(c => c.panels || [])) if (q.img && q.review?.status !== 'rejected') { const src = path.join(T, 'cine', q.img), dst = path.join(T, 'rooms', q.img); if (await exists(src) && !(await exists(dst))) await fs.copyFile(src, dst); }
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
export async function handle(root, method, urlPath, input) {
  const m = urlPath.match(/^\/__review\/cine(?:\/([a-f0-9-]{36})(?:\/(decide|redraw))?)?$/);
  if (!m) fail(404, '이야기 컷 검수 경로를 찾을 수 없습니다.');
  const [, id, act] = m;
  if (!id && method === 'GET') return [200, await list(root)];
  if (id && !act && method === 'GET') return [200, await detail(root, id)];
  if (id && act === 'decide' && method === 'POST') return [200, await decide(root, id, input || {})];
  if (id && act === 'redraw' && method === 'POST') return [202, await redraw(root, id, input || {})];
  fail(405, '지원하지 않는 요청입니다.');
}

if (process.argv[2] === '--redraw') { const [, , , root, id, key, n] = process.argv; await redrawWorker(root, id, key, Number(n) || 2); }
