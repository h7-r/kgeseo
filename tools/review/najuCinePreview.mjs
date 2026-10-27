#!/usr/bin/env node
// najuCinePreview.mjs — 05b 장면 연출 결과(cinematics.json + 그림)를 나주 게임 미리보기(naju01/cine-preview.html)로 옮긴다(10/27)
//   사용: node tools/review/najuCinePreview.mjs <시험 id> [폴더 이름=angam]
//   보기: npx vite naju01 → http://localhost:5174/cine-preview.html  (다른 폴더면 ?cine=<폴더>)
import fs from 'node:fs/promises';
import path from 'node:path';
const [id, name = 'angam'] = process.argv.slice(2);
if (!id) { console.error('사용: node tools/review/najuCinePreview.mjs <시험 id> [폴더]'); process.exit(1); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const tdir = (await fs.readdir(path.join(root, '.local/review/trials'))).find(d => d.startsWith(id));
if (!tdir) { console.error('시험을 찾지 못함:', id); process.exit(1); }
const src = path.join(root, '.local/review/trials', tdir);
const doc = JSON.parse(await fs.readFile(path.join(src, 'cinematics.json'), 'utf8'));
const a04 = JSON.parse(await fs.readFile(path.join(src, 'AI-04.json'), 'utf8'));
const out = path.join(root, 'naju01/cine-preview', name); await fs.mkdir(out, { recursive: true });
let n = 0;
for (const q of [...(doc.cinematics || []).flatMap(c => c.panels || []), ...(doc.recall || []).flatMap(r => r.panels || [])]) {
  if (!q.img) continue;
  try { await fs.copyFile(path.join(src, 'cine', q.img), path.join(out, q.img)); n++; } catch { delete q.img; }
}
const sceneTitles = Object.fromEntries((a04.scenes || []).map(s => [s.scene_id, s.title || s.scene_id]));
await fs.writeFile(path.join(out, 'cinematics.json'), JSON.stringify({ from: tdir, sceneTitles, cinematics: doc.cinematics, bible: doc.bible, scriptReview: doc.check?.script || null }, null, 1));
console.log(`그림 ${n}장 · ${path.relative(root, out)}/cinematics.json`);
