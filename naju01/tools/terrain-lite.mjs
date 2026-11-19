// terrain-lite.mjs — 구운 땅(terrain.glb)의 가벼운 판(11/18).
// node naju01/tools/terrain-lite.mjs <naju01/assets/terrain.glb> <출력.glb> [오차 한계 m=0.012] [목표 삼각형=0(한계까지)]
//
// 땅은 320×200 칸 고른 격자(12.8만 면)라 평평한 강변 · 길도 비탈과 같은 밀도다. 그래픽 카드를 못 쓰는 PC 는 이 한 장이
// 화면 삼각형의 5분의 1 이었다. 높이가 오차 한계 안에서 유지되는 만큼만 합친다 — 걷기 · 소품 놓기는 높이표(terrain-height.bin)를
// 읽으므로 그대로다. meshopt 의 오차 한계는 면에 수직인 거리라 비탈에서는 높이 차가 그보다 크다 — 그래서 만든 뒤에 원본 격자점마다
// 수직 높이 차를 따로 재서(verticalError) 걷는 땅에서 LIMIT_CM 을 넘으면 파일을 쓰지 않는다.
//   11/18 실측: 한계 0.012 → 4.2만 면 · 걷는 땅 최대 3.2 cm · 비탈 포함 5.9 cm / 한계 0.02 → 2.9만 면 · 3.8 cm · 9.3 cm(쓰지 않음).
// 정점 색(길 · 흙 얼룩)과 법선(툰 음영)을 같이 재서 색 경계 · 능선은 남긴다. 가장자리는 묶어 둔다(옆 지형과 벌어지지 않게).
// 남는 정점은 원래 정점의 부분집합이라 위치 · 법선 · 색 · UV 값은 그대로다.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [, , inp, out, errS = '0.012', goalS = '0'] = process.argv;
if (!inp || !out) { console.error('쓰는 법: node naju01/tools/terrain-lite.mjs <입력.glb> <출력.glb> [오차 m] [목표 삼각형]'); process.exit(1); }
const NORMAL_WEIGHT = Number(process.env.NORMAL_WEIGHT ?? 0.5);
const COLOR_WEIGHT = Number(process.env.COLOR_WEIGHT ?? 1);
/** 걷는 땅으로 치는 기울기(법선 y) · 그 땅에서 허용하는 높이 차(cm) — 넘으면 파일을 쓰지 않고 끝낸다 */
const WALKABLE_NY = 0.7;
const LIMIT_CM = Number(process.env.LIMIT_CM ?? 3.5);
/** 원본 정점마다 줄인 메시를 수직으로 내려 본 높이 차(m). 삼각형을 xz 칸(0.5 m)에 담아 찾는다 */
function verticalError(positions, indices, normals) {
  const CELL = 0.5; const cells = new Map(); const key = (i, j) => i * 100003 + j;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const i0 = Math.floor(Math.min(positions[a], positions[b], positions[c]) / CELL), i1 = Math.floor(Math.max(positions[a], positions[b], positions[c]) / CELL);
    const j0 = Math.floor(Math.min(positions[a + 2], positions[b + 2], positions[c + 2]) / CELL), j1 = Math.floor(Math.max(positions[a + 2], positions[b + 2], positions[c + 2]) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); let list = cells.get(k); if (!list) cells.set(k, (list = [])); list.push(t); }
  }
  const out = { max: 0, walkMax: 0, walkOver: 0, walkCount: 0 }; const n = [0, 0, 0];
  for (let v = 0; v < positions.length / 3; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2]; let best = Infinity;
    for (const t of cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
      const d = (positions[b + 2] - positions[c + 2]) * (positions[a] - positions[c]) + (positions[c] - positions[b]) * (positions[a + 2] - positions[c + 2]);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((positions[b + 2] - positions[c + 2]) * (x - positions[c]) + (positions[c] - positions[b]) * (z - positions[c + 2])) / d;
      const w = ((positions[c + 2] - positions[a + 2]) * (x - positions[c]) + (positions[a] - positions[c]) * (z - positions[c + 2])) / d;
      if (u < -1e-6 || w < -1e-6 || u + w > 1 + 1e-6) continue;
      const h = u * positions[a + 1] + w * positions[b + 1] + (1 - u - w) * positions[c + 1];
      if (Math.abs(h - y) < Math.abs(best)) best = h - y; // 겹친 면(벼랑 턱)은 가장 가까운 것
    }
    if (!Number.isFinite(best)) continue;
    const e = Math.abs(best); out.max = Math.max(out.max, e); normals.getElement(v, n);
    if (n[1] >= WALKABLE_NY) { out.walkCount++; out.walkMax = Math.max(out.walkMax, e); if (e * 100 > LIMIT_CM) out.walkOver++; }
  }
  return out;
}
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
for (const p of doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())) {
  const pos = p.getAttribute('POSITION'); const nor = p.getAttribute('NORMAL'); const col = p.getAttribute('COLOR_0');
  const n = pos.getCount(); const positions = new Float32Array(pos.getArray()); const attrs = new Float32Array(n * 6); const v = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) { nor.getElement(i, v); attrs.set([v[0], v[1], v[2]], i * 6); col.getElement(i, v); attrs.set([v[0], v[1], v[2]], i * 6 + 3); } // getElement 는 정규화된 0~1 색을 준다
  const indices = new Uint32Array(p.getIndices().getArray());
  const [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attrs, 6, [NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT, COLOR_WEIGHT, COLOR_WEIGHT, COLOR_WEIGHT], null, Number(goalS) * 3, Number(errS), ['LockBorder', 'ErrorAbsolute']);
  // ── 검증 — 원본 격자점마다 가벼운 판을 수직으로 내려 본 높이 차. meshopt 의 오차는 면에 수직인 거리라 비탈에서는 높이 차가 더 크다 ──
  const report = verticalError(positions, simplified, nor);
  console.log(`  높이 차(수직) — 걷는 땅(법선 y ≥ ${WALKABLE_NY}) 최대 ${(report.walkMax * 100).toFixed(1)} cm · ${LIMIT_CM} cm 넘는 점 ${report.walkOver} / ${report.walkCount}  |  비탈 포함 전체 최대 ${(report.max * 100).toFixed(1)} cm`);
  if (report.walkMax * 100 > LIMIT_CM) { console.error(`  ✗ 걷는 땅의 높이 차가 ${LIMIT_CM} cm 를 넘는다 — 오차 한계를 낮춰 다시 만든다`); process.exit(2); }
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(simplified).setBuffer(doc.getRoot().listBuffers()[0]));
  compactPrimitive(p);
  console.log(out.split('/').pop(), `삼각형 ${indices.length / 3} → ${simplified.length / 3} · 정점 ${n} → ${p.getAttribute('POSITION').getCount()} · 오차 ${error.toFixed(4)} m`);
}
await doc.transform(prune());
await io.write(out, doc);
