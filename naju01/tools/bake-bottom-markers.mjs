// Meshy 몸체의 옷 표식(_TINT)을 상의(2) · 하의(3) 로 나눠 굽고, 상·하의 경계를 텍스처에 그려진 밑단에 맞춘다.
// 쓰는 법(저장소 뿌리에서)
//   node naju01/tools/bake-bottom-markers.mjs hem [--dry]
//     상·하의 경계만 텍스처 밑단에 맞춘다. 지금 public/models 의 다 입은 몸(both)에 그대로 돌려도 된다 —
//     경계 근처 정점만 고치고 목선 눈금(1.0~2.0)·피부 표식은 건드리지 않는다. 두 번 돌려도 결과가 같다.
//   node naju01/tools/bake-bottom-markers.mjs split
//     상·하의를 처음부터 다시 가른다. 모델을 새로 구운 직후(meshy_mark_tint.py 바로 뒤)에만 돌린다.
//     섬 지우기(meshy_fix_tint_islands.py)·목선(meshy_round_collar.py) 뒤에 돌리면 그 작업을 덮어써 버린다.
//     순서: mark_tint → split → fix_tint_islands → round_collar → soften_hem → hem
//
// 상·하의 색을 따로 고르려면 표식을 둘로 나눠야 한다. 허리 높이로는 못 가른다(티 밑단이 반바지 허리 위로 겹친다).
// split: 다 입은 몸의 옷 정점마다 상의만 입은 몸 · 하의만 입은 몸 중 어느 옷에 더 가까운지로 가른다(몸마다 정점이 1~6 cm 어긋나서).
// hem: split 의 경계는 텍스처에 그려진 밑단보다 1~2 cm 아래에서 삼각형 모서리를 따라 톱니로 간다. 그 띠에서 셰이더의
//   번짐 보정이 반바지 텍셀을 상의 평균색(흰색)으로 끌어올려, 반바지 위에 흰 톱니 테두리가 생겼다(상의가 빨가면 빨간 점).
//   경계에서 5 cm 안의 옷 정점만, 정점 UV 자리의 텍스처 색이 상의 평균색·하의 평균색 중 어느 쪽에 뚜렷이 가까운지로
//   다시 붙인다. 평균색은 그 몸의 상·하의 구역에서 잰다(흰 티·검은 반바지 같은 밝기 규칙을 박아 두지 않는다).
//   경계를 가로지르는 삼각형 안은 셰이더(toonMaterial.ts)가 텍셀 색으로 상·하의를 가른다.
// 툰 셰이더는 3 을 하의 색, 2 를 상의 색으로 칠하고, 1.5 를 넘으면 옷으로 본다.
import { NodeIO } from "@gltf-transform/core";
import sharp from "sharp";

const io = new NodeIO();
const MODEL_DIR = "public/models";
const GENDERS = ["male", "female"];

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

/** 삼각형으로 이웃 정점 목록을 만든다 */
function vertexNeighbors(primitive) {
  const indices = primitive.getIndices();
  const neighbors = Array.from({ length: primitive.getAttribute("POSITION").getCount() }, () => []);
  for (let k = 0; k < indices.getCount(); k += 3) {
    const a = indices.getScalar(k);
    const b = indices.getScalar(k + 1);
    const c = indices.getScalar(k + 2);
    neighbors[a].push(b, c);
    neighbors[b].push(a, c);
    neighbors[c].push(a, b);
  }
  return neighbors;
}

// ── split: 상·하의를 처음부터 가른다 ──
async function splitByGeometry(gender) {
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
    // 목선 눈금(1.5~2.0, meshy_round_collar.py)은 상의의 일부라 그대로 둔다 — 2 로 덮으면 목둘레가 다시 톱니가 된다
    if (tint[0] < 1.99) continue;
    positions.getElement(i, point);
    // 하의 쪽이 확실히 더 가까울 때만 하의(제곱거리 0.45 배 ≈ 거리 0.67 배) — 반반이면 티 밑단에 하의 색 줄이 생긴다
    labels[i] = nearestDistanceSq(bottomGrid, point) < nearestDistanceSq(topGrid, point) * 0.45 ? 3 : 2;
  }
  // 이웃 다수결 두 번 — 경계에 점박이가 안 남게
  const neighbors = vertexNeighbors(body);
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

