// compose.mjs — 빈 방 GLB + 배치 결과(place_room.py) → 살림 넣은 방 GLB 한 개 (2026-10-20, 저장소 이식 10/21)
//   node tools/rooms/compose.mjs room.glb place.json out.glb
//   배치 결과의 file 은 절대 경로 또는 저장소 뿌리 기준 경로.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, dedup, prune, textureCompress, unpartition } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
const [, , roomF, placeF, outF] = process.argv;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
// 공용 라이브러리 경량본은 meshopt 압축 + KTX2 텍스처 — 읽고 쓸 때 해독기·부호기가 필요하다(10/21)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(roomF);
const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
const P = JSON.parse(fs.readFileSync(placeF, 'utf8'));
// 퍼즐용 상태 변형판(10/22) — public/_sf_local/variants/_index.json. 기본판과 좌표·크기가 같으므로
//   같은 배치 변환으로 「물건이름__상태_<state>」 노드를 함께 넣어 둔다. 뷰어가 불러온 뒤 떼어 두었다가 반응할 때 바꿔 끼운다.
const VAR = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'public/_sf_local/variants/_index.json'), 'utf8')).by_file || {}; } catch { return {}; } })();
const varFor = (file) => { const m = String(file).replace(/\\/g, '/').match(/_sf_local\/.+$/); return m ? VAR[m[0]] : null; };
let nVar = 0;
async function put(p, src, b, label, extras) {
  const ss = src.getRoot().getDefaultScene() || src.getRoot().listScenes()[0];
  const s = p.scale;
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, my = b.min[1];
  const a = (p.rot || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  // 회전·축척 뒤 바닥 가운데가 (x, y, z)에 오도록
  const lx = -cx * s, lz = -cz * s;
  const t = [p.x + c * lx + sn * lz, p.y - my * s, p.z - sn * lx + c * lz];
  const wrap = src.createNode(`${p.name}__${label}`).setScale([s, s, s]).setRotation([0, Math.sin(a / 2), 0, Math.cos(a / 2)]).setTranslation(t);
  if (extras) wrap.setExtras(extras);
  for (const ch of ss.listChildren()) { ss.removeChild(ch); wrap.addChild(ch); }
  let top = wrap;
  if (p.tilt) { // 밑동(바닥 가운데)을 축으로 기울임 — 벽에 기댄 연장
    const hh = p.tilt.deg * Math.PI / 360, ax = p.tilt.axis;
    top = src.createNode(`${p.name}__기댐${label === '배치' ? '' : '_' + label}`).setRotation([ax[0] * Math.sin(hh), ax[1] * Math.sin(hh), ax[2] * Math.sin(hh), Math.cos(hh)]).setTranslation([p.x, p.y, p.z]);
    wrap.setTranslation([t[0] - p.x, t[1] - p.y, t[2] - p.z]); top.addChild(wrap);
  }
  ss.addChild(top);
  const map = mergeDocuments(doc, src);
  const merged = map.get(ss);
  for (const ch of merged.listChildren()) { merged.removeChild(ch); scene.addChild(ch); }
  merged.dispose();
}
for (const p of P.placements) {
  const src = await io.read(path.resolve(ROOT, p.file));
  const b = getBounds(src.getRoot().getDefaultScene() || src.getRoot().listScenes()[0]); // 변형판도 기본판 상자로 놓는다(열린 문이 튀어나와도 자리는 같게)
  const v = varFor(p.file);
  await put(p, src, b, '배치', v ? { states: Object.keys(v.states), initial: v.initial || null } : null);
  if (v) for (const [state, url] of Object.entries(v.states)) {
    const f = path.join(ROOT, 'public', url);
    if (!fs.existsSync(f)) { console.warn(`변형판 없음: ${url}`); continue; }
    await put(p, await io.read(f), b, `상태_${state}`, { variantOf: p.name, state });
    nVar++;
  }
}
await doc.transform(unpartition(), dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], formats: /^(png|jpeg|webp)$/ }));
await io.write(outF, doc);
console.log(path.basename(outF), (fs.statSync(outF).size / 1e6).toFixed(2) + 'MB', 'nodes', doc.getRoot().listNodes().length, 'tex', doc.getRoot().listTextures().length, nVar ? `변형판 ${nVar}` : '');
