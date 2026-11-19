// npc-face-hq.mjs — 사람 고품질판, 얼굴만 촘촘히(11/9 미르 「어부들도 아비사처럼 얼굴 면수를 높여 달라」)
// node naju01/tools/npc-face-hq.mjs <Meshy원본.glb> <naju01/assets/models/이름.glb> <목표삼각형> <머리배율> [텍스처한변]
//   11/9 값: 어부 70000 k7 · 어부2 70000 k7 · 어부3 70000 k4 · 텍스처 2048. 원본: 어부=Net_Bearing_Ronin · 어부2=Rope_Bearing_Wanderer · 어부3=Netbearer_Monk
//
// npc-hq.mjs(10/20, 고르게 줄이기)와 같은 공정에 하나만 다르다 — 면 줄이기에 넣는 위치를 「머리 쪽을 k배 부풀린 대리 위치」로 준다.
// 줄이기는 오차를 위치로 재므로 부풀린 머리는 오차가 커 보여 삼각형이 더 남는다. 결과 인덱스는 원래 정점의 부분집합이라
// 원래 위치를 그대로 쓰면 모양은 원본 그대로다. 부풀림은 키 비율 HEAD_FROM~HEAD_TO 를 smoothstep 으로 이어 목에서 끊기지 않는다.
// 같은 위치는 같은 대리 위치가 되므로(위치만의 함수) UV 이음매를 위치로 묶어 지키는 meshopt 의 판단도 그대로다.
//
// 법선 다듬기(11/9 미르 「면수가 여전한 것 같다」) — 게임 화면의 각진 얼룩은 면수보다 법선 탓이었다. 남은 정점이 원본 300만 면 조각의
// 잔주름 법선을 그대로 들고 있어, 툰 음영 · 후처리 단계가 그 잔물결을 각진 조각으로 끊는다(빛 없이 텍스처만 그리면 매끈했다).
//  ① 줄인 모양으로 법선을 다시 잰다(같은 위치 = UV 이음매로 갈라진 점은 하나로 묶어 이음매가 안 보이게)
//  ② 얼굴(키 0.83~0.87 위로 갈수록 온 세기) · 목(0.74~0.80, 절반 세기)만 이웃 정점 법선의 평균으로 SMOOTH_PASSES 번 편다.
//     머리를 공으로 본 구형 법선은 턱 밑 · 옷깃 · 머리카락처럼 공이 아닌 면에서 점 얼룩을 냈다(화면 시험).
//  ③ 얼굴 피부만 구형 법선을 FACE_FLATTEN 만큼 섞는다(중심은 FACE_BACK 만큼 뒤로) — 플레이어 아바타의 「얼굴 평탄」(avatar/toonMaterial _faceFlatten)과 같은 셈.
//     피부는 텍스처 색으로 고른다(머리 높이 · 살색 — 흰 머리띠 · 검은 머리 · 수염 · 옷은 빠진다). 그래야 그늘 경계가 얼굴 한가운데를
//     각지게 가로지르지 않고 둥근 머리처럼 옆으로 비켜 간다.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, prune, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const HEAD_FROM = 0.8;
const HEAD_TO = 0.86;
/** 머리 가운데 높이(키 비율) — 부풀림의 중심 */
const HEAD_CENTER = 0.92;
/** 얼굴 · 목 법선을 펴는 횟수 */
const SMOOTH_PASSES = 25;
/**
 * 얼굴 피부에 섞는 구형 법선 비율 · 구의 중심을 머리 가운데에서 뒤로 물리는 거리(키 비율).
 * 아바타 기본은 0.4 지만 사실풍 Meshy 얼굴은 0.6 에서도 볼 그늘이 각지게 남았다 — 0.9 · 뒤로 0.08 이면 앞얼굴이 고르게 밝고
 * 그늘은 얼굴 가장자리로 비켜 간다(11/9 같은 조건 세 판 비교). 환경 변수 FACE_FLATTEN · FACE_BACK 로 바꿔 볼 수 있다.
 */