// ── hem: 상·하의 경계를 텍스처 밑단에 맞춘다 ──
/** 경계에서 이만큼(m) 안의 옷 정점만 다시 본다. 밑단이 표식 경계에서 1~2 cm 어긋나 있다. */
const HEM_BAND = 0.05;
/** 정점 UV 둘레 이 반경(텍셀)의 평균색으로 본다 — 2048 텍스처에서 5×5 텍셀. 텍셀 하나는 JPEG 얼룩에 흔들린다. */
const HEM_WINDOW = 2;
/** 가까운 쪽 평균색까지가 두 평균색 거리의 이 비율 안이고 */
const HEM_NEAR = 0.45;
/** 먼 쪽이 가까운 쪽의 이 배수보다 멀어야 바꾼다. 둘 다 아닌 색(살빛 여백 등)·반반인 색(밑단 바로 위)은 그대로 둔다. */
const HEM_MARGIN = 1.6;
/** 두 평균색이 이보다 가까우면(√선형 공간) 색으로 못 가른다 — 그 몸은 건너뛴다 */
const HEM_MIN_SEPARATION = 0.12;

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const distance3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function readBaseColor(primitive) {
  const image = primitive.getMaterial()?.getBaseColorTexture()?.getImage();
  if (!image) return null;
  const { data, info } = await sharp(Buffer.from(image)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

// GLTF 텍스처는 v = 0 이 이미지 첫 줄이다(three 의 flipY = false 와 같다)
function texelAt(texture, u, v) {
  const column = Math.min(texture.width - 1, Math.floor((u - Math.floor(u)) * texture.width));
  const row = Math.min(texture.height - 1, Math.floor((v - Math.floor(v)) * texture.height));
  return [row, column];
}

/** 정점 UV 둘레 창의 평균색 — 선형으로 평균 내고 √선형으로 돌려준다(셰이더가 견주는 공간) */
function sampleWindow(texture, u, v) {
  const [row, column] = texelAt(texture, u, v);
  const sum = [0, 0, 0];
  let count = 0;
  for (let dy = -HEM_WINDOW; dy <= HEM_WINDOW; dy++)
    for (let dx = -HEM_WINDOW; dx <= HEM_WINDOW; dx++) {
      const r = Math.min(texture.height - 1, Math.max(0, row + dy));
      const c = Math.min(texture.width - 1, Math.max(0, column + dx));
      const at = (r * texture.width + c) * texture.channels;
      for (let k = 0; k < 3; k++) sum[k] += toLinear(texture.data[at + k] / 255);
      count++;
    }
  return sum.map((s) => Math.sqrt(s / count));
}

/**
 * 표식 구역의 평균색. 런타임(toonMaterial.ts computeZoneBases)과 같은 방법 — 정점마다 UV 자리 텍셀 하나를
 * sRGB 로 평균 내고 선형으로 옮긴다. 셰이더와 같은 기준이어야 「어느 쪽 색에 가까운가」가 화면과 맞는다.
 */
function zoneAverage(texture, uv, labels, mark) {
  const sum = [0, 0, 0];
  let count = 0;
  const point = [0, 0];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== mark) continue;
    uv.getElement(i, point);
    const [row, column] = texelAt(texture, point[0], point[1]);
    const at = (row * texture.width + column) * texture.channels;
    for (let k = 0; k < 3; k++) sum[k] += texture.data[at + k] / 255;
    count++;
  }
  return count ? sum.map((s) => Math.sqrt(toLinear(s / count))) : null;
}

