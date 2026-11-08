// npc-face-hq.mjs — 사람 고품질판, 얼굴만 촘촘히(11/9 미르 「어부들도 아비사처럼 얼굴 면수를 높여 달라」)
// node naju01/tools/npc-face-hq.mjs <Meshy원본.glb> <naju01/assets/models/이름.glb> <목표삼각형> <머리배율> [텍스처한변]
//   11/9 값: 어부 셋 65000 삼각형 · 머리배율(아래 k) 모형마다 맞춤 · 텍스처 2048. 원본: 어부=Net_Bearing_Ronin · 어부2=Rope_Bearing_Wanderer · 어부3=Netbearer_Monk
//
// npc-hq.mjs(10/20, 고르게 줄이기)와 같은 공정에 하나만 다르다 — 면 줄이기에 넣는 위치를 「머리 쪽을 k배 부풀린 대리 위치」로 준다.
// 줄이기는 오차를 위치로 재므로 부풀린 머리는 오차가 커 보여 삼각형이 더 남는다. 결과 인덱스는 원래 정점의 부분집합이라
// 원래 위치를 그대로 쓰면 모양은 원본 그대로다. 부풀림은 키 비율 HEAD_FROM~HEAD_TO 를 smoothstep 으로 이어 목에서 끊기지 않는다.
// 같은 위치는 같은 대리 위치가 되므로(위치만의 함수) UV 이음매를 위치로 묶어 지키는 meshopt 의 판단도 그대로다.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, prune, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const HEAD_FROM = 0.8;
const HEAD_TO = 0.86;
/** 머리 가운데 높이(키 비율) — 부풀림의 중심 */
const HEAD_CENTER = 0.92;

const [, , inp, out, targetS, kS, sideS = '2048'] = process.argv;
const target = Number(targetS), k = Number(kS), side = Number(sideS);
if (!inp || !out || !target || !k) {
  console.error('쓰는 법: node naju01/tools/npc-face-hq.mjs <원본.glb> <결과.glb> <목표삼각형> <머리배율> [텍스처한변]');
  process.exit(1);
}
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const root = doc.getRoot();
const prims = () => root.listMeshes().flatMap((m) => m.listPrimitives());
const triCount = () => prims().reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const t0 = triCount();
await doc.transform(weld());
const t1 = triCount();

// 키 범위와 머리 가운데(XZ 는 머리 정점들의 평균)
let minY = Infinity, maxY = -Infinity;
for (const p of prims()) { const a = p.getAttribute('POSITION'); const v = [0, 0, 0]; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]); } }
const height = maxY - minY;
const yNorm = (y) => (y - minY) / height;
let cx = 0, cz = 0, n = 0;
for (const p of prims()) { const a = p.getAttribute('POSITION'); const v = [0, 0, 0]; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); if (yNorm(v[1]) > HEAD_TO) { cx += v[0]; cz += v[2]; n++; } } }
const center = [cx / Math.max(1, n), minY + HEAD_CENTER * height, cz / Math.max(1, n)];

for (const p of prims()) {
  const a = p.getAttribute('POSITION');
  const count = a.getCount();
  const proxy = new Float32Array(count * 3);
  const v = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    a.getElement(i, v);
    const f = 1 + (k - 1) * smoothstep(HEAD_FROM, HEAD_TO, yNorm(v[1]));
    for (let c = 0; c < 3; c++) proxy[i * 3 + c] = center[c] + (v[c] - center[c]) * f;
  }
  const indices = p.getIndices() ? Uint32Array.from(p.getIndices().getArray()) : Uint32Array.from({ length: count }, (_, i) => i);
  const share = indices.length / 3 / t1;
  const goal = Math.max(3, Math.floor((target * share)) * 3);
  // 오차 한도는 두지 않는다(1) — 목표 삼각형 수가 정한다
  const [simplified] = MeshoptSimplifier.simplify(indices, proxy, 3, goal, 1, []);
  const accessor = doc.createAccessor().setType('SCALAR').setArray(simplified).setBuffer(root.listBuffers()[0]);
  p.setIndices(accessor);
  compactPrimitive(p);
}
const t2 = triCount();
let head = 0;
for (const p of prims()) {
  const a = p.getAttribute('POSITION'); const idx = p.getIndices(); const v = [0, 0, 0];
  for (let i = 0; i < idx.getCount(); i += 3) { let y = 0; for (let c = 0; c < 3; c++) { a.getElement(idx.getScalar(i + c), v); y += v[1]; } if (yNorm(y / 3) > 0.83) head++; }
}

// 크기 규약(npc-hq 와 같다): 키 1 · 밑동 y=0 · XZ 한복판
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const p of prims()) { const a = p.getAttribute('POSITION'); const v = [0, 0, 0]; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], v[c]); mx[c] = Math.max(mx[c], v[c]); } } }
const ext = mx.map((x, c) => x - mn[c]);
const s = 1 / ext[1];
const off = [-(mn[0] + ext[0] / 2), -mn[1], -(mn[2] + ext[2] / 2)];
for (const p of prims()) { const a = p.getAttribute('POSITION'); const v = [0, 0, 0]; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); a.setElement(i, [(v[0] + off[0]) * s, (v[1] + off[1]) * s, (v[2] + off[2]) * s]); } }
for (const node of root.listNodes()) { node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); if (node.getMesh() && !node.getName()) node.setName('Mesh_0'); }
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [side, side], quality: 88 }), dedup(), prune());
await io.write(out, doc);
console.log(out.split('/').pop(), `삼각형 ${t0} → 용접 ${t1} → ${t2} · 머리(키 0.83 위) ${head} (${((head / t2) * 100).toFixed(1)}%)`, `크기 ${ext.map((x) => (x * s).toFixed(3)).join('×')}`);