const FACE_FLATTEN = Number(process.env.FACE_FLATTEN ?? 0.9);
const FACE_BACK = Number(process.env.FACE_BACK ?? 0.08);

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
// 법선 다듬기 — 크기 규약을 맞춘 뒤라 높이가 곧 키 비율이다
let smoothed = 0;
let skin = 0;
for (const p of prims()) {
  const result = await smoothNormals(p);
  smoothed += result.touched;
  skin += result.skin;
}

await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [side, side], quality: 88 }), dedup(), prune());
await io.write(out, doc);
console.log(out.split('/').pop(), `삼각형 ${t0} → 용접 ${t1} → ${t2} · 머리(키 0.83 위) ${head} (${((head / t2) * 100).toFixed(1)}%)`, `법선 편 점 ${smoothed} · 얼굴 피부 ${skin}`, `크기 ${ext.map((x) => (x * s).toFixed(3)).join('×')}`);

/** 바탕색 텍스처를 읽어 uv → 색을 돌려준다(없으면 null) */
async function readBaseColor(p) {
  const texture = p.getMaterial()?.getBaseColorTexture();
  const image = texture?.getImage();
  if (!image) return null;
  const { data, info } = await sharp(Buffer.from(image)).resize(2048, 2048, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return (u, v) => {
    const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width)));
    const y = Math.min(info.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * info.height)));
    const o = (y * info.width + x) * 3;
    return [data[o] / 255, data[o + 1] / 255, data[o + 2] / 255];
  };
}

