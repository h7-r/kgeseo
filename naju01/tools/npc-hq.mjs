// npc-hq.mjs — 사람·구렁이 고품질판(10/20): Meshy 원본 → 용접 → 면 줄이기(목표 삼각형) → 크기 규약 맞춤 → 텍스처 한 변 → jpeg
// node naju01/tools/npc-hq.mjs <Meshy원본.glb> <naju01/assets/models/이름.glb> <height|lying> <목표삼각형> <텍스처한변>
//   10/20 값: 사람 4명 height 60000 2048 · 구렁이 lying 80000 2048(→ serpent-hq.glb). 원본: 아비사=Crimson_Sash_Scholar · 어부=Net_Bearing_Ronin · 어부2=Rope_Bearing_Wanderer · 어부3=Netbearer_Monk · 구렁이=Mistveil_Serpent
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
const [, , inp, out, rule, targetS, sideS] = process.argv;
const target = Number(targetS), side = Number(sideS);
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const root = doc.getRoot();
const triCount = () => root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0), 0);
const t0 = triCount();
await doc.transform(weld());
const t1 = triCount();
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, target / t1), error: 0.002, lockBorder: false }));
const t2 = triCount();
// 크기 규약: height = 키 1 · 밑동 y=0 · XZ 한복판 / lying = 가로(X·Z 큰 쪽) 1 · 밑동 y=0 · XZ 한복판
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'); const v = [0, 0, 0]; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); } } }
const ext = mx.map((x, k) => x - mn[k]);
const s = rule === 'lying' ? 1 / Math.max(ext[0], ext[2]) : 1 / ext[1];
const off = [-(mn[0] + ext[0] / 2), -mn[1], -(mn[2] + ext[2] / 2)];
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'); const v = [0, 0, 0]; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); a.setElement(i, [(v[0] + off[0]) * s, (v[1] + off[1]) * s, (v[2] + off[2]) * s]); } }
for (const n of root.listNodes()) { n.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); if (n.getMesh() && !n.getName()) n.setName('Mesh_0'); }
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [side, side], quality: 88 }), dedup(), prune());
await io.write(out, doc);
console.log(out.split('/').pop(), `삼각형 ${t0} → 용접 ${t1} → ${t2}`, `크기 ${ext.map(x=>(x*s).toFixed(3)).join('×')}`);