async function snapHemToTexture(gender, dry) {
  const file = `${MODEL_DIR}/meshy-both-${gender}.glb`;
  const doc = await io.read(file);
  const body = doc
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .find((primitive) => primitive.getAttribute("_TINT"));
  const texture = body && (await readBaseColor(body));
  if (!texture) {
    console.log(`meshy-both-${gender}: 표식 또는 텍스처가 없어 건너뜀`);
    return;
  }
  const positions = body.getAttribute("POSITION");
  const uv = body.getAttribute("TEXCOORD_0");
  const tints = body.getAttribute("_TINT");
  const count = positions.getCount();
  // 정확히 1·2·3 인 정점만 표식으로 본다 — 목선 눈금(1.0~2.0 사이)은 0 으로 두고 건드리지 않는다.
  // 바꾸는 것은 2·3 뿐이다. 피부(1)는 평균색(살빛 여백을 상의로 오인하지 않게)에만 쓴다.
  const labels = new Int8Array(count);
  const tint = [0];
  for (let i = 0; i < count; i++) {
    tints.getElement(i, tint);
    for (const mark of [1, 2, 3]) if (Math.abs(tint[0] - mark) < 0.01) labels[i] = mark;
  }
  const original = labels.slice();
  const neighbors = vertexNeighbors(body);
  const point = [0, 0, 0];
  const coordinate = [0, 0];
  const pointsOf = (mark) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      if (labels[i] !== mark) continue;
      positions.getElement(i, point);
      out.push([point[0], point[1], point[2]]);
    }
    return out;
  };
  const shown = (c) => c.map((x) => (x * x).toFixed(3)).join(",");
  // 바꾸면 평균색·경계 띠가 조금 달라진다. 더 바뀌지 않을 때까지 되풀이해 두 번 돌려도 같은 결과가 나오게 한다.
  let specks = 0;
  for (let round = 0; round < 6; round++) {
    const skinColor = zoneAverage(texture, uv, labels, 1);
    const topColor = zoneAverage(texture, uv, labels, 2);
    const bottomColor = zoneAverage(texture, uv, labels, 3);
    if (!topColor || !bottomColor) {
      console.log(`meshy-both-${gender}: 상의·하의 표식이 다 있지 않아 건너뜀`);
      return;
    }
    const separation = distance3(topColor, bottomColor);
    if (round === 0) {
      console.log(
        `meshy-both-${gender}: 평균색(선형) 상의 ${shown(topColor)} · 하의 ${shown(bottomColor)}` +
          ` · 피부 ${skinColor ? shown(skinColor) : "-"} · 상·하의 거리(√선형) ${separation.toFixed(3)}`,
      );
    }
    if (separation < HEM_MIN_SEPARATION) {
      console.log(`  두 색이 너무 가까워 색으로 못 가른다 — 건너뜀`);
      return;
    }

    // 1) 경계 띠 — 반대 표식 정점이 HEM_BAND 안에 있는 옷 정점
    const grids = { 2: buildGrid(pointsOf(3)), 3: buildGrid(pointsOf(2)) };
    const band = [];
    for (let i = 0; i < count; i++) {
      if (labels[i] !== 2 && labels[i] !== 3) continue;
      positions.getElement(i, point);
      if (nearestDistanceSq(grids[labels[i]], point) < HEM_BAND ** 2) band.push(i);
    }

    // 2) 띠 안에서 텍스처 색이 뚜렷이 반대쪽 평균색이면 바꾼다. 살빛에 더 가까운 색(아틀라스 여백)은 판단하지 않는다.
    const next = labels.slice();
    for (const i of band) {
      uv.getElement(i, coordinate);
      const seen = sampleWindow(texture, coordinate[0], coordinate[1]);
      const toTop = distance3(seen, topColor);
      const toBottom = distance3(seen, bottomColor);
      const near = Math.min(toTop, toBottom);
      const far = Math.max(toTop, toBottom);
      if (near > separation * HEM_NEAR || far < near * HEM_MARGIN) continue;
      if (skinColor && distance3(seen, skinColor) < near * HEM_MARGIN) continue;
      next[i] = toTop < toBottom ? 2 : 3;
    }

    // 3) 바뀐 정점 중 이웃에 같은 표식이 하나도 없으면(외딴 점) 되돌린다 — 텍스처 얼룩 하나로 점박이가 생기지 않게
    let changes = 0;
    for (const i of band) {
      if (next[i] === labels[i]) continue;
      if (!neighbors[i].some((j) => next[j] === next[i])) {
        next[i] = labels[i];
        specks++;
      } else changes++;
    }
    labels.set(next);
    if (!changes) break;
  }

  const changed = { "2→3": 0, "3→2": 0 };
  const heights = new Map();
  for (let i = 0; i < count; i++) {
    if (labels[i] === original[i]) continue;
    changed[labels[i] === 3 ? "2→3" : "3→2"]++;
    positions.getElement(i, point);
    const bucket = (Math.round(point[1] / 0.05) * 0.05).toFixed(2);
    heights.set(bucket, (heights.get(bucket) ?? 0) + 1);
    tints.setElement(i, [labels[i]]);
  }
  console.log(`  상의→하의 ${changed["2→3"]} · 하의→상의 ${changed["3→2"]} · 외딴 점이라 안 바꾼 것 ${specks}`);
  console.log(
    `  바뀐 높이(5 cm 칸, m): ${[...heights]
      .sort()
      .map(([h, n]) => `${h}:${n}`)
      .join(" ")}`,
  );
  if (dry) return;
  if (changed["2→3"] + changed["3→2"] === 0) {
    console.log("  바뀐 것이 없어 파일을 그대로 둔다");
    return;
  }
  await io.write(file, doc);
}

const [mode, flag] = process.argv.slice(2);
if (mode === "split") {
  for (const gender of GENDERS) await splitByGeometry(gender);
} else if (mode === "hem") {
  for (const gender of GENDERS) await snapHemToTexture(gender, flag === "--dry");
} else {
  console.log("쓰는 법: node naju01/tools/bake-bottom-markers.mjs hem [--dry] | split   (파일 머리말 참고)");
  process.exitCode = 1;
}
