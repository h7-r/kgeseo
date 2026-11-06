// 긴 머리(헤어 파츠 variant 1)를 몸에 맞춰 다듬는다 — 숱을 줄이고, 몸·귀를 뚫지 않게 띄우고, 아래쪽 머리칼이 몸통을 따라가게 묶는다.
// 쓰는 법(저장소 뿌리에서)  node naju01/tools/fit-long-hair.mjs [--force] [--dry]
//   몸 GLB 8개(meshy-{base,top,bottom,both}-{female,male}.glb)의 긴 머리만 고친다. 단발·짧은 머리는 그대로다.
//   한 번 고친 머리에는 노드 extras 에 longHairFit 판을 적어 두고 다시 돌려도 건너뛴다(--force 면 또 고친다 — 숱이 또 준다).
//   모델을 새로 구운 뒤(meshy_build_looks.sh) 표식 굽기·목선 손질까지 끝낸 다음 마지막에 돌린다.
//
// 왜: 긴 머리는 다른 Meshy 캐릭터에서 떼어 와 우리 두피에 맞춘 것이라(meshy_extract_hair.py) 몸과 따로 논다.
//   - 머리 정점이 전부 head 뼈에 100% 묶여(meshy_add_hair.py) 등·어깨에 닿는 머리칼이 몸통을 못 따라가고 파고든다.
//     대기·걷기 자세에서 여성 긴 머리 정점 약 15~17%가 몸 안에 있었다(등판에 머리끝이 잘린 듯 보이던 것).
//   - 원본 캐릭터의 귀 자리를 비워 둔 채 옮겨 와 우리 귀가 머리카락 밖으로 삐져나온다.
//   - 숱이 많아 머리가 크다.
// 어떻게: 정점마다 따로 옮기면 머리칼 겹이 서로 파고들어 지저분해진다(첫 시도). 그래서 위치만으로 정해지는 매끈한 변형을 쓴다.
//   - 머리 높이: 머리 중심에서 뻗는 방향마다 몸(두피·귀)이 가장 멀리 나온 거리 R 을 재 두고(넓게 흐려 둔다),
//     그 방향의 머리칼 거리 r 을 R + h(r − R) 로 바꾼다. h 는 단조 증가라 같은 방향의 겹 순서가 그대로다.
//     멀리 뜬 머리칼은 SLIM 배로 당겨지고(숱), 안쪽에 묻힌 머리칼은 CLEAR 밖으로 나온다(귀를 덮는다).
//   - 어깨 아래: 척추 축에서 수평으로 뻗는 방향마다 몸통(팔 제외)의 거리로 같은 변형을 한다. 옆으로 퍼진 머리칼은
//     팔이 내려오는 자리라 가로로 SQUEEZE 배만큼 좁힌다.
//   - 목 높이에서 둘을 섞는다. 끝으로 몸 표면에서 CLEAR 보다 가까운 정점만 조금 밀어낸다.
//   - 스킨: head 뼈 위는 head, 목 높이는 neck_01, 쇄골 아래는 spine_03 로 높이에 따라 매끈하게 넘긴다(팔·쇄골은 안 쓴다).
// 정점 수·UV·법선·모프(체형) 차이값은 그대로다. 자리와 JOINTS_0·WEIGHTS_0 만 바뀐다.
import { NodeIO } from "@gltf-transform/core";

const io = new NodeIO();
const MODEL_DIR = "public/models";
const LOOKS = ["base", "top", "bottom", "both"];
const LONG_HAIR_VARIANT = 1;
const FIT_KEY = "longHairFit";
const FIT_VERSION = 2;

