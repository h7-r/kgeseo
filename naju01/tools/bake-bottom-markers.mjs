// Meshy 몸체의 옷 표식(_TINT)을 상의(2) · 하의(3) 로 나눠 굽는다.
// 쓰는 법  node naju01/tools/bake-bottom-markers.mjs   (저장소 뿌리에서)
//   여러 번 돌려도 결과가 같다. 모델을 새로 구운 뒤(meshy_mark_tint.py) 다시 돌려야 한다.
//
// 상·하의 색을 따로 고르려면 표식을 둘로 나눠야 한다. 허리 높이로는 못 가른다(티 밑단이 반바지 허리 위로 겹친다).
// 다 입은 몸의 옷 정점마다 상의만 입은 몸 · 하의만 입은 몸 중 어느 옷에 더 가까운지로 가른다(몸마다 정점이 1~6 cm 어긋나서).
// 툰 셰이더는 3 을 하의 색, 2 를 상의 색으로 칠하고, 1.5 를 넘으면 옷으로 본다.
import { NodeIO } from "@gltf-transform/core";

const io = new NodeIO();
const MODEL_DIR = "public/models";

const firstPrimitive = (doc) => doc.getRoot().listMeshes()[0].listPrimitives()[0];

function clothVertices(primitive) {
  const positions = primitive.getAttribute("POSITION");
  const tints = primitive.getAttribute("_TINT");
  const points = [];
  const point = [0, 0, 0];
  const tint = [0];
  for (let i = 0; i < positions.getCount(); i++) {
    tints.getElement(i, tint);
    if (tint[0] > 1.5) {
      positions.getElement(i, point);
      points.push([point[0], point[1], point[2]]);
    }
  }
  return points;
}

// 칸 해시 — 15,000 × 10,000 을 다 견주지 않고 이웃 칸만 본다
const CELL_SIZE = 0.03;
function buildGrid(points) {
  const grid = new Map();
  for (const p of points) {
    const key = `${Math.floor(p[0] / CELL_SIZE)},${Math.floor(p[1] / CELL_SIZE)},${Math.floor(p[2] / CELL_SIZE)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(p);
  }
  return grid;
}
// 가장 가까운 거리(제곱) — 가까운 칸부터 넓혀 가며 찾는다
function nearestDistanceSq(grid, p) {
  const cx = Math.floor(p[0] / CELL_SIZE);
  const cy = Math.floor(p[1] / CELL_SIZE);
  const cz = Math.floor(p[2] / CELL_SIZE);
  let min = Infinity;
  for (let r = 1; r <= 6; r++) {
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++)
        for (let z = cz - r; z <= cz + r; z++) {
          const list = grid.get(`${x},${y},${z}`);
          if (!list) continue;
          for (const q of list) {
            const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
            if (d < min) min = d;
          }
        }
    // 찾은 거리가 이번 테두리 안쪽이면 더 넓혀도 더 가까운 건 없다
    if (min < (r * CELL_SIZE) ** 2) break;
  }
  return min;
}

for (const gender of ["male", "female"]) {
  // 1) 상의만 · 하의만 입은 몸의 옷 정점
  const topGrid = buildGrid(clothVertices(firstPrimitive(await io.read(`${MODEL_DIR}/meshy-top-${gender}.glb`))));
  const bottomGrid = buildGrid(clothVertices(firstPrimitive(await io.read(`${MODEL_DIR}/meshy-bottom-${gender}.glb`))));

  // 2) 다 입은 몸 — 옷 정점을 더 가까운 쪽으로 가른다
  const doc = await io.read(`${MODEL_DIR}/meshy-both-${gender}.glb`);
  const body = firstPrimitive(doc);
  const positions = body.getAttribute("POSITION");
  const tints = body.getAttribute("_TINT");
  const point = [0, 0, 0];
  const tint = [0];
  const labels = new Int8Array(positions.getCount()); // 0 = 옷 아님 · 2 = 상의 · 3 = 하의
  for (let i = 0; i < positions.getCount(); i++) {
    tints.getElement(i, tint);
    if (tint[0] < 1.5) continue;
    positions.getElement(i, point);
    // 하의 쪽이 확실히 더 가까울 때만 하의(제곱거리 0.45 배 ≈ 거리 0.67 배) — 반반이면 티 밑단에 하의 색 줄이 생긴다
    labels[i] = nearestDistanceSq(bottomGrid, point) < nearestDistanceSq(topGrid, point) * 0.45 ? 3 : 2;
  }
  // 이웃 다수결 두 번 — 경계에 점박이가 안 남게
  const indices = body.getIndices();
  const neighbors = Array.from({ length: positions.getCount() }, () => []);
  for (let k = 0; k < indices.getCount(); k += 3) {
    const a = indices.getScalar(k);
    const b = indices.getScalar(k + 1);
    const c = indices.getScalar(k + 2);
    neighbors[a].push(b, c);
    neighbors[b].push(a, c);
    neighbors[c].push(a, b);
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = labels.slice();
    for (let i = 0; i < labels.length; i++) {
      if (!labels[i]) continue;
      let tops = 0;
      let bottoms = 0;
      for (const j of neighbors[i]) {
        if (labels[j] === 2) tops++;
        else if (labels[j] === 3) bottoms++;
      }
      if (labels[i] === 2 && bottoms > tops * 2) next[i] = 3;
      else if (labels[i] === 3 && tops > bottoms * 2) next[i] = 2;
    }
    labels.set(next);
  }
  let tops = 0;
  let bottoms = 0;
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    tints.setElement(i, [labels[i]]);
    if (labels[i] === 2) tops++;
    else bottoms++;
  }
  await io.write(`${MODEL_DIR}/meshy-both-${gender}.glb`, doc);
  console.log(`meshy-both-${gender}: 상의 ${tops} · 하의 ${bottoms}`);

  // 3) 하의만 입은 몸 — 옷은 전부 하의
  const bottomDoc = await io.read(`${MODEL_DIR}/meshy-bottom-${gender}.glb`);
  const bottomTints = firstPrimitive(bottomDoc).getAttribute("_TINT");
  let relabeled = 0;
  for (let i = 0; i < bottomTints.getCount(); i++) {
    bottomTints.getElement(i, tint);
    if (tint[0] > 1.5 && tint[0] < 2.5) {
      bottomTints.setElement(i, [3]);
      relabeled++;
    }
  }
  await io.write(`${MODEL_DIR}/meshy-bottom-${gender}.glb`, bottomDoc);
  console.log(`meshy-bottom-${gender}: 하의 ${relabeled}`);
}
