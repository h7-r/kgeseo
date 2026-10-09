// 구운 모형(base64 위치·인덱스)을 표본 지오로 풀고, 모양만 보고 부위(머리·혀·가는 것·줄기)를 찾는다.
// Meshy 모형에는 재질도 UV 도 없어서 「여기가 혀」 같은 표시가 없다 — 그래서 전부 모양으로 잰다.
// 모형을 다시 구우면 꼭짓점이 통째로 바뀌므로 좌표를 박지 않고 그때그때 잰다.

import * as THREE from "three";

import type { BakedModel } from "./baked";

function decodeBase64<T>(text: string, ArrayType: new (buffer: ArrayBuffer) => T): T {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new ArrayType(bytes.buffer);
}

export type PaintVertices = (geometry: THREE.BufferGeometry, model: BakedModel, colors: Float32Array) => void;

interface BakedGeometryOptions {
  /** 색 배열을 직접 채운다. 머리 위치처럼 지오 전체를 봐야 하는 칠이 있어 통째로 넘긴다. */
  paint?: PaintVertices | null;
  /** paint 가 없을 때의 위아래 명암 — 단색 덩어리는 부피가 안 읽힌다 */
  bottom?: number;
  top?: number;
}

/**
 * 모형 → 비인덱스 지오 + 꼭짓점 색.
 * toNonIndexed 를 먼저 해야 면이 각진다(인덱스째 노멀을 구하면 혼자 매끈해진다).
 * 색은 반드시 깐다 — vertexColors 재질에 color 가 없으면 통째로 검게 나온다.
 * 굽는 것은 비율이고 실제 색은 instanceColor 가 곱한다.
 */
export function buildBakedModelGeometry(
  model: BakedModel,
  { paint = null, bottom = 1.2, top = 0.68 }: BakedGeometryOptions = {},
): THREE.BufferGeometry {
  const indexed = new THREE.BufferGeometry();
  indexed.setIndex(new THREE.BufferAttribute(decodeBase64(model.indices, Uint16Array), 1));
  indexed.setAttribute("position", new THREE.BufferAttribute(decodeBase64(model.positions, Float32Array), 3));
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();

  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const height = model.size?.y || 1;
  if (paint) paint(geometry, model, colors);
  else
    for (let i = 0; i < position.count; i++) {
      const t = THREE.MathUtils.clamp(position.getY(i) / height, 0, 1);
      const v = bottom + (top - bottom) * Math.pow(t, 0.8);
      colors[i * 3] = v;
      colors[i * 3 + 1] = v;
      colors[i * 3 + 2] = v;
    }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

interface HeadMeasurement {
  skull: THREE.Vector3;
  /** 주둥이 방향(단위) */
  snout: THREE.Vector3;
  /** 눈이 붙는 옆 축(단위) */
  side: THREE.Vector3;
  headWidth: number;
  headLength: number;
  nose: THREE.Vector3;
}

/**
 * 쳐든 머리(구렁이)의 두개골·주둥이·옆 축을 잰다.
 * 최고점은 머리가 아니라 내민 혀끝이라 「높은 곳」이 아닌 「두꺼운 곳」을 찾는다.
 */
export function measureHead(
  geometry: THREE.BufferGeometry,
  { headDepth = 0.11, neighborRadius = 0.05 }: { headDepth?: number; neighborRadius?: number } = {},
): HeadMeasurement {
  const p = geometry.attributes.position;
  let highest = -Infinity;
  for (let i = 0; i < p.count; i++) highest = Math.max(highest, p.getY(i));

  // 머리 띠만 추린다 — 전체를 보면 O(n²) 이 감당이 안 된다
  const band: THREE.Vector3[] = [];
  for (let i = 0; i < p.count; i++)
    if (p.getY(i) > highest - headDepth) band.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));

  // 무게중심에서 가장 먼 점 = 머리 띠의 한쪽 끝 = 코
  const centroid = new THREE.Vector3();
  for (const q of band) centroid.add(q);
  centroid.divideScalar(Math.max(1, band.length));
  let nose = band[0] ?? new THREE.Vector3();
  let farthest = -1;
  for (const q of band) {
    const d = q.distanceToSquared(centroid);
    if (d > farthest) {
      farthest = d;
      nose = q;
    }
  }

  // 코 둘레 평균이 머리 한복판이고, 그 반대가 주둥이 방향이다
  const nearNose = band.filter((q) => q.distanceTo(nose) < headDepth * 1.2);
  const headCenter = new THREE.Vector3();
  for (const q of nearNose) headCenter.add(q);
  headCenter.divideScalar(Math.max(1, nearNose.length));
  const snout = nose.clone().sub(headCenter).normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(snout).normalize();

  // 코에서 뒤로 걸으며 옆 폭을 재고, 갑자기 굵어지는 자리를 목으로 본다.
  // 「이웃이 가장 많은 점」으로 잡으면 또아리 튼 목덜미 고리가 두개골로 잡혀 눈이 목에 찍힌다.
  const cellCount = 24;
  const step = (headDepth * 2.2) / cellCount;
  const widths = new Array<number>(cellCount).fill(0);
  const offset = new THREE.Vector3();
  for (const q of band) {
    offset.copy(q).sub(nose);
    const back = -offset.dot(snout);
    if (back < 0) continue;
    const k = Math.floor(back / step);
    if (k >= cellCount) continue;
    widths[k] = Math.max(widths[k], Math.abs(offset.dot(side)));
  }
  // 앞쪽 1/3 은 확실히 머리라 그 폭을 기준으로 삼는다
  const front = widths.slice(1, Math.max(2, Math.round(cellCount / 3))).filter((v) => v > 0);
  const baseWidth = front.length ? front.reduce((a, b) => a + b, 0) / front.length : neighborRadius * 0.5;
  let neckCell = cellCount;
  for (let k = Math.round(cellCount / 3); k < cellCount; k++)
    if (widths[k] > baseWidth * 1.75) {
      neckCell = k;
      break;
    }
  const headLength = Math.max(step * 3, neckCell * step);
  const skull = nose.clone().addScaledVector(snout, -headLength * 0.5);
  const headWidth = Math.max(baseWidth, neighborRadius * 0.2);

  return { skull, snout, side, headWidth, headLength, nose };
}