/** 몸에서 띄워진 거리를 이 배로 줄인다(1 = 그대로). 여성 긴 머리는 숱이 특히 많다. */
const SLIM = { female: 0.4, male: 0.55 };
/** 어깨 아래 머리칼의 가로 폭을 이 배로 좁힌다(팔이 내려오는 자리를 비운다) */
const SQUEEZE = { female: 0.7, male: 0.85 };
/** 몸·두피에서 최소한 이만큼(m) 띄운다 */
const CLEAR_HEAD = 0.003;
const CLEAR_BODY = 0.008;
/** h(u) 의 무릎 폭(m) — 이 폭 안에서 「밀어내기」가 「당기기」로 부드럽게 넘어간다 */
const KNEE = 0.004;
/** 귀 접기에서 두개골을 깎아 낼 반경(2° 칸) — 귀보다 넓어야 한다 */
const EAR_OPEN = 8;
/** 몸 모프 이름 — 런타임(useChibiMaterials.ts)이 긴 머리일 때 1 로 켠다 */
const EAR_TUCK = "earTuck";
/** 몸통 뼈 — 아래쪽 머리칼이 따라갈 뼈 */
const TORSO_BONE = "spine_03";

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const dry = args.has("--dry");

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** 몸 표면에서 u 만큼 떨어진 머리칼을 어디로 옮길지 — u 가 크면 clear + (u − clear)·slim, 몸 안(u < 0)이면 clear 쪽으로 모인다 */
const offsetMap = (u, clear, slim) => clear + slim * KNEE * Math.log1p(Math.exp((u - clear) / KNEE));

/** 같은 자리 정점을 하나로 묶는다 — GLB 는 UV 이음매마다 정점을 쪼개 두어, 따로 옮기면 머리칼에 틈이 난다 */
function weld(positions) {
  const count = positions.length / 3;
  const keyToId = new Map();
  const ids = new Int32Array(count);
  const points = [];
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(positions[i * 3] * 1e5)},${Math.round(positions[i * 3 + 1] * 1e5)},${Math.round(positions[i * 3 + 2] * 1e5)}`;
    let id = keyToId.get(key);
    if (id === undefined) {
      id = points.length / 3;
      keyToId.set(key, id);
      points.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
    ids[i] = id;
  }
  return { ids, points: new Float64Array(points), count: points.length / 3 };
}

/** 칸 해시로 가장 가까운 점 */
function makeNearest(points, cell = 0.02) {
  const grid = new Map();
  const count = points.length / 3;
  for (let i = 0; i < count; i++) {
    const key = `${Math.floor(points[i * 3] / cell)},${Math.floor(points[i * 3 + 1] / cell)},${Math.floor(points[i * 3 + 2] / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  return (x, y, z) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    let best = -1;
    let bestDistance = Infinity;
    for (let r = 0; r <= 10; r++) {
      for (let a = cx - r; a <= cx + r; a++)
        for (let b = cy - r; b <= cy + r; b++)
          for (let c = cz - r; c <= cz + r; c++) {
            if (Math.max(Math.abs(a - cx), Math.abs(b - cy), Math.abs(c - cz)) !== r) continue;
            const list = grid.get(`${a},${b},${c}`);
            if (!list) continue;
            for (const i of list) {
              const d = (points[i * 3] - x) ** 2 + (points[i * 3 + 1] - y) ** 2 + (points[i * 3 + 2] - z) ** 2;
              if (d < bestDistance) {
                bestDistance = d;
                best = i;
              }
            }
          }
      if (best >= 0 && Math.sqrt(bestDistance) < r * cell) break;
    }
    return best;
  };
}

/** 쉴 때(bind) 자세의 뼈 자리 — inverseBindMatrices 를 뒤집은 이동 성분 */
function bindJointPositions(skin) {
  const inverse = skin.getInverseBindMatrices().getArray();
  const names = skin.listJoints().map((joint) => joint.getName());
  const out = {};
  names.forEach((name, k) => {
    const m = inverse.subarray(k * 16, k * 16 + 16);
    // 열 우선 4×4 [R t] 의 역행렬 이동 = −R⁻¹·t, R = 배율 × 회전이라 R⁻¹ = Rᵀ / 배율²
    const scale2 = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
    const [tx, ty, tz] = [m[12], m[13], m[14]];
    out[name] = [
      -(m[0] * tx + m[1] * ty + m[2] * tz) / scale2,
      -(m[4] * tx + m[5] * ty + m[6] * tz) / scale2,
      -(m[8] * tx + m[9] * ty + m[10] * tz) / scale2,
    ];
  });
  return { names, positions: out };
}