/** 살색인가 — 붉은 쪽 색조 · 적당한 채도 · 너무 어둡거나 희지 않음 */
function isSkin([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max > 0 ? (max - min) / max : 0;
  return r >= g && g >= b * 0.9 && max > 0.3 && max < 0.97 && sat > 0.12 && sat < 0.6;
}

/** 법선을 줄인 모양으로 다시 재고 얼굴 · 목만 고르게 편 뒤 얼굴 피부에 구형 법선을 섞는다. 편 점 · 피부 점(위치 묶음) 수를 돌려준다 */
async function smoothNormals(p) {
  const a = p.getAttribute('POSITION');
  const idx = p.getIndices();
  const count = a.getCount();
  let normals = p.getAttribute('NORMAL');
  if (!normals) {
    normals = doc.createAccessor().setType('VEC3').setArray(new Float32Array(count * 3)).setBuffer(root.listBuffers()[0]);
    p.setAttribute('NORMAL', normals);
  }
  // 같은 위치끼리 묶는다(UV 이음매로 갈라진 점)
  const group = new Int32Array(count);
  const keys = new Map();
  const ys = [];
  const v = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    a.getElement(i, v);
    const key = `${v[0].toFixed(5)},${v[1].toFixed(5)},${v[2].toFixed(5)}`;
    let g = keys.get(key);
    if (g === undefined) {
      g = ys.length;
      keys.set(key, g);
      ys.push(v[1]);
    }
    group[i] = g;
  }
  const n = ys.length;
  // ① 면 넓이 가중 법선
  let cur = new Float32Array(n * 3);
  const neighbors = Array.from({ length: n }, () => new Set());
  const pa = [0, 0, 0], pb = [0, 0, 0], pc = [0, 0, 0];
  for (let t = 0; t < idx.getCount(); t += 3) {
    const i0 = idx.getScalar(t), i1 = idx.getScalar(t + 1), i2 = idx.getScalar(t + 2);
    a.getElement(i0, pa); a.getElement(i1, pb); a.getElement(i2, pc);
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const face = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const g0 = group[i0], g1 = group[i1], g2 = group[i2];
    for (const g of [g0, g1, g2]) for (let c = 0; c < 3; c++) cur[g * 3 + c] += face[c];
    neighbors[g0].add(g1).add(g2); neighbors[g1].add(g0).add(g2); neighbors[g2].add(g0).add(g1);
  }
  const normalize = (arr, g) => { const l = Math.hypot(arr[g * 3], arr[g * 3 + 1], arr[g * 3 + 2]) || 1; for (let c = 0; c < 3; c++) arr[g * 3 + c] /= l; };
  for (let g = 0; g < n; g++) normalize(cur, g);
  // ② 얼굴 · 목만 이웃 평균으로 편다
  const weight = (y) => 0.5 * smoothstep(0.74, 0.8, y) + 0.5 * smoothstep(0.83, 0.87, y);
  let next = new Float32Array(n * 3);
  let touched = 0;
  for (let g = 0; g < n; g++) if (weight(ys[g]) > 0) touched++;
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    for (let g = 0; g < n; g++) {
      const w = weight(ys[g]);
      for (let c = 0; c < 3; c++) next[g * 3 + c] = cur[g * 3 + c];
      if (w <= 0) continue;
      const sum = [0, 0, 0];
      for (const j of neighbors[g]) for (let c = 0; c < 3; c++) sum[c] += cur[j * 3 + c];
      const l = Math.hypot(sum[0], sum[1], sum[2]) || 1;
      for (let c = 0; c < 3; c++) next[g * 3 + c] = cur[g * 3 + c] * (1 - w) + (sum[c] / l) * w;
      normalize(next, g);
    }
    [cur, next] = [next, cur];
  }
  // ③ 얼굴 피부 — 위치 묶음마다 살색 점의 비율을 재고, 이웃끼리 몇 번 고르게 해 경계를 부드럽게
  const colorAt = await readBaseColor(p);
  const uvs = p.getAttribute('TEXCOORD_0');
  const face = new Float32Array(n);
  let skinCount = 0;
  if (colorAt && uvs) {
    const votes = new Float32Array(n), totals = new Float32Array(n);
    const uv = [0, 0];
    for (let i = 0; i < count; i++) {
      const g = group[i];
      if (ys[g] < 0.8) continue;
      uvs.getElement(i, uv);
      totals[g] += 1;
      if (isSkin(colorAt(uv[0], uv[1]))) votes[g] += 1;
    }
    for (let g = 0; g < n; g++) face[g] = totals[g] ? (votes[g] / totals[g]) * smoothstep(0.8, 0.84, ys[g]) : 0;
    for (let pass = 0; pass < 3; pass++) {
      const blurred = new Float32Array(n);
      for (let g = 0; g < n; g++) {
        let sum = face[g], k = 1;
        for (const j of neighbors[g]) { sum += face[j]; k++; }
        blurred[g] = sum / k;
      }
      face.set(blurred);
    }
    // 머리 가운데 — 머리(키 0.86 위) 점들의 평균
    const centre = [0, 0, 0];
    let heads = 0;
    for (let i = 0; i < count; i++) {
      a.getElement(i, v);
      if (v[1] > 0.86) { for (let c = 0; c < 3; c++) centre[c] += v[c]; heads++; }
    }
    for (let c = 0; c < 3; c++) centre[c] /= Math.max(1, heads);
    centre[2] -= FACE_BACK;
    const firstOf = new Int32Array(n).fill(-1);
    for (let i = 0; i < count; i++) if (firstOf[group[i]] < 0) firstOf[group[i]] = i;
    for (let g = 0; g < n; g++) {
      const w = face[g] * FACE_FLATTEN;
      if (w <= 0.001) continue;
      if (face[g] > 0.5) skinCount++;
      a.getElement(firstOf[g], v);
      const sphere = [v[0] - centre[0], v[1] - centre[1], v[2] - centre[2]];
      const l = Math.hypot(sphere[0], sphere[1], sphere[2]) || 1;
      for (let c = 0; c < 3; c++) cur[g * 3 + c] = cur[g * 3 + c] * (1 - w) + (sphere[c] / l) * w;
      normalize(cur, g);
    }
  }
  for (let i = 0; i < count; i++) {
    const g = group[i];
    normals.setElement(i, [cur[g * 3], cur[g * 3 + 1], cur[g * 3 + 2]]);
  }
  return { touched, skin: skinCount };
}