interface TongueOptions {
  start: THREE.Vector3;
  /** 이 거리 안이면 이어진 것으로 본다 */
  link?: number;
  /** 혀끝에서 이만큼까지만 번진다 — 더 가면 머리로 샌다 */
  length?: number;
}

/**
 * 혀 = 혀끝에서 이어진 한 덩어리. 가장 가까운 꼭짓점에서 이웃을 타고 번지되 거리로 끊는다.
 * 「이웃이 적은 점」「얇은 판」은 줄인 메시에서 머리·목까지 빨개져 못 썼다.
 */
export function findTongue(
  geometry: THREE.BufferGeometry,
  { start, link = 0.018, length = 0.085 }: TongueOptions,
): Set<number> {
  const p = geometry.attributes.position;
  const q = new THREE.Vector3();

  let seed = 0;
  let nearest = Infinity;
  for (let i = 0; i < p.count; i++) {
    q.set(p.getX(i), p.getY(i), p.getZ(i));
    const d = q.distanceToSquared(start);
    if (d < nearest) {
      nearest = d;
      seed = i;
    }
  }
  const tip = new THREE.Vector3(p.getX(seed), p.getY(seed), p.getZ(seed));

  const around: number[] = [];
  for (let i = 0; i < p.count; i++) {
    q.set(p.getX(i), p.getY(i), p.getZ(i));
    if (q.distanceTo(tip) < length) around.push(i);
  }
  const points = around.map((i) => new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
  const found = new Set([seed]);
  const queue = [tip.clone()];
  const link2 = link * link;
  for (let current = queue.pop(); current; current = queue.pop()) {
    for (let k = 0; k < around.length; k++) {
      const i = around[k];
      if (found.has(i)) continue;
      if (points[k].distanceToSquared(current) > link2) continue;
      found.add(i);
      queue.push(points[k]);
    }
  }
  return found;
}

interface ThinPartOptions {
  /** 높이 슬랩 두께 */
  slab?: number;
  radius?: number;
  /** 가로 퍼짐이 이보다 작으면 기둥 */
  spreadThreshold?: number;
  /** 이웃 주축의 작은 축이 이보다 얇으면 가로대 */
  minorAxisThreshold?: number;
}

/**
 * 가는 것(기둥·가로대)의 꼭짓점. 천막의 천과 나무를 모양으로 가른다.
 * 기둥은 어느 높이로 썰어도 가는 점이고 천은 넓게 퍼진다 — 두 분포가 깨끗이 둘로 갈린다.
 * 가로로 긴 막대는 이웃의 주축에서 작은 축이 얇은지로 한 번 더 본다.
 */
export function findThinParts(
  geometry: THREE.BufferGeometry,
  { slab = 0.03, radius = 0.14, spreadThreshold = 0.06, minorAxisThreshold = 0.035 }: ThinPartOptions = {},
): Set<number> {
  const p = geometry.attributes.position;
  const n = p.count;

  // 비인덱스 지오는 같은 자리가 면마다 따로 있다 — 자리별로 한 번만 재고 답을 물려준다(아홉 배 차이)
  const representative = new Map<string, number>();
  const placeOf = new Int32Array(n);
  const places: number[] = [];
  for (let i = 0; i < n; i++) {
    const key = `${p.getX(i)},${p.getY(i)},${p.getZ(i)}`;
    let r = representative.get(key);
    if (r === undefined) {
      r = places.length;
      representative.set(key, r);
      places.push(i);
    }
    placeOf[i] = r;
  }
  const m = places.length;

  // 높이 슬랩 → 가로 격자. 다 훑으면 꼭짓점 5 만 개에 2 억 번이다.
  const cell = radius;
  const buckets = new Map<string, number[]>();
  const bucketKey = (s: number, gx: number, gz: number) => `${s}|${gx}|${gz}`;
  for (let r = 0; r < m; r++) {
    const i = places[r];
    const key = bucketKey(Math.floor(p.getY(i) / slab), Math.floor(p.getX(i) / cell), Math.floor(p.getZ(i) / cell));
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(i);
  }
  const thinPlaces = new Set<number>();
  const radius2 = radius * radius;
  for (let r = 0; r < m; r++) {
    const i = places[r];
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const s = Math.floor(y / slab);
    const gx = Math.floor(x / cell);
    const gz = Math.floor(z / cell);
    let maxD2 = 0;
    let sx = 0;
    let sz = 0;
    let count = 0;
    const neighbors: number[] = [];
    for (let ds = -1; ds <= 1; ds++)
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = buckets.get(bucketKey(s + ds, gx + dx, gz + dz));
          if (!list) continue;
          for (const j of list) {
            const ex = p.getX(j) - x;
            const ez = p.getZ(j) - z;
            const d2 = ex * ex + ez * ez;
            if (d2 > radius2) continue;
            maxD2 = Math.max(maxD2, d2);
            neighbors.push(ex, ez);
            sx += ex;
            sz += ez;
            count++;
          }
        }
    if (Math.sqrt(maxD2) < spreadThreshold) {
      thinPlaces.add(r);
      continue;
    }
    if (count < 4) continue;
    // 2×2 공분산의 작은 고유값이 곧 「가는 쪽」이다
    const mx = sx / count;
    const mz = sz / count;
    let a11 = 0;
    let a12 = 0;
    let a22 = 0;
    for (let k = 0; k < neighbors.length; k += 2) {
      const ex = neighbors[k] - mx;
      const ez = neighbors[k + 1] - mz;
      a11 += ex * ex;
      a12 += ex * ez;
      a22 += ez * ez;
    }
    a11 /= count;
    a12 /= count;
    a22 /= count;
    const trace = a11 + a22;
    const det = a11 * a22 - a12 * a12;
    const root = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
    const minorAxis = 2 * Math.sqrt(Math.max(0, trace / 2 - root));
    if (minorAxis < minorAxisThreshold) thinPlaces.add(r);
  }
  const thin = new Set<number>();
  for (let i = 0; i < n; i++) if (thinPlaces.has(placeOf[i])) thin.add(i);
  return thin;
}

