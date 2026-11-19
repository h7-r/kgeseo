// 반삭(버즈컷) — 머리카락 메시 없이 민머리 몸에 짧은 머리를 칠한다. GLB 는 그대로다.
// 몸 지오메트리마다 한 번, 정점마다 「두피 정도」(_scalp, 0~1)를 굽는다. 툰 셰이더(toonMaterial.ts)가 그만큼 피부를
// 머리색 + 짧은 털 잔결로 바꾼다. 몸에 칠하는 것이라 체형 모프·머리 크기(뼈 배율)·스키닝·외곽선을 저절로 따른다.
//
// 두피 = head 뼈에 묶인 정점 중 머리 중심에서 본 고도가 헤어라인보다 위인 곳, 귀와 그 둘레는 뺀다.
//   헤어라인 고도(도)는 방위(앞 0°)마다 정한 점을 잇는다(HAIRLINE) — 이마 25°, 관자놀이에서 내려와 귀 앞 구레나룻
//     −18°(귀 구슬 위쪽까지 — 2026-11-06 미르 요청으로 −12° 에서 조금 내리고 2° 앞으로 — 귀 둘레 1.2 cm 빼기에 안 먹히게), 귀 뒤로 돌아
//     목덜미 −55°. 눈썹은 머리 중심에서 여 +6.5°·남 −5.6° 까지, 눈꼬리는 방위 ±51° 까지라(재 봄)
//     이마·관자놀이가 남는다. 귀는 아래 귀 빼기가 깎는다.
//   귀 = 옆머리 창(옆 ±53°, 고도 −50°~25°) 안에서 두개골보다 튀어나온 정점. 두개골은 방향별 거리표(2° 칸)의
//     열림(최솟값 → 최댓값, 반경 16°)이라 귀처럼 좁게 튀어나온 것만 깎인다(예전 긴 머리 맞춤 도구의 귀 접기와 같은 방법).
//     귀에서 1.2 cm 안쪽까지는 서서히 뺀다 — 귀 바로 둘레는 머리가 안 난다.
import * as THREE from "three";

const SCALP_KEY = "_scalp";
const BIN_DEG = 2;
const AZ = 360 / BIN_DEG;
const EL = 180 / BIN_DEG;
const OPEN = 8;
/** [방위 |az|(도), 헤어라인 고도(도)] — 좌우 대칭 */
const HAIRLINE: readonly (readonly [number, number])[] = [
  [0, 25],
  [35, 24],
  [55, 18],
  [66, 6],
  [74, -18],
  [95, -14],
  [112, -26],
  [140, -46],
  [180, -55],
];
const FEATHER = 3;

const smoothstep = THREE.MathUtils.smoothstep;
const DEG = 180 / Math.PI;

/** 헤어라인 고도(도) — 방위 az(도, 0 = 앞) */
function hairline(az: number): number {
  const a = Math.min(180, Math.abs(az));
  for (let k = 1; k < HAIRLINE.length; k++) {
    const [a1, e1] = HAIRLINE[k];
    if (a <= a1) {
      const [a0, e0] = HAIRLINE[k - 1];
      return e0 + ((a - a0) / (a1 - a0)) * (e1 - e0);
    }
  }
  return HAIRLINE[HAIRLINE.length - 1][1];
}

/** 감기는 열(방위)과 안 감기는 행(고도)으로 나눠 최솟값·최댓값을 낸다(분리 가능해 빠르다) */
function rankFilter(table: Float32Array, radius: number, pick: (a: number, b: number) => number): Float32Array {
  const rows = new Float32Array(table.length);
  for (let el = 0; el < EL; el++)
    for (let az = 0; az < AZ; az++) {
      let value = table[el * AZ + az];
      for (let d = 1; d <= radius; d++) {
        value = pick(value, table[el * AZ + ((az + d) % AZ)]);
        value = pick(value, table[el * AZ + ((az - d + AZ) % AZ)]);
      }
      rows[el * AZ + az] = value;
    }
  const out = new Float32Array(table.length);
  for (let el = 0; el < EL; el++)
    for (let az = 0; az < AZ; az++) {
      let value = rows[el * AZ + az];
      for (let d = 1; d <= radius; d++) {
        if (el + d < EL) value = pick(value, rows[(el + d) * AZ + az]);
        if (el - d >= 0) value = pick(value, rows[(el - d) * AZ + az]);
      }
      out[el * AZ + az] = value;
    }
  return out;
}

/** 빈 칸(0)을 이웃으로 채운다 — 머리 아래(목 쪽)처럼 정점이 없는 방향 */
function fillEmpty(table: Float32Array): Float32Array {
  let current = table;
  for (let pass = 0; pass < AZ; pass++) {
    let empty = 0;
    const next = Float32Array.from(current);
    for (let el = 0; el < EL; el++)
      for (let az = 0; az < AZ; az++) {
        if (current[el * AZ + az] > 0) continue;
        let sum = 0;
        let count = 0;
        const around = [
          el > 0 ? (el - 1) * AZ + az : -1,
          el < EL - 1 ? (el + 1) * AZ + az : -1,
          el * AZ + ((az + 1) % AZ),
          el * AZ + ((az - 1 + AZ) % AZ),
        ];
        for (const k of around)
          if (k >= 0 && current[k] > 0) {
            sum += current[k];
            count++;
          }
        if (count) next[el * AZ + az] = sum / count;
        else empty++;
      }
    current = next;
    if (!empty) break;
  }
  return current;
}

