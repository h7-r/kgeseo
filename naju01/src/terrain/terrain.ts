// "이 자리의 바닥 높이는 몇 m 인가". NAJU-01 은 EL 0 · +8 · +14 세 층이 이어져 있어 발밑을 좌표로 물어야 한다.
// 상수가 아니라 만드는 함수인 이유: 절벽 높이(§9 미정값)가 곧 Z3 고도라, 돌리면 T3·T4 경사와 그 위 차단물까지 따라 움직인다.
// 그림·이동·충돌·계기판이 같은 한 벌을 본다. 입출력은 전부 미터 — 도면과 같은 숫자로 디버깅하려고.

import {
  BLOCKERS,
  CLIFF,
  CLIFF_OUTLINE,
  CORE,
  PATHS,
  RIVER,
  SHOULDER_DEFAULTS,
  ZONES,
  type BlockerDef,
  type Cliff,
  type PathCode,
  type PathDef,
  type Range,
  type Shoulder,
  type Zone,
  type ZoneCode,
} from "../plan/sitePlan";
import { createNoise, type HeightAt } from "./ground";
import type { HeightTable } from "./heightTable";

const DEGREES = 180 / Math.PI;

/** 지형 밖에서 끼워 주는 무대 밖 연결로(terrain/connectorRamp) */
interface RampSurface {
  isOn: (x: number, z: number) => boolean;
  heightAt: (x: number, z: number) => number;
}

/** 지면 판정. 연결로 위면 path 가 "연결로" — 계기판에 그대로 보이는 글자다. */
interface GroundSample {
  y: number;
  zone: ZoneCode | null;
  path: PathCode | "연결로" | null;
  /** 통로 위일 때만 — 길바닥이 아니라 갓길을 밟고 있나 */
  isShoulder?: boolean;
  /** 벼랑면 — 서지 못하고 미끄러져 내려간다 */
  isFall: boolean;
  isWater: boolean;
}

interface PathSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  length: number;
  /** 이 조각이 시작하는 호 길이 */
  startDistance: number;
}

interface PathMeasurement {
  // 도면의 route("Z1 → Z2" 문자열)와 겹치지 않게 조각 목록은 segments 로 둔다.
  segments: PathSegment[];
  planarLength: number;
  /** 경사까지 따진 실제로 걷는 거리 */
  trueLength: number;
  slope: number;
  rise: number;
}

export interface CenterlinePoint {
  x: number;
  z: number;
  arcLength: number;
  y: number;
  /** XZ 평면의 왼쪽 법선 */
  nx: number;
  nz: number;
}

export interface MeasuredPath extends PathDef, PathMeasurement {
  centerline: CenterlinePoint[];
  /** 다듬은 중심선의 이웃 점끼리 이은 잔 조각 — 거의 일직선이라 이음매가 안 튄다 */
  fineSegments: PathSegment[];
  fineLength: number;
}

interface Blocker extends Omit<BlockerDef, "floor"> {
  floor: number;
}

interface TerrainCliff extends Cliff {
  slopeAngle: number;
}

export interface TerrainOptions {
  /** Z3 의 고도이자 절벽 낙차. 이것 하나가 아래를 전부 끌고 간다 */
  cliffHeight?: number;
  /** 도면에 없는 차단물 높이를 통째로 키우고 줄인다(§4 눈으로 맞출 값) */
  blockerScale?: number;
  shoulder?: Shoulder;
  /** 통로 높이 조회에 공간 색인을 쓸지. 끄면 모든 선분을 훑는다(A/B 비교용) */
  useIndex?: boolean;
}

/** 도면에 적힌 길이·경사를 좌표에서 다시 잰다. 어긋나면 계기판이 빨갛게 띄운다(§8). */
function measurePath(path: PathDef): PathMeasurement {
  const segments: PathSegment[] = [];
  let total = 0;
  for (let i = 0; i < path.points.length - 1; i++) {
    const [x1, z1] = path.points[i];
    const [x2, z2] = path.points[i + 1];
    const length = Math.hypot(x2 - x1, z2 - z1);
    segments.push({ x1, z1, x2, z2, length, startDistance: total });
    total += length;
  }
  const planarLength = total;
  const rise = path.endElevation - path.startElevation;
  return {
    segments,
    planarLength,
    trueLength: Math.hypot(planarLength, rise),
    slope: Math.atan2(Math.abs(rise), planarLength) * DEGREES,
    rise,
  };
}