interface TrunkOptions {
  /** 꼭짓점 수가 n / 이 값을 넘는 층부터 잎으로 본다 */
  leafStartDivisor?: number;
  layerCount?: number;
  /** 가지가 갈라지며 넓어지는 몫 */
  branchAllowance?: number;
}

interface TrunkResult {
  trunk: Set<number>;
  trunkTop: number;
  thickness: number;
  axis: [number, number];
}

/**
 * 나무 줄기 꼭짓점. 높이별 꼭짓점 수가 잎이 시작되는 층에서 뛰므로 그 아래가 줄기다.
 * 위로는 층마다 축을 천천히 따라가며 반지름을 절대 키우지 않는다 — 넉넉히 잡으면 잎이 갈색이 된다.
 */
export function findTrunk(
  geometry: THREE.BufferGeometry,
  { leafStartDivisor = 12, layerCount = 56, branchAllowance = 1.45 }: TrunkOptions = {},
): TrunkResult {
  const p = geometry.attributes.position;
  const n = p.count;
  let highest = 0;
  for (let i = 0; i < n; i++) highest = Math.max(highest, p.getY(i));
  if (!(highest > 0)) return { trunk: new Set(), trunkTop: 0, thickness: 0, axis: [0, 0] };

  // ① 잎이 시작되기 전의 맨 줄기 띠
  const coarseLayers = 10;
  const coarseHeight = highest / coarseLayers;
  const counts = new Array<number>(coarseLayers).fill(0);
  for (let i = 0; i < n; i++) counts[Math.min(coarseLayers - 1, Math.floor(p.getY(i) / coarseHeight))]++;
  const threshold = n / leafStartDivisor;
  let leafLayer = coarseLayers;
  for (let k = 0; k < coarseLayers; k++)
    if (counts[k] > threshold) {
      leafLayer = k;
      break;
    }
  const trunkTop = Math.max(coarseHeight, leafLayer * coarseHeight);

  // 축과 굵기는 뿌리 위·잎 아래 띠에서만 잰다 — 밑동째 재면 뻗은 뿌리 때문에 두세 배로 나온다
  const aboveRoots = trunkTop * 0.45;
  let cx = 0;
  let cz = 0;
  let m = 0;
  for (let i = 0; i < n; i++) {
    const y = p.getY(i);
    if (y >= aboveRoots && y < trunkTop) {
      cx += p.getX(i);
      cz += p.getZ(i);
      m++;
    }
  }
  if (m) {
    cx /= m;
    cz /= m;
  }
  let thickness = 0;
  for (let i = 0; i < n; i++) {
    const y = p.getY(i);
    if (y >= aboveRoots && y < trunkTop) thickness = Math.max(thickness, Math.hypot(p.getX(i) - cx, p.getZ(i) - cz));
  }
  thickness = thickness || highest * 0.03;

  // ② 층을 얇게 썰어 아래에서 위로 줄기를 따라간다
  const trunk = new Set<number>();
  const layerHeight = highest / layerCount;
  const layers = Array.from({ length: layerCount }, () => [] as number[]);
  for (let i = 0; i < n; i++) {
    const k = Math.min(layerCount - 1, Math.max(0, Math.floor(p.getY(i) / layerHeight)));
    layers[k].push(i);
  }
  const startLayer = Math.min(layerCount - 1, Math.floor(aboveRoots / layerHeight));
  // 뿌리는 사방으로 뻗으니 시작층 아래는 넉넉히 봐준다
  for (let k = 0; k < startLayer; k++)
    for (const i of layers[k]) {
      const r = Math.hypot(p.getX(i) - cx, p.getZ(i) - cz);
      if (r < thickness * 2.2) trunk.add(i);
    }
  // 줄기 겉면은 옆을 보고(|ny| 작다), 잎 뭉치는 위·아래를 보는 면이 많다
  const normal = geometry.attributes.normal;
  let ax = cx;
  let az = cz;
  let radius = thickness * branchAllowance;
  // 반지름 바닥 — 층마다 줄이면 56 층에서 무너져 줄기가 밑동에서 끊긴다
  const minRadius = thickness * 0.3;
  let emptyLayers = 0;
  for (let k = startLayer; k < layerCount; k++) {
    const candidates: [number, number][] = [];
    for (const i of layers[k]) {
      const r = Math.hypot(p.getX(i) - ax, p.getZ(i) - az);
      if (r >= radius) continue;
      if (normal && Math.abs(normal.getY(i)) > 0.75) continue;
      candidates.push([r, i]);
    }
    // 잎 뭉치는 점이 바깥에 몰린다 — 가까운 60 % 의 끝 반지름으로 조인다
    candidates.sort((a, b) => a[0] - b[0]);
    const limit = candidates.length
      ? Math.min(radius, Math.max(candidates[Math.floor((candidates.length - 1) * 0.6)][0] * 1.35, minRadius))
      : radius;
    const accepted = candidates.filter(([r]) => r < limit).map(([, i]) => i);
    // 감면된 모형은 줄기 한 층에 꼭짓점이 한둘뿐일 수 있다 — 몇 층은 참는다
    if (accepted.length < 2) {
      if (++emptyLayers > 5) break;
      continue;
    }
    emptyLayers = 0;
    let sx = 0;
    let sz = 0;
    let maxR = 0;
    for (const i of accepted) {
      sx += p.getX(i);
      sz += p.getZ(i);
      trunk.add(i);
    }
    // 축은 천천히 옮긴다 — 한 번에 옮기면 잎 뭉치 쪽으로 끌려가 계속 따라간다
    ax += (sx / accepted.length - ax) * 0.4;
    az += (sz / accepted.length - az) * 0.4;
    for (const i of accepted) maxR = Math.max(maxR, Math.hypot(p.getX(i) - ax, p.getZ(i) - az));
    // 절대 안 키운다. 나무는 위로 갈수록 가늘어진다.
    radius = Math.min(radius, Math.max(maxR * 1.15, minRadius));
  }
  return { trunk, trunkTop, thickness, axis: [cx, cz] };
}