// 방향·높이별 거리표(행 × 열, 열은 둘레라 감긴다) 손질
const cellAt = (rows, cols, wrap) => (r, c) => {
  if (r < 0 || r >= rows) return null;
  if (wrap) c = (c + cols) % cols;
  else if (c < 0 || c >= cols) return null;
  return r * cols + c;
};

/** 빈 칸(0)을 이웃 평균으로 채운다 */
function fillEmpty(table, rows, cols, wrap) {
  const at = cellAt(rows, cols, wrap);
  let current = Float64Array.from(table);
  for (let pass = 0; pass < rows + cols; pass++) {
    let empty = 0;
    const next = Float64Array.from(current);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (current[r * cols + c] > 0) continue;
        let sum = 0;
        let count = 0;
        for (const [dr, dc] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const k = at(r + dr, c + dc);
          if (k !== null && current[k] > 0) {
            sum += current[k];
            count++;
          }
        }
        if (count) next[r * cols + c] = sum / count;
        else empty++;
      }
    current = next;
    if (!empty) break;
  }
  return current;
}

/** 반경 안 칸들을 reduce 로 모은다(Math.max = 넓히기, Math.min = 깎기, 평균 = 흐리기) */
function rankFilter(table, rows, cols, wrap, radius, reduce) {
  const at = cellAt(rows, cols, wrap);
  const out = new Float64Array(table.length);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const values = [];
      for (let dr = -radius; dr <= radius; dr++)
        for (let dc = -radius; dc <= radius; dc++) {
          const k = at(r + dr, c + dc);
          if (k !== null) values.push(table[k]);
        }
      out[r * cols + c] = reduce(...values);
    }
  return out;
}
const mean = (...values) => values.reduce((a, b) => a + b, 0) / values.length;

/** 거리표를 매끈하게 — 빈 칸을 채우고 넓힌(max) 뒤 흐린다(평균). 넓힌 뒤 흐려서 튀어나온 곳도 원래 값 아래로 거의 안 내려간다. */
function smoothReach(table, rows, cols, wrap, spread, blur) {
  let current = rankFilter(fillEmpty(table, rows, cols, wrap), rows, cols, wrap, spread, Math.max);
  for (let pass = 0; pass < 2; pass++) current = rankFilter(current, rows, cols, wrap, blur, mean);
  return current;
}