/**
 * 몸 메시에 _scalp 정점 속성을 붙인다(지오메트리당 한 번 — 아바타 여럿이 같이 쓴다).
 * faceWeights = head 뼈 웨이트(_face). head 뼈가 없으면 0 으로 채운다.
 */
export function addScalpWeights(mesh: THREE.SkinnedMesh): void {
  const geometry = mesh.geometry;
  if (geometry.getAttribute(SCALP_KEY)) return;
  const position = geometry.getAttribute("position");
  const face = geometry.getAttribute("_face");
  const count = position.count;
  const scalp = new Float32Array(count);
  const headIndex = mesh.skeleton?.bones.findIndex((bone) => bone.name === "head") ?? -1;
  if (headIndex < 0 || !face) {
    geometry.setAttribute(SCALP_KEY, new THREE.BufferAttribute(scalp, 1));
    return;
  }
  // 쉴 때 자세의 head 뼈 높이(메시 공간) — inverseBindMatrices 의 역행렬
  const headY = new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[headIndex].clone().invert()).y;
  const isHead = (i: number) => face.getX(i) > 0.3;

  // 머리 중심 — 턱 위 머리 정점의 상자 가운데
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    if (!isHead(i)) continue;
    p.fromBufferAttribute(position, i);
    if (p.y < headY + 0.02) continue;
    lo.min(p);
    hi.max(p);
  }
  const centre = lo.add(hi).multiplyScalar(0.5);

  // 정점마다 방위·고도·거리, 방향별 가장 먼 거리표
  const azimuth = new Float32Array(count);
  const elevation = new Float32Array(count);
  const radius = new Float32Array(count);
  const bin = new Int32Array(count).fill(-1);
  const reach = new Float32Array(AZ * EL);
  for (let i = 0; i < count; i++) {
    if (!isHead(i)) continue;
    p.fromBufferAttribute(position, i).sub(centre);
    const r = p.length();
    if (r < 1e-6) continue;
    const az = Math.atan2(p.x, p.z) * DEG;
    const el = Math.asin(THREE.MathUtils.clamp(p.y / r, -1, 1)) * DEG;
    azimuth[i] = az;
    elevation[i] = el;
    radius[i] = r;
    const k =
      Math.min(EL - 1, Math.max(0, Math.floor((el + 90) / BIN_DEG))) * AZ + (Math.floor((az + 180) / BIN_DEG) % AZ);
    bin[i] = k;
    reach[k] = Math.max(reach[k], r);
  }
  const skull = rankFilter(rankFilter(fillEmpty(reach), OPEN, Math.min), OPEN, Math.max);

  // 귀 정점, 그리고 귀까지의 거리(칸 해시)
  const ear: number[] = [];
  const earShare = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (bin[i] < 0) continue;
    const side = Math.abs(Math.sin(azimuth[i] / DEG));
    if (side < 0.8 || elevation[i] < -50 || elevation[i] > 25) continue;
    const share = smoothstep(radius[i], skull[bin[i]] + 0.002, skull[bin[i]] + 0.006);
    if (share > 0) {
      earShare[i] = share;
      if (share > 0.5) ear.push(i);
    }
  }
  const CELL = 0.012;
  const grid = new Map<string, number[]>();
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  for (const i of ear) {
    p.fromBufferAttribute(position, i);
    const key = keyOf(p.x, p.y, p.z);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)?.push(i);
  }
  const q = new THREE.Vector3();
  const distanceToEar = (i: number) => {
    p.fromBufferAttribute(position, i);
    const cx = Math.floor(p.x / CELL);
    const cy = Math.floor(p.y / CELL);
    const cz = Math.floor(p.z / CELL);
    let best = Infinity;
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (let z = cz - 1; z <= cz + 1; z++)
          for (const j of grid.get(`${x},${y},${z}`) ?? [])
            best = Math.min(best, q.fromBufferAttribute(position, j).distanceTo(p));
    return best;
  };

  for (let i = 0; i < count; i++) {
    if (bin[i] < 0) continue;
    const line = hairline(azimuth[i]);
    const above = smoothstep(elevation[i], line - FEATHER, line + FEATHER);
    if (above <= 0) continue;
    const nearEar = ear.length ? 1 - smoothstep(distanceToEar(i), 0.004, 0.012) : 0;
    const keep = 1 - Math.max(earShare[i], nearEar);
    // 목덜미는 head·neck 웨이트가 섞여 있어 넉넉히 받는다
    scalp[i] = above * keep * smoothstep(face.getX(i), 0.3, 0.7);
  }
  geometry.setAttribute(SCALP_KEY, new THREE.BufferAttribute(scalp, 1));
}

/** 몸이 아닌 메시 — 셰이더가 같은 속성을 읽으므로 0 으로 채워 둔다 */
export function addEmptyScalpWeights(geometry: THREE.BufferGeometry): void {
  if (geometry.getAttribute(SCALP_KEY)) return;
  geometry.setAttribute(
    SCALP_KEY,
    new THREE.BufferAttribute(new Float32Array(geometry.getAttribute("position").count), 1),
  );
}