function projectOnSegment(px: number, pz: number, s: PathSegment) {
  const dx = s.x2 - s.x1;
  const dz = s.z2 - s.z1;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((px - s.x1) * dx + (pz - s.z1) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = s.x1 + dx * t;
  const cz = s.z1 + dz * t;
  return { distance: Math.hypot(px - cx, pz - cz), arcLength: s.startDistance + s.length * t };
}

type CenterlineSource = Pick<MeasuredPath, "segments" | "planarLength" | "startElevation" | "rise">;

/**
 * 도면 꼭짓점 사이를 spacing 마다 채우고, 진행 방향을 이웃과 평균 내어 모서리를 둥글린다.
 * 고도는 호 길이에 비례해 올린다.
 */
export function extractCenterline(path: CenterlineSource, spacing = 0.4, smoothing = 2): CenterlinePoint[] {
  const points: { x: number; z: number; arcLength: number }[] = [];
  for (const s of path.segments) {
    const n = Math.max(1, Math.round(s.length / spacing));
    for (let i = 0; i < n; i++) {
      const f = i / n;
      points.push({
        x: s.x1 + (s.x2 - s.x1) * f,
        z: s.z1 + (s.z2 - s.z1) * f,
        arcLength: s.startDistance + s.length * f,
      });
    }
  }
  const last = path.segments[path.segments.length - 1];
  points.push({ x: last.x2, z: last.z2, arcLength: path.planarLength });

  const directions = points.map((_, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const L = Math.hypot(dx, dz) || 1;
    return { x: dx / L, z: dz / L };
  });
  for (let pass = 0; pass < smoothing; pass++) {
    for (let i = 1; i < directions.length - 1; i++) {
      const dx = (directions[i - 1].x + directions[i].x * 2 + directions[i + 1].x) / 4;
      const dz = (directions[i - 1].z + directions[i].z * 2 + directions[i + 1].z) / 4;
      const L = Math.hypot(dx, dz) || 1;
      directions[i] = { x: dx / L, z: dz / L };
    }
  }

  return points.map((p, i) => ({
    ...p,
    y: path.startElevation + path.rise * (p.arcLength / path.planarLength),
    nx: -directions[i].z,
    nz: directions[i].x,
  }));
}

const isWithin = (v: number, [a, b]: Range) => v >= a && v <= b;

/** 점에서 축 정렬 상자까지의 수평 거리(안에 있으면 0) */
const distanceToBox = (px: number, pz: number, X: Range, Z: Range) => {
  const dx = Math.max(X[0] - px, 0, px - X[1]);
  const dz = Math.max(Z[0] - pz, 0, pz - Z[1]);
  return Math.hypot(dx, dz);
};

const isOutsideCore = (px: number, pz: number) => px < CORE.x[0] || px > CORE.x[1] || pz < CORE.z[0] || pz > CORE.z[1];

interface IndexedSegment {
  path: MeasuredPath;
  segment: PathSegment;
}

/** 설정 하나에 맞는 지형 한 벌을 만든다. */
export function createTerrain({
  cliffHeight = CLIFF.height,
  blockerScale = 1,
  shoulder = SHOULDER_DEFAULTS,
  useIndex = true,
}: TerrainOptions = {}) {
  // ① 구역 — Z3 의 고도만 바뀐다.
  const zones: Zone[] = ZONES.map((z) =>
    z.code === "Z3" ? { ...z, elevation: cliffHeight, dimensionsLabel: `24 × 18 m · EL +${cliffHeight}` } : z,
  );
  const zoneElevation: Record<string, number> = Object.fromEntries(zones.map((z) => [z.code, z.elevation]));

  // ② 통로 — T3 는 Z3 로 올라가고(끝), T4 는 Z3 에서 내려온다(시작).
  const paths: PathDef[] = PATHS.map((t) => {
    if (t.code === "T3") return { ...t, endElevation: cliffHeight };
    if (t.code === "T4") return { ...t, startElevation: cliffHeight };
    return t;
  });
  // 판정도 그림도 잘게 뽑아 다듬은 중심선을 쓴다. 도면 꼭짓점(직각)을 그대로 쓰면 꺾이는 데서 호 길이가 달라
  // 코너 안쪽에서 한 걸음에 0.5 m 가 꺼졌다.
  const measuredPaths: MeasuredPath[] = paths.map((t) => {
    const measured = { ...t, ...measurePath(t) };
    const centerline = extractCenterline(measured);
    const fineSegments: PathSegment[] = [];
    let total = 0;
    for (let i = 0; i < centerline.length - 1; i++) {
      const a = centerline[i];
      const b = centerline[i + 1];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 1e-6) continue;
      fineSegments.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, length, startDistance: total });
      total += length;
    }
    return { ...measured, centerline, fineSegments, fineLength: total || measured.planarLength };
  });

  // ③ 차단물 — floorZone 이 적힌 것은 그 구역 고도 위에 선다.
  const blockers: Blocker[] = BLOCKERS.map((b) => ({
    ...b,
    height: b.height * blockerScale,
    floor: b.floorZone ? zoneElevation[b.floorZone] : (b.floor ?? 0),
  }));

  // ④ 절벽 — 배터 띠(Z 26~30) 폭은 그대로라 높이를 올리면 면이 더 선다.
  const batterWidth = CLIFF.zBottom - CLIFF.zTop;
  const cliff: TerrainCliff = {
    ...CLIFF,
    height: cliffHeight,
    slopeAngle: Math.atan2(cliffHeight, batterWidth) * DEGREES,
  };

  // 고리 1바퀴 — 도면의 75.1 m 와 맞는지(수평 합)
  const measuredLoop = measuredPaths.reduce((s, t) => s + t.planarLength, 0);
  // 경사면까지 따진 실제로 다리가 가는 거리
  const measuredWalk = measuredPaths.reduce((s, t) => s + t.trueLength, 0);

  // 통로 세밀 선분 공간 색인. 조회마다 세밀 선분(약 700개)을 다 투영하면 첫 화면이 가장 무거워진다.
  // 등록 범위를 경계 상자에 한계만큼 넓혀 잡아 기여할 선분은 하나도 안 빠지고, 칸 안 목록을 원래 차례
  // (통로 → 선분)로 쌓아 가중 평균을 더하는 순서까지 같다 — 순서가 달라지면 1비트가 달라져 지형 지문이 바뀐다.
  const INDEX_CELL = 2; // m
  const pathIndex = (() => {
    if (!useIndex) return null;
    const shoulderEnd = shoulder.reach * shoulder.width;
    const entries: { path: MeasuredPath; segment: PathSegment; a: number; b: number; c: number; d: number }[] = [];
    let gx0 = Infinity,
      gx1 = -Infinity,
      gz0 = Infinity,
      gz1 = -Infinity;
    measuredPaths.forEach((t) => {
      const limit = t.width / 2 + shoulderEnd;
      t.fineSegments.forEach((s) => {
        const a = Math.floor((Math.min(s.x1, s.x2) - limit) / INDEX_CELL);
        const b = Math.floor((Math.max(s.x1, s.x2) + limit) / INDEX_CELL);
        const c = Math.floor((Math.min(s.z1, s.z2) - limit) / INDEX_CELL);
        const d = Math.floor((Math.max(s.z1, s.z2) + limit) / INDEX_CELL);
        entries.push({ path: t, segment: s, a, b, c, d });
        if (a < gx0) gx0 = a;
        if (b > gx1) gx1 = b;
        if (c < gz0) gz0 = c;
        if (d > gz1) gz1 = d;
      });
    });
    if (!entries.length) return null;
    const width = gx1 - gx0 + 1;
    const depth = gz1 - gz0 + 1;
    const cells: (IndexedSegment[] | undefined)[] = new Array(width * depth);
    entries.forEach(({ path, segment, a, b, c, d }) => {
      for (let gx = a; gx <= b; gx += 1) {
        for (let gz = c; gz <= d; gz += 1) {
          const i = (gx - gx0) * depth + (gz - gz0);
          (cells[i] ??= []).push({ path, segment });
        }
      }
    });
    return { cells, gx0, gz0, width, depth };
  })();
  // 색인을 끈 비교용 목록. 조회마다 만들면 A/B 가 공정하지 않아 한 번만 편다.
  const allSegments: IndexedSegment[] | null = useIndex
    ? null
    : measuredPaths.flatMap((t) => t.fineSegments.map((s) => ({ path: t, segment: s })));

  /** 통로(갓길 포함) 위면 그 자리 고도. 갓길에서는 그림과 똑같은 만큼 내려앉는다. */
  function pathHeightAt(px: number, pz: number) {
    const shoulderEnd = shoulder.reach * shoulder.width;
    let bestDistance = Infinity;
    let bestCode: PathCode | null = null;
    let bestIsShoulder = false;
    let weightSum = 0;
    let heightSum = 0;
    let bestY = 0;

    let candidates: IndexedSegment[] | null = null;
    if (pathIndex) {
      const gx = Math.floor(px / INDEX_CELL) - pathIndex.gx0;
      const gz = Math.floor(pz / INDEX_CELL) - pathIndex.gz0;
      if (gx < 0 || gz < 0 || gx >= pathIndex.width || gz >= pathIndex.depth) return null;
      const cell = pathIndex.cells[gx * pathIndex.depth + gz];
      if (!cell) return null;
      candidates = cell;
    }

    for (const { path: t, segment: s } of candidates ?? allSegments ?? []) {
      const halfWidth = t.width / 2;
      const limit = halfWidth + shoulderEnd;
      const { distance, arcLength } = projectOnSegment(px, pz, s);
      if (distance > limit) continue;
      const outside = Math.max(0, (distance - halfWidth) / Math.max(1e-6, shoulder.width));
      const sink = shoulder.drop * Math.pow(outside / Math.max(1e-6, shoulder.reach), 1.5);
      const y = t.startElevation + t.rise * (arcLength / t.fineLength) - sink;
      // 가장 가까운 선분 하나만 고르면 코너에서 높이가 튄다(한 걸음에 0.7 m) — 가까울수록 무게를 주어 섞는다.
      // 무게는 밴드 끝에서 정확히 0 이어야 계단이 안 생긴다. 한계 + 0.05 로 나누는 건 그림의 치마 끝이 밴드 끝과
      // 같은 거리라, 한계로 나누면 무게합이 0 → 0/0 = NaN 이 지오메트리로 흘러갔기 때문이다.
      const f = Math.max(0, 1 - distance / (limit + 0.05));
      const w = (f * f * f) / (distance * distance + 0.02);
      weightSum += w;
      heightSum += y * w;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCode = t.code;
        bestIsShoulder = distance > halfWidth;
        bestY = y;
      }
    }
    if (!bestCode) return null;
    // 무게가 부동소수 끝자리로 0 이면 가장 가까운 선분 값. 어떤 경우에도 NaN 을 내보내지 않는다.
    const blended = weightSum > 1e-12 ? heightSum / weightSum : bestY;
    return {
      distance: bestDistance,
      path: bestCode,
      isShoulder: bestIsShoulder,
      y: Number.isFinite(blended) ? blended : bestY,
    };
  }

  // 산허리. 도면은 구역·통로 높이만 말하고 나머지는 EL 0 이라, T3·T4 는 13 m 상공에 뜬 리본이었다(갓길 밖은 허공).
  // 실제 산길은 산허리를 깎은 것이므로 가까운 설계면에서 일정 기울기로 흘러내리는 흙더미로 채운다.
  //   올림 = max(높은 설계면 − 거리 × 기울기), 내림 = min(낮은 설계면 + 거리 × 기울기), 지대 = min(올림, 내림)
  // 원뿔들의 최대·최소라 어느 설계면과도 경계에서 정확히 만나 이음매가 안 생긴다. 절벽 배터 띠는 채우지 않는다.
  const HILL_SLOPE = 0.62; // ≈ 32° — 굴러떨어지지 않고 내려올 수 있는 자연 사면
  // 골 쪽을 32° 로 깎으면 비탈길을 받치던 산허리 자체가 파여 6 m 짜리 구멍이 남았다. 테라스 가장자리는 원래 급하다.
  const VALLEY_SLOPE = 1.6; // ≈ 58°
  const HILL_REACH = 24; // 이보다 멀면 흙더미가 닿지 않는다

  // 원뿔만으로 만든 산허리는 골프장 그린 같은 깔때기라 판정인 여기에 굴곡을 넣는다(그림도 이 값을 본다).
  // 설계면 가까이에서는 0 으로 사그라든다 — 도면 높이를 흔들면 그게 곧 이음매다.
  const undulationNoise = createNoise(31337);
  const undulation = (px: number, pz: number, nearest: number) => {
    const strength = Math.min(1, Math.max(0, (nearest - 0.6) / 3.4));
    if (strength <= 0) return 0;
    return (
      (undulationNoise(px * 0.055, pz * 0.055) * 1.0 + undulationNoise(px * 0.14 + 40, pz * 0.14 + 40) * 0.35) *
      1.9 *
      strength
    );
  };

  const lowZones = zones.filter((z) => z.elevation <= 0);

  function hillsideHeight(px: number, pz: number) {
    let raise = 0;
    let nearest = Infinity;
    for (const z of zones) {
      const d = distanceToBox(px, pz, z.x, z.z);
      if (d < nearest) nearest = d;
      if (z.elevation <= 0 || d > HILL_REACH) continue;
      const h = z.elevation - d * HILL_SLOPE;
      if (h > raise) raise = h;
    }
    // 흙더미는 대세만 맞으면 되니 성긴 도면 조각으로 충분하다
    for (const t of measuredPaths) {
      const limit = t.width / 2 + shoulder.reach * shoulder.width;
      for (const s of t.segments) {
        const { distance, arcLength } = projectOnSegment(px, pz, s);
        const d = Math.max(0, distance - limit);
        if (d < nearest) nearest = d;
        if (d > HILL_REACH) continue;
        const y = t.startElevation + t.rise * (arcLength / t.planarLength) - shoulder.drop;
        const h = y - d * HILL_SLOPE;
        if (h > raise) raise = h;
      }
    }
    const wobble = undulation(px, pz, nearest);
    if (raise <= 0) return Math.max(0, wobble);

    // 낮은 설계면(EL 0 테라스·강)이 옆에 있으면 그리로 흘러내린다
    let lower = Infinity;
    for (const z of lowZones) {
      const d = distanceToBox(px, pz, z.x, z.z);
      const h = z.elevation + d * VALLEY_SLOPE;
      if (h < lower) lower = h;
    }
    // 강도 낮은 면 — 물가로 갈수록 땅이 내려앉아야 둑이 안 선다
    lower = Math.min(lower, Math.max(0, RIVER.zStart - pz) * VALLEY_SLOPE);
    return Math.max(0, Math.min(raise, lower) + wobble);
  }

  // 통로 둑. T3 는 Z4 한가운데서 시작하고 T4 는 +4.7 m 인 채로 Z1 에 들어와, 길만 띄우면 갓길 옆이 절벽(4.2 m 단차)이다.
  // 아무 조각이나 쌓게 두면 Z3 위를 지나는 T4 가 Z2 에 9 m 흙산을 붓는다 —
  //   구역 안이면 그 구역 안을 지나는 조각만, 미설계 자리면 낮은 구역(EL ≤ 0) 안을 지나는 조각만 쌓는다.
  // 구역 안팎에서 같은 함수를 부르므로 경계에서 값이 어긋날 수 없다.
  const EMBANKMENT_SLOPE = 1.4; // ≈ 55° — 쌓은 둑이라 자연 사면보다 급하다
  // T4 스위치백 꼭짓점(21.5, 29)은 Z1 경계에서 1 m 북쪽인데 +5.8 m 다. 딱 자르면 3.5 m 턱이 남아 2 m 넉넉히 본다.
  const EMBANKMENT_MARGIN = 2;
  const zoneNear = (x: number, z: number) =>
    zones.find(
      (v) =>
        x >= v.x[0] - EMBANKMENT_MARGIN &&
        x <= v.x[1] + EMBANKMENT_MARGIN &&
        z >= v.z[0] - EMBANKMENT_MARGIN &&
        z <= v.z[1] + EMBANKMENT_MARGIN,
    ) ?? null;

  function embankmentHeight(px: number, pz: number, baseZone: Zone | null) {
    let h = 0;
    for (const t of measuredPaths) {
      const limit = t.width / 2 + shoulder.reach * shoulder.width;
      for (const s of t.segments) {
        const { distance, arcLength } = projectOnSegment(px, pz, s);
        const d = Math.max(0, distance - limit);
        if (d > 12) continue;
        const f = Math.max(0, Math.min(1, (arcLength - s.startDistance) / s.length));
        const cx = s.x1 + (s.x2 - s.x1) * f;
        const cz = s.z1 + (s.z2 - s.z1) * f;
        const zone = zoneNear(cx, cz);
        if (!zone) continue;
        if (baseZone ? zone.code !== baseZone.code : zone.elevation > 0) continue;
        const y = t.startElevation + t.rise * (arcLength / t.planarLength) - shoulder.drop;
        const v = y - d * EMBANKMENT_SLOPE;
        if (v > h) h = v;
      }
    }
    return h;
  }

  // 블렌더가 구운 높이표(있으면)는 y 만 덮어쓴다. 구역·통로·갓길·낙하·물 깃발은 사각형·폴리라인 판정이라
  // 표와 무관하고 씬 진행·퍼즐이 거기 걸려 있다. 표를 안 끼우면 해석식 높이 그대로다.
  let heightTable: Pick<HeightTable, "heightAt"> | null = null;
  function setHeightTable(table: Pick<HeightTable, "heightAt"> | null | undefined) {
    heightTable = table ?? null;
  }

  // 연결로는 도면 밖 설계라 지형이 직접 만들지 않고 씬이 끼워 준다. 안 끼우면 없는 것과 같다.
  let ramp: RampSurface | null = null;
  function setRamp(value: RampSurface | null | undefined) {
    ramp = value ?? null;
  }
  // 원경 들판 높이. 안 끼우면 코어 밖이 y = 0 이라 연결로로 내려가면 들판보다 0.3 m 뜬 보이지 않는 평면을 걷는다.
  let outerGround: HeightAt | null = null;
  function setOuterGround(value: HeightAt | null | undefined) {
    outerGround = value ?? null;
  }

  /**
   * 이 자리의 바닥. ① 통로가 최우선(층을 잇는 다리라 구역 안쪽까지 통로 높이를 따라야 이음매가 안 튄다)
   * ② 구역 ③ 그 밖은 산허리. 절벽 띠·강도 ③ 이라 발을 헛디디면 그 높이만큼 떨어진다(§6 ②).
   */
  function groundAt(px: number, pz: number): GroundSample {
    const sample = analyticGroundAt(px, pz);
    if (heightTable) {
      const y = heightTable.heightAt(px, pz);
      // null 이면 코어 밖이다 — 거기는 연결로·원경 들판이 받친다.
      if (y !== null) return { ...sample, y };
    }
    return sample;
  }

  function analyticGroundAt(px: number, pz: number): GroundSample {
    const onPath = pathHeightAt(px, pz);
    if (onPath)
      return {
        y: onPath.y,
        zone: null,
        path: onPath.path,
        isShoulder: !!onPath.isShoulder,
        isFall: false,
        isWater: false,
      };

    for (const z of zones) {
      if (isWithin(px, z.x) && isWithin(pz, z.z))
        return {
          y: Math.max(z.elevation, embankmentHeight(px, pz, z)),
          zone: z.code,
          path: null,
          isFall: false,
          isWater: false,
        };
    }

    // 절벽 배터 띠 — 채우지 않는다. 그림과 같은 면을 돌려주고 isFall 로만 표시해 면을 따라 미끄러져 내려간다.
    // 띠 안이라고 다 벼랑이 아니다 — CLIFF_OUTLINE 이 x 마다 마루·발치·높이를 흔든다(그림과 같은 함수).
    if (isWithin(px, cliff.x) && pz >= cliff.zTop && pz <= cliff.zBottom) {
      const { crest, toe, height: wallHeight } = CLIFF_OUTLINE(px);
      if (pz <= crest) {
        // 마루보다 북쪽은 아직 어깨(선반) — 설 수 있다.
        return { y: wallHeight, zone: null, path: null, isFall: false, isWater: false };
      }
      if (pz >= toe) {
        // 발치보다 남쪽은 이미 자갈밭 높이
        return { y: 0, zone: null, path: null, isFall: false, isWater: false };
      }
      const f = (pz - crest) / Math.max(0.05, toe - crest);
      return { y: wallHeight * (1 - f), zone: null, path: null, isFall: true, isWater: false };
    }

    // 무대 밖 연결로 — 코어 밖에서만 본다. 코어 안 판정(고리 75.1 m)에는 영향이 없다.
    if (ramp && isOutsideCore(px, pz) && ramp.isOn(px, pz)) {
      return { y: ramp.heightAt(px, pz), zone: null, path: "연결로", isFall: false, isWater: false };
    }

    const isWater = pz >= RIVER.zStart;
    // 강바닥은 물가에서부터 내려간다. 수면과 같은 높이면 물결 사이로 바닥이 비쳐 젖은 자갈밭처럼 보였다.
    const riverbedDepth = isWater ? -Math.min(2.6, (pz - RIVER.zStart) * 0.55) : 0;
    if (outerGround && isOutsideCore(px, pz) && !isWater)
      return { y: outerGround(px, pz), zone: null, path: null, isFall: false, isWater: false };
    return {
      y: isWater ? riverbedDepth : Math.max(hillsideHeight(px, pz), embankmentHeight(px, pz, null)),
      zone: null,
      path: null,
      isFall: false,
      isWater,
    };
  }

  // 시야 차단물은 실제로 못 지나간다(발 ~ 바닥 + 높이 구간 안에 발밑이 있을 때만).
  // clearedBlockers 에 든 코드는 씬이 끝나 치운 것 — 그리기와 판정이 반드시 같이 열려야 한다.
  const clearedBlockers = new Set<string>();
  function blockedAt(px: number, pz: number, y = 0, radius = 0.3) {
    for (const b of blockers) {
      if (clearedBlockers.has(b.code)) continue;
      const top = b.floor + b.height;
      if (y < b.foot - 1.5 || y > top) continue;
      if (px > b.x[0] - radius && px < b.x[1] + radius && pz > b.z[0] - radius && pz < b.z[1] + radius) return b.code;
    }
    return null;
  }

  // 계기판이 쓸 이름표
  const zoneNames: Record<string, string> = Object.fromEntries(zones.map((z) => [z.code, z.name]));
  const pathNames: Record<string, string> = Object.fromEntries(paths.map((t) => [t.code, t.name]));

  function placeName(px: number, pz: number) {
    const g = groundAt(px, pz);
    if (g.path) return `${g.path} ${pathNames[g.path] ?? ""}`.trim();
    if (g.zone) return `${g.zone} ${zoneNames[g.zone] ?? ""}`.trim();
    if (g.isWater) return RIVER.name;
    if (g.isFall) return `${cliff.name} 면`;
    return "미설계";
  }

  return {
    zones,
    measuredPaths,
    blockers,
    /** 치운 차단물 코드 — 그리는 쪽과 같은 객체를 본다 */
    clearedBlockers,
    setRamp,
    setOuterGround,
    setHeightTable,
    cliff,
    measuredLoop,
    measuredWalk,
    groundAt,
    blockedAt,
    placeName,
  };
}

export type Terrain = ReturnType<typeof createTerrain>;

/** Playable Core 밖으로는 못 나간다 — 설정과 무관하게 고정 */
export const CORE_BOUNDS = {
  minX: CORE.x[0] + 0.5,
  maxX: CORE.x[1] - 0.5,
  minZ: CORE.z[0] + 0.5,
  maxZ: CORE.z[1] - 0.5,
};

/** 도면 기본값 그대로인 지형. Leva 가 아직 없는 첫 카메라 자리 같은 데서 쓴다(로드 때 계산). */
export const DEFAULT_TERRAIN = createTerrain();