function fitLongHair(doc, gender, label) {
  const nodes = doc.getRoot().listNodes();
  const bodyNode = nodes.find((node) => node.getExtras()?.slot === "body");
  const hairNode = nodes.find(
    (node) => node.getExtras()?.slot === "hair" && node.getExtras()?.variant === LONG_HAIR_VARIANT,
  );
  if (!bodyNode || !hairNode) return (console.log(`${label}: 몸 또는 긴 머리가 없어 건너뜀`), false);
  if ((hairNode.getExtras()[FIT_KEY] ?? 0) >= FIT_VERSION && !force)
    return (console.log(`${label}: 이미 다듬은 머리라 건너뜀(--force 로 또 다듬기)`), false);

  const { names, positions: bones } = bindJointPositions(bodyNode.getSkin());
  const headY = bones.head[1];
  const neckY = bones.neck_01[1];
  const clavicleY = (bones.clavicle_l[1] + bones.clavicle_r[1]) / 2;
  const jointOf = (name) => names.indexOf(name);

  // ── 몸 ──
  const body = bodyNode.getMesh().listPrimitives()[0];
  const bodyPositions = body.getAttribute("POSITION").getArray();
  const bodyNormalsRaw = body.getAttribute("NORMAL").getArray();
  const bodyJoints = body.getAttribute("JOINTS_0").getArray();
  const bodyWeights = body.getAttribute("WEIGHTS_0").getArray();
  const bodyWeld = weld(bodyPositions);
  const B = bodyWeld.points;
  const bodyNormals = new Float64Array(bodyWeld.count * 3);
  for (let i = 0; i < bodyPositions.length / 3; i++)
    for (let k = 0; k < 3; k++) bodyNormals[bodyWeld.ids[i] * 3 + k] += bodyNormalsRaw[i * 3 + k];
  for (let i = 0; i < bodyWeld.count; i++) {
    const l = Math.hypot(bodyNormals[i * 3], bodyNormals[i * 3 + 1], bodyNormals[i * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) bodyNormals[i * 3 + k] /= l;
  }
  const bodySource = new Int32Array(bodyWeld.count);
  for (let i = bodyPositions.length / 3 - 1; i >= 0; i--) bodySource[bodyWeld.ids[i]] = i;
  const weightOf = (i, joint) => {
    let sum = 0;
    for (let k = 0; k < 4; k++) if (bodyJoints[i * 4 + k] === joint) sum += bodyWeights[i * 4 + k];
    return sum;
  };
  const armJoints = new Set(
    names.flatMap((name, k) =>
      /upperarm|lowerarm|hand|index|middle|ring|pinky|thumb|elbow|shoulderAttach|prop/.test(name) ? [k] : [],
    ),
  );
  const armWeightOf = (i) => {
    let sum = 0;
    for (let k = 0; k < 4; k++) if (armJoints.has(bodyJoints[i * 4 + k])) sum += bodyWeights[i * 4 + k];
    return sum;
  };
  const isHead = new Uint8Array(bodyWeld.count);
  const isArm = new Uint8Array(bodyWeld.count);
  for (let i = 0; i < bodyWeld.count; i++) {
    isHead[i] = weightOf(bodySource[i], jointOf("head")) > 0.5 ? 1 : 0;
    isArm[i] = armWeightOf(bodySource[i]) > 0.3 ? 1 : 0;
  }
  // ── 머리 높이: 머리 중심에서 방향마다 두피·귀가 나온 거리(2° 칸) ──
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < bodyWeld.count; i++) {
    if (!isHead[i] || B[i * 3 + 1] < headY + 0.02) continue;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], B[i * 3 + k]);
      hi[k] = Math.max(hi[k], B[i * 3 + k]);
    }
  }
  const centre = lo.map((v, k) => (v + hi[k]) / 2);
  const BIN = Math.PI / 90;
  const AZ = 180;
  const EL = 90;
  const sphereBin = (dx, dy, dz) => {
    const r = Math.hypot(dx, dy, dz);
    const az = Math.floor((Math.atan2(dx, dz) + Math.PI) / BIN) % AZ;
    const el = Math.max(0, Math.min(EL - 1, Math.floor((Math.asin(dy / r) + Math.PI / 2) / BIN)));
    return [el * AZ + az, r];
  };
  const headRawOf = () => {
    const table = new Float64Array(AZ * EL);
    for (let i = 0; i < bodyWeld.count; i++) {
      if (!isHead[i] || B[i * 3 + 1] < neckY) continue;
      const [bin, r] = sphereBin(B[i * 3] - centre[0], B[i * 3 + 1] - centre[1], B[i * 3 + 2] - centre[2]);
      table[bin] = Math.max(table[bin], r);
    }
    return table;
  };

  // ── 귀 접기(몸 모프 earTuck): 긴 머리를 고르면 귀를 두개골 쪽으로 눌러 머리칼 밑에 숨긴다 ──
  // 두개골 = 방향별 거리표의 열림(최솟값 → 최댓값, 반경 16°) — 귀처럼 좁게 튀어나온 것만 깎인다.
  // 옆머리 창(옆 ±45°, 아래 50°~위 25°) 안에서 두개골보다 튀어나온 머리 정점을 두개골 3 mm 안으로 민다.
  const skull = rankFilter(
    rankFilter(fillEmpty(headRawOf(), EL, AZ, true), EL, AZ, true, EAR_OPEN, Math.min),
    EL,
    AZ,
    true,
    EAR_OPEN,
    Math.max,
  );
  const tuck = new Float64Array(bodyWeld.count * 3);
  let earCount = 0;
  for (let i = 0; i < bodyWeld.count; i++) {
    if (!isHead[i]) continue;
    const d = [B[i * 3] - centre[0], B[i * 3 + 1] - centre[1], B[i * 3 + 2] - centre[2]];
    const [bin, r] = sphereBin(...d);
    const azimuth = Math.atan2(d[0], d[2]);
    const elevation = Math.asin(d[1] / r);
    if (Math.abs(Math.sin(azimuth)) < Math.SQRT1_2 || elevation < -0.87 || elevation > 0.44) continue;
    const share = smoothstep(skull[bin] + 0.002, skull[bin] + 0.008, r);
    if (share <= 0) continue;
    const move = (skull[bin] - 0.003 - r) * share;
    for (let k = 0; k < 3; k++) tuck[i * 3 + k] = (d[k] / r) * move;
    earCount++;
  }
  for (let i = 0; i < bodyWeld.count * 3; i++) B[i] += tuck[i];
  const headRaw = headRawOf();
  // 접힌 귀 정점은 법선이 엉망이고 두개골 안에 묻혀 있어 「가장 가까운 몸」 후보에서 뺀다(먼 곳으로 치운 사본)
  const searchable = Float64Array.from(B);
  for (let i = 0; i < bodyWeld.count; i++)
    if (tuck[i * 3] || tuck[i * 3 + 1] || tuck[i * 3 + 2]) searchable[i * 3 + 1] = -100;
  const nearestBody = makeNearest(searchable);
  const signedDistance = (x, y, z, b) =>
    (x - B[b * 3]) * bodyNormals[b * 3] +
    (y - B[b * 3 + 1]) * bodyNormals[b * 3 + 1] +
    (z - B[b * 3 + 2]) * bodyNormals[b * 3 + 2];
  // 넓히기 ±4°, 흐리기 ±4° 두 번
  const headReach = smoothReach(headRaw, EL, AZ, true, 2, 2);

  // ── 어깨 아래: 척추 축에서 수평 방향마다 몸통(팔 제외)이 나온 거리(3° × 1 cm 칸) ──
  const spineNames = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head"];
  const spine = spineNames.map((name) => bones[name]).sort((a, b) => a[1] - b[1]);
  const axisZ = (y) => {
    if (y <= spine[0][1]) return spine[0][2];
    for (let k = 1; k < spine.length; k++)
      if (y <= spine[k][1]) {
        const t = (y - spine[k - 1][1]) / (spine[k][1] - spine[k - 1][1]);
        return spine[k - 1][2] + t * (spine[k][2] - spine[k - 1][2]);
      }
    return spine[spine.length - 1][2];
  };
  const THETA = 120;
  const Y0 = 0.6;
  const Y1 = headY + 0.05;
  const ROWS = Math.ceil((Y1 - Y0) / 0.01);
  const cylBin = (x, y, z) => {
    const dz = z - axisZ(y);
    const t = Math.floor((Math.atan2(x, dz) + Math.PI) / ((2 * Math.PI) / THETA)) % THETA;
    const row = Math.max(0, Math.min(ROWS - 1, Math.floor((y - Y0) / 0.01)));
    return [row * THETA + t, Math.hypot(x, dz)];
  };
  const torsoRaw = new Float64Array(THETA * ROWS);
  for (let i = 0; i < bodyWeld.count; i++) {
    const y = B[i * 3 + 1];
    if (isArm[i] || y < Y0 || y > Y1) continue;
    const [bin, d] = cylBin(B[i * 3], y, B[i * 3 + 2]);
    torsoRaw[bin] = Math.max(torsoRaw[bin], d);
  }
  const torsoReach = smoothReach(torsoRaw, ROWS, THETA, true, 2, 3);

  // ── 머리 ──
  const hair = hairNode.getMesh().listPrimitives()[0];
  const hairPositionAttr = hair.getAttribute("POSITION");
  const hairPositions = hairPositionAttr.getArray();
  const hairWeld = weld(hairPositions);
  const n = hairWeld.count;
  const original = Float64Array.from(hairWeld.points);
  const p = new Float64Array(n * 3);
  const slim = SLIM[gender];
  const squeeze = SQUEEZE[gender];
  for (let i = 0; i < n; i++) {
    const [x, y, z] = [original[i * 3], original[i * 3 + 1], original[i * 3 + 2]];
    // 머리 높이 변형
    const d = [x - centre[0], y - centre[1], z - centre[2]];
    const [hb, r] = sphereBin(...d);
    const headScale = r > 1e-6 ? (headReach[hb] + offsetMap(r - headReach[hb], CLEAR_HEAD, slim)) / r : 1;
    const headMoved = [centre[0] + d[0] * headScale, centre[1] + d[1] * headScale, centre[2] + d[2] * headScale];
    // 어깨 아래 변형 — 가로로 좁힌 뒤 몸통 기준으로 당기거나 민다
    const narrow = 1 - (1 - squeeze) * smoothstep(clavicleY + 0.03, clavicleY - 0.07, y);
    const nx = x * narrow;
    const az = axisZ(y);
    const [tb, dist] = cylBin(nx, y, z);
    const lowScale = dist > 1e-6 ? (torsoReach[tb] + offsetMap(dist - torsoReach[tb], CLEAR_BODY, slim)) / dist : 1;
    const lowMoved = [nx * lowScale, y, az + (z - az) * lowScale];
    const blend = smoothstep(clavicleY, headY, y);
    for (let k = 0; k < 3; k++) p[i * 3 + k] = lowMoved[k] + (headMoved[k] - lowMoved[k]) * blend;
  }

  // 마지막으로 몸 표면에 너무 가까운 곳만 밀어낸다(목·턱 밑처럼 두 변형이 다 못 보는 곳). 옮긴 거리는 이웃과 고르게 편다.
  const neighbors = Array.from({ length: n }, () => new Set());
  const indices = hair.getIndices().getArray();
  for (let t = 0; t < indices.length; t += 3) {
    const a = hairWeld.ids[indices[t]];
    const b = hairWeld.ids[indices[t + 1]];
    const c = hairWeld.ids[indices[t + 2]];
    neighbors[a].add(b).add(c);
    neighbors[b].add(a).add(c);
    neighbors[c].add(a).add(b);
  }
  const pushOut = (positions) => {
    let pushed = 0;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
      const b = nearestBody(x, y, z);
      const clear = isHead[b] ? CLEAR_HEAD : CLEAR_BODY;
      const s = signedDistance(x, y, z, b);
      if (s >= clear) continue;
      for (let k = 0; k < 3; k++) positions[i * 3 + k] += (clear - s) * bodyNormals[b * 3 + k];
      pushed++;
    }
    return pushed;
  };
  const countInside = (positions) => {
    let inside = 0;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
      if (signedDistance(x, y, z, nearestBody(x, y, z)) < -0.001) inside++;
    }
    return inside;
  };
  const mapped = Float64Array.from(p);
  const insideMapped = countInside(p);
  for (let round = 0; round < 3; round++) {
    if (!pushOut(p)) break;
    // 밀어낸 몫만 이웃과 섞는다
    const extra = new Float64Array(n * 3);
    for (let i = 0; i < n * 3; i++) extra[i] = p[i] - mapped[i];
    for (let pass = 0; pass < 4; pass++) {
      const next = new Float64Array(n * 3);
      for (let i = 0; i < n; i++)
        for (let k = 0; k < 3; k++) {
          let sum = 0;
          for (const j of neighbors[i]) sum += extra[j * 3 + k];
          next[i * 3 + k] = neighbors[i].size
            ? 0.5 * extra[i * 3 + k] + (0.5 * sum) / neighbors[i].size
            : extra[i * 3 + k];
        }
      extra.set(next);
    }
    for (let i = 0; i < n * 3; i++) p[i] = mapped[i] + extra[i];
  }
  pushOut(p);

  const insideBefore = countInside(original);
  const insideAfter = countInside(p);
  let maxMove = 0;
  let sumMove = 0;
  for (let i = 0; i < n; i++) {
    const m = Math.hypot(
      p[i * 3] - original[i * 3],
      p[i * 3 + 1] - original[i * 3 + 1],
      p[i * 3 + 2] - original[i * 3 + 2],
    );
    maxMove = Math.max(maxMove, m);
    sumMove += m;
  }
  // 숱: 머리 중심·척추 축에서 잰 평균 거리가 얼마나 줄었나
  const bulk = (positions) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const y = positions[i * 3 + 1];
      sum +=
        y > headY
          ? Math.hypot(positions[i * 3] - centre[0], y - centre[1], positions[i * 3 + 2] - centre[2])
          : Math.hypot(positions[i * 3], positions[i * 3 + 2] - axisZ(y));
    }
    return sum / n;
  };

  // ── 스킨: 높이로 head → neck_01 → spine_03 ──
  const head = jointOf("head");
  const neck = jointOf("neck_01");
  const torso = jointOf(TORSO_BONE);
  const welded = new Array(n);
  const share = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const y = p[i * 3 + 1];
    const headShare = smoothstep(neckY, headY + 0.01, y);
    const neckShare = (1 - headShare) * smoothstep(clavicleY - 0.03, neckY, y);
    const torsoShare = 1 - headShare - neckShare;
    share[headShare > 0.99 ? 0 : torsoShare > 0.99 ? 2 : 1]++;
    welded[i] = [
      [head, headShare],
      [neck, neckShare],
      [torso, torsoShare],
      [head, 0],
    ];
  }
  console.log(
    `${label}: 정점 ${hairPositions.length / 3} · 몸 안(>1mm, 쉴 때 자세) ${insideBefore} → 변형 후 ${insideMapped} → 밀어낸 뒤 ${insideAfter}` +
      ` · 옮긴 거리 평균 ${((sumMove / n) * 1000).toFixed(1)} mm 최대 ${(maxMove * 1000).toFixed(1)} mm` +
      ` · 중심에서 평균 거리 ${(bulk(original) * 1000).toFixed(1)} → ${(bulk(p) * 1000).toFixed(1)} mm` +
      ` · 귀 접기 ${earCount} 자리 · head 만 ${share[0]} / 섞음 ${share[1]} / ${TORSO_BONE} 만 ${share[2]}`,
  );
  if (dry) return false;

  const jointsAttr = hair.getAttribute("JOINTS_0");
  const weightsAttr = hair.getAttribute("WEIGHTS_0");
  const outPositions = new Float32Array(hairPositions.length);
  const outJoints = new (jointsAttr.getArray().constructor)(jointsAttr.getArray().length);
  const outWeights = new Float32Array(weightsAttr.getArray().length);
  for (let v = 0; v < hairPositions.length / 3; v++) {
    const i = hairWeld.ids[v];
    for (let k = 0; k < 3; k++) outPositions[v * 3 + k] = p[i * 3 + k];
    welded[i].forEach(([joint, weight], k) => {
      outJoints[v * 4 + k] = joint;
      outWeights[v * 4 + k] = weight;
    });
  }
  hairPositionAttr.setArray(outPositions);
  jointsAttr.setArray(outJoints);
  weightsAttr.setArray(outWeights);
  hairNode.setExtras({ ...hairNode.getExtras(), [FIT_KEY]: FIT_VERSION });

  // 몸 모프 earTuck — 묶은 자리의 옮김을 원래 정점마다 펼친다. 다시 돌리면 같은 이름의 모프를 덮어쓴다.
  const bodyMesh = bodyNode.getMesh();
  const targetNames = [...(bodyMesh.getExtras()?.targetNames ?? [])];
  const deltas = new Float32Array(bodyPositions.length);
  for (let v = 0; v < bodyPositions.length / 3; v++)
    for (let k = 0; k < 3; k++) deltas[v * 3 + k] = tuck[bodyWeld.ids[v] * 3 + k];
  const existing = targetNames.indexOf(EAR_TUCK);
  if (existing >= 0) body.listTargets()[existing].getAttribute("POSITION").setArray(deltas);
  else {
    const accessor = doc
      .createAccessor(EAR_TUCK)
      .setType("VEC3")
      .setArray(deltas)
      // 귀 정점만 0 이 아니라 성긴(sparse) 접근자로 쓴다 — 빽빽하게 쓰면 파일마다 0.6 MB 가 는다
      .setSparse(true)
      .setBuffer(doc.getRoot().listBuffers()[0]);
    body.addTarget(doc.createPrimitiveTarget(EAR_TUCK).setAttribute("POSITION", accessor));
    bodyMesh.setWeights([...bodyMesh.getWeights(), 0]);
    bodyMesh.setExtras({ ...bodyMesh.getExtras(), targetNames: [...targetNames, EAR_TUCK] });
  }
  return true;
}

for (const gender of ["female", "male"])
  for (const look of LOOKS) {
    const file = `${MODEL_DIR}/meshy-${look}-${gender}.glb`;
    const doc = await io.read(file);
    if (fitLongHair(doc, gender, `meshy-${look}-${gender}`)) await io.write(file, doc);
  }
