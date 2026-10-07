// 앙암바위 절벽면·깎인면·바위 덩이·너덜·절벽 수풀 자리.
// 매끈한 판은 14 m 인지 4 m 인지 알 수 없다 — 지층·세로 홈·깊이 그늘이 높이를 재는 눈금이 된다.
// 절벽 띠는 설 수 없는 자리라(terrain 이 낙하로 돌려준다) 1~2 m 씩 실제로 파도 판정과 안 어긋난다.
// 변위는 언제나 안쪽으로만 — Z2(자갈밭) 쪽으로 튀어나오면 걷는 사람 몸에 바위가 박힌다.
// 좌표·크기는 미터, 지오메트리만 유닛.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeRandom } from "@/engine/random";
import { applyVertexColors, createRockShape, type Noise2D } from "./ground";
import { CLIFF_OUTLINE, UNITS_PER_METER, type Cliff } from "../plan/sitePlan";

type Range = [number, number];
type HeightAt = (x: number, z: number) => number;
export type CliffBand = Pick<Cliff, "x" | "zTop" | "zBottom" | "height">;

export interface RockPalette<T = string> {
  bright: T;
  dark: T;
  wet: T;
  moss: T;
}

// 화풍 값이라 도면이 아니라 여기 둔다
export const CLIFF_STYLE: RockPalette = {
  bright: "#A79C89", // 볕 드는 바위
  dark: "#57503E", // 너무 어두우면 실루엣이 새까맣게 뭉친다
  wet: "#4E5751", // 아래쪽 물가에 닿아 축축한 띠
  moss: "#6B7355", // 층 사이에 낀 이끼
};

// 통로 비탈의 흙벽. 절벽과 같은 구조라 같은 칠하기 규칙을 그대로 태울 수 있다 — 그래야 통일감이 산다.
export const EARTH_WALL_STYLE: RockPalette = {
  bright: "#9C8A6E",
  dark: "#4E4536",
  wet: "#4A4A3E",
  moss: "#68724C",
};

const smooth = (t: number) => t * t * (3 - 2 * t);
export const between = (v: number, a: number, b: number) => THREE.MathUtils.clamp((v - a) / (b - a), 0, 1);

export interface CutSample {
  /** 안쪽으로 파는 깊이(m) */
  d: number;
  layerIndex: number;
  /** 지층 한 겹 안의 자리 0~1 */
  t: number;
}

export interface CutFaceOptions {
  /** 안쪽으로 파는 최대 깊이(m) */
  carveDepth: number;
  /** 가로 지층 한 겹의 높이(m) — 높이의 눈금 */
  strataThickness: number;
  /** 0 = 점토 덩어리 · 1 = 평면으로 쪼개진 바위 */
  angularity: number;
  grainNoise: Noise2D;
  strataNoise: Noise2D;
  /** 1 = 절벽처럼 또렷하게 · 0.5 = 흙비탈처럼 눅게 */
  grainStrength?: number;
  /** 주파수는 22 × 14 m 절벽에 맞췄다. 작은 덩어리는 면 전체가 소음의 한 점이 되어 판때기로 보이니 키운다. */
  patternScale?: number;
  strataStrength?: number;
  /** 빗물이 흘러내린 세로 홈 — 실제 앙암바위 사진의 주역 */
  verticalGrooves?: number;
  jointStrength?: number;
}

/**
 * 깎인 면의 파임 규칙 — 절벽도 통로 비탈도 이것 하나를 세기만 달리해 쓴다.
 * 사진 속 앙암바위는 가로 지층·각진 절리 대신 둥글게 부푼 암괴에 세로 홈이 지배한다.
 * 그래서 세 세기를 손잡이로 뺐다. 비탈은 기본값 그대로, 절벽만 다른 값을 넘긴다.
 */
export function buildCutFace({
  carveDepth,
  strataThickness,
  angularity,
  grainNoise,
  strataNoise,
  grainStrength = 1,
  patternScale = 1,
  strataStrength = 1,
  verticalGrooves = 0,
  jointStrength = 1,
}: CutFaceOptions) {
  return (X: number, Y: number, Z: number): CutSample => {
    const x = X * patternScale;
    const y = Y * patternScale;
    const z = Z * patternScale;
    // ① 가로 지층 — 층을 세는 좌표를 흔들고 기울여야 베개를 쌓은 벽이 안 된다.
    //    간격은 실제 미터라 Y 그대로, 흔드는 소음만 배율을 탄다.
    const yLayer = Y + strataNoise(x * 0.085 + z * 0.05, 4.1) * strataThickness * 1.1 + X * 0.035;
    const layerIndex = Math.floor(yLayer / strataThickness);
    const t = yLayer / strataThickness - layerIndex;
    const layerDepth = 0.3 + 0.7 * (strataNoise(layerIndex * 3.7, x * 0.06 + 1.3) * 0.5 + 0.5);
    // 층 사이는 가는 홈이다 — 아래 25% 만 판다
    const layer = (1 - smooth(Math.min(1, t * 4))) * layerDepth * strataStrength;

    // ①' 세로 홈 — y 를 거의 안 써야 위아래로 길게 이어진 골이 된다
    const groove1 = Math.abs(grainNoise(x * 0.19 + z * 0.11, y * 0.012 + 11));
    const groove2 = Math.abs(grainNoise(x * 0.52 + z * 0.28, y * 0.02 + 37));
    const vertical =
      verticalGrooves > 0
        ? (Math.pow(Math.max(0, 1 - groove1 * 2.2), 2) * 1.0 + Math.pow(Math.max(0, 1 - groove2 * 2.6), 2) * 0.45) *
          verticalGrooves
        : 0;

    // ② 큰 덩어리
    const mass = (grainNoise(x * 0.045 + z * 0.03, y * 0.032) * 0.5 + 0.5) * 1.15;
    // ③ 중간 굴곡
    const bulge = (grainNoise(x * 0.16 + z * 0.1, y * 0.13) * 0.5 + 0.5) * 0.5;
    // ④ 세로 균열 — 너무 깊으면 빛을 못 받아 검은 쐐기가 된다
    const cc = grainNoise(x * 0.2 + y * 0.03 + z * 0.12, y * 0.018);
    const crack = Math.pow(Math.max(0, 1 - Math.abs(cc) * 2.5), 4) * 1.0;

    const raw = (layer * 0.55 + mass * 0.6 + bulge * 0.45 + crack + vertical * 0.9) * grainStrength;
    const smoothDepth = (raw / 2.2) * carveDepth;

    // ⑤ 절리 — 깊이 한 축만 끊으면 수평 선반이 쌓인다. 기울어진 평면 셋으로 칸을 잘라 칸마다 깊이를 달리 준다.
    const cell = (a: number, b2: number, c2: number, size: number, salt: number) => {
      const n = Math.floor((x * a + y * b2 + z * c2) / size);
      // 같은 칸이면 언제나 같은 값
      let h = Math.imul(n ^ salt, 0x27d4eb2d);
      h ^= h >>> 15;
      return ((h >>> 0) % 1024) / 1024;
    };
    const joint =
      cell(0.92, 0.28, 0.27, 2.3, 0x9e37) * 0.45 +
      cell(-0.35, 0.78, 0.52, 1.7, 0x85eb) * 0.33 +
      cell(0.41, -0.24, 0.88, 3.1, 0xc2b2) * 0.22;
    const angular = joint * carveDepth * jointStrength;

    return { d: smoothDepth * (1 - angularity * 0.55) + angular * angularity, layerIndex, t };
  };
}

interface PaintSample {
  layerIndex: number;
  d: number;
  t: number;
  /** 0(위) ~ 1(아래) */
  below?: number;
  /** 면마다 조금씩 흔드는 밝기 — 층색만으로는 가까이서 한 톤으로 보인다 */
  speckle?: number;
}

interface PaintOptions {
  palette: RockPalette<THREE.Color>;
  carveDepth: number;
  strataNoise: Noise2D;
  mossStrength?: number;
}

/** 깎인 면 칠하기 — 층색 → 깊이 그늘 → 아래쪽 젖음 → 층 홈의 이끼. 절벽·비탈이 같이 쓴다. */
export function paintCutFace(
  c: THREE.Color,
  { layerIndex, d, t, below = 0, speckle }: PaintSample,
  { palette, carveDepth, strataNoise, mossStrength = 0.35 }: PaintOptions,
) {
  const layerTone = strataNoise(layerIndex * 7.1, 2.9) * 0.5 + 0.5;
  c.copy(palette.dark).lerp(palette.bright, 0.34 + layerTone * 0.66);
  // 0.8 이면 가장 깊은 데가 순수 어둠색이 되어 하늘을 등지면 새까맣게 뭉친다
  c.lerp(palette.dark, between(d / Math.max(0.01, carveDepth), 0, 0.9) * 0.62);
  c.lerp(palette.wet, between(below, 0.76, 1) * 0.4);
  c.lerp(palette.moss, (1 - between(t, 0, 0.14)) * mossStrength * (1 - between(below, 0.72, 1)));
  if (speckle !== undefined) c.offsetHSL(0, 0, speckle);
  return c;
}

interface CliffFacePoint extends CutSample {
  x: number;
  y: number;
  z: number;
  y0: number;
  v: number;
}

interface CliffFaceOptions {
  cliff: CliffBand;
  /** 1 m 를 몇 칸으로 나눌지 */
  cellsPerMeter: number;
  carveDepth: number;
  strataThickness: number;
  angularity: number;
  grainNoise: Noise2D;
  strataNoise: Noise2D;
  blotchNoise: Noise2D;
}

export function buildCliffFace({
  cliff,
  cellsPerMeter,
  carveDepth,
  strataThickness,
  angularity,
  grainNoise,
  strataNoise,
  blotchNoise,
}: CliffFaceOptions) {
  const { x: X, zTop, zBottom, height: h } = cliff;
  const w = X[1] - X[0];
  const batter = zBottom - zTop; // 도면상 4 m
  const faceLength = Math.hypot(batter, h);
  const nu = Math.max(2, Math.round(w * cellsPerMeter * 1.6)); // 윤곽이 흔들리므로 가로를 촘촘히
  const nv = Math.max(2, Math.round(faceLength * cellsPerMeter));
  // v = 1 에서 끊으면 바위가 지면 선에서 잘려 얹힌 것처럼 보인다. 땅 아래로 더 내려 묻는다.
  const vEnd = 1.18;

  // 마루·발치·높이가 x 마다 흔들리므로 면의 바깥 방향도 x 마다 다르다
  const normalAt = (x: number) => {
    const { crest, toe, height: wall } = CLIFF_OUTLINE(x);
    const span = Math.max(0.3, toe - crest);
    const L = Math.hypot(wall, span) || 1;
    return { nz: wall / L, ny: span / L, crest, toe, wall };
  };

  // 위쪽만 0 으로 여민다. 아래까지 여미면 밑동 한 줄이 매끈해져 바위가 선반 위에 들려 보인다.
  const edgeFade = (v: number) => Math.min(1, v * 5);

  // 절벽은 세로 홈이 주역이다(buildCutFace 설명)
  const carve = buildCutFace({
    carveDepth,
    strataThickness,
    angularity,
    grainNoise,
    strataNoise,
    strataStrength: 0.12, // 가로 지층은 거의 지운다
    verticalGrooves: 1.25,
    jointStrength: 0.3, // 각진 격자는 흔적만
  });
  const carveAt = (x: number, y: number, v: number): CutSample => {
    const r = carve(x, y, 0);
    return { d: r.d * edgeFade(v), layerIndex: r.layerIndex, t: r.t };
  };
  // 양옆 끝을 더 깊이 깎아 가운데가 부푼 암괴로 읽히게 한다. 밖으로 부풀리면 Z2 를 침범한다.
  const sideTaper = (u: number) => 1 + Math.pow(Math.abs(u * 2 - 1), 2.2) * 1.15;
  // 홈 세기가 일정하면 골판지 벽(인공물)이 된다. x 를 따라 0.35~1.5 로 흔든다.
  const patternStrength = (x: number) => 0.35 + (grainNoise(x * 0.075 + 3.3, 7.7) * 0.5 + 0.5) * 1.15;

  const pointAt = (u: number, v: number): CliffFacePoint => {
    const x = X[0] + w * u;
    const { nz: NZ, ny: NY, crest, toe, wall } = normalAt(x);
    const z0 = crest + (toe - crest) * v;
    const y0 = wall * (1 - v);
    const { d, layerIndex, t } = carveAt(x, y0, v);
    const dd = d * sideTaper(u) * patternStrength(x);
    return { x, y: y0 - NY * dd, z: z0 - NZ * dd, d: dd, y0, v, layerIndex, t };
  };

  // 인덱스 없이 찍는다 — 면마다 각진 노멀 = 깎인 바위
  const positions: number[] = [];
  const colors: number[] = [];
  const bright = new THREE.Color(CLIFF_STYLE.bright);
  const dark = new THREE.Color(CLIFF_STYLE.dark);
  const wet = new THREE.Color(CLIFF_STYLE.wet);
  const moss = new THREE.Color(CLIFF_STYLE.moss);
  const c = new THREE.Color();

  const colorAt = (p: CliffFacePoint) => {
    paintCutFace(
      c,
      {
        layerIndex: p.layerIndex,
        d: p.d,
        t: p.t,
        below: p.v,
        speckle: blotchNoise(p.x * 1.9, p.y0 * 1.9) * 0.11,
      },
      { palette: { bright, dark, wet, moss }, carveDepth, strataNoise },
    );
    // 세로로 흘러내린 물 얼룩 — 낙차를 강조한다(절벽에만)
    const streak = blotchNoise(p.x * 0.5, p.y0 * 0.03);
    c.offsetHSL(0, 0, streak * 0.075);
    return c;
  };

  const emit = (p: CliffFacePoint) => {
    positions.push(p.x * UNITS_PER_METER, p.y * UNITS_PER_METER, p.z * UNITS_PER_METER);
    const cc = colorAt(p);
    colors.push(cc.r, cc.g, cc.b);
  };
  const face = (p1: CliffFacePoint, p2: CliffFacePoint, p3: CliffFacePoint) => {
    emit(p1);
    emit(p2);
    emit(p3);
  };

  // 앞면 — 마지막 띠(v 1~1.18)가 땅 아래로 묻힌다
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const v0 = (j / nv) * vEnd;
      const v1 = ((j + 1) / nv) * vEnd;
      const a = pointAt(i / nu, v0);
      const b = pointAt((i + 1) / nu, v0);
      const d2 = pointAt((i + 1) / nu, v1);
      const e = pointAt(i / nu, v1);
      // 바깥(Z2 쪽)에서 보이도록 감는다
      face(a, e, b);
      face(b, e, d2);
    }
  }

  // 옆 마구리 — 앞면만 있으면 양 끝에서 종잇장 옆구리와 그 너머 빈 속이 보인다.
  // 깊이를 끝에서 좁혀 절벽이 지형 속으로 스며들게 하되, 0 까지 좁히면 면이 뒤집혀 검은 쐐기가 나서 최소 두께를 남긴다.
  const backDepth = (u: number) => (carveDepth + 0.8) * Math.max(0.14, Math.min(1, Math.sin(Math.PI * u) * 3.2));
  const innerAt = (u: number, v: number): CliffFacePoint => {
    const p = pointAt(u, v);
    const { nz: NZ, ny: NY, crest, toe, wall } = normalAt(p.x);
    const z0 = crest + (toe - crest) * v;
    const y0 = wall * (1 - v);
    const depth = backDepth(u);
    // 원본은 안쪽 점에 층번호·t 가 없어(undefined) 색 계산이 NaN 이 된다. 같은 값을 내려고 NaN 을 넣는다.
    return { x: p.x, y: y0 - NY * depth, z: z0 - NZ * depth, d: carveDepth, y0, v, layerIndex: NaN, t: NaN };
  };
  for (const [u, flip] of [
    [0, false],
    [1, true],
  ] as const) {
    for (let j = 0; j < nv; j++) {
      const v0 = (j / nv) * vEnd;
      const v1 = ((j + 1) / nv) * vEnd;
      const a = pointAt(u, v0);
      const b = pointAt(u, v1);
      const A = innerAt(u, v0);
      const B = innerAt(u, v1);
      if (flip) {
        face(a, b, A);
        face(A, b, B);
      } else {
        face(a, A, b);
        face(A, B, b);
      }
    }
  }

  // 아랫자락 — 바닥 요철이 아무리 파여도 틈이 안 나게 더 깊게 늘인다
  for (let i = 0; i < nu; i++) {
    const a = pointAt(i / nu, vEnd);
    const b = pointAt((i + 1) / nu, vEnd);
    const A = { ...a, y: a.y - 1.6 };
    const B = { ...b, y: b.y - 1.6 };
    face(a, A, b);
    face(A, B, b);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals(); // 인덱스가 없어 면마다 평평한 노멀 = 각진 바위
  return geo;
}

export interface StoneSpot {
  x: number;
  y: number;
  z: number;
  size: number;
}

/**
 * 절벽 발치에 붙이는 큰 암괴 자리(도면 4 m 띠 밖). 띠 안에서는 아무리 흔들어도 판(벽)이다.
 * 네모 덩어리(buildBoulders)는 상자로 보여 정이십면체 돌(createRockShape)을 쓴다. 그림 전용이라 Z2 가장자리에 둔다.
 * 마루에 얹은 큰 돌은 공중에 뜬 검은 덩어리로 보여 뺐다 — 둥근 머리는 Z3 고도를 바꾸는 도면 안건이다.
 */
export function boulderSpots({ cliff, groundHeight }: { cliff: CliffBand; groundHeight?: HeightAt }) {
  const spots: StoneSpot[] = [];
  const { x: X } = cliff;
  const at = (u: number) => X[0] + (X[1] - X[0]) * u;
  // [u, 크기, 벽 앞으로 뻗음]
  const toeSeeds = [
    [0.06, 4.2, 1.6],
    [0.15, 2.6, 0.9],
    [0.28, 5.0, 2.2],
    [0.4, 3.0, 1.2],
    [0.52, 5.6, 2.6],
    [0.64, 2.8, 1.0],
    [0.76, 4.4, 1.8],
    [0.88, 3.2, 1.3],
    [0.96, 2.4, 0.8],
  ];
  for (const [u, size, forward] of toeSeeds) {
    const x = at(u);
    const { toe } = CLIFF_OUTLINE(x);
    const z = toe + forward;
    spots.push({
      x,
      z,
      // 밑동을 깊이 묻는다 — 얹혀 있으면 떠 보인다
      y: (groundHeight ? groundHeight(x, z) : 0) - size * 0.42,
      size,
    });
  }
  return spots;
}

export interface BushSpot {
  x: number;
  y: number;
  z: number;
  size: number;
}

interface CliffBushOptions {
  cliff: CliffBand;
  count?: number;
  seed: number;
  grainNoise: Noise2D;
  strataNoise: Noise2D;
  carveDepth: number;
  strataThickness: number;
  angularity: number;
}

/**
 * 절벽 틈에 박히는 수풀 자리. 사진 속 바위는 맨살로 서 있지 않다 — 맨 암벽만 두면 모형으로 보인다.
 * 흙이 고이는 골(깎기 값이 깊은 자리)에 붙인다.
 */
export function cliffBushSpots({
  cliff,
  count = 90,
  seed,
  grainNoise,
  strataNoise,
  carveDepth,
  strataThickness,
  angularity,
}: CliffBushOptions) {
  const { x: X, zTop, zBottom, height: h } = cliff;
  const random = makeRandom(seed);
  const batter = zBottom - zTop;
  const L = Math.hypot(h, batter) || 1;
  const nz = h / L;
  const ny = batter / L;
  const carve = buildCutFace({
    carveDepth,
    strataThickness,
    angularity,
    grainNoise,
    strataNoise,
    strataStrength: 0.12,
    verticalGrooves: 1.25,
    jointStrength: 0.3,
  });
  const spots: BushSpot[] = [];
  for (let i = 0; i < count; i++) {
    const u = random();
    // 흙이 아래로 쌓이므로 아래쪽에 몰린다
    const v = Math.pow(random(), 0.6) * 0.98 + 0.02;
    const x = X[0] + (X[1] - X[0]) * u;
    const z0 = zTop + batter * v;
    const y0 = h * (1 - v);
    const { d } = carve(x, y0, 0);
    // 튀어나온 데에는 안 붙는다
    if (d < carveDepth * 0.45) continue;
    // 고르게 흩으면 점을 찍은 것처럼 보인다. 소음으로 뭉치고 비운다.
    const cluster = grainNoise(x * 0.13, y0 * 0.11 + 21) * 0.5 + 0.5;
    // 사진에서도 바위 옆구리가 초록에 잠겨 있고 가운데 암벽만 드러난다 — 좌우 끝을 빽빽하게
    const side = Math.pow(Math.abs(u * 2 - 1), 1.6);
    if (random() > (0.3 + cluster * cluster * 1.0) * (0.55 + side * 1.5)) continue;
    const depth = d * (1 + Math.pow(Math.abs(u * 2 - 1), 2.2) * 1.15);
    spots.push({
      x,
      y: y0 - ny * depth,
      z: z0 - nz * depth,
      // 위로 갈수록 작고 마르게
      size: (0.5 + random() * 1.5) * (0.55 + v * 0.7),
    });
  }
  return spots;
}

interface ScreeOptions {
  cliff: CliffBand;
  count: number;
  seed: number;
  grainNoise: Noise2D;
  /** 주면 그 자리의 진짜 땅에서 잰다. 이상적인 빗면에 얹으면 깎아 낸 암벽보다 떠서 돌이 공중에 걸린다. */
  groundHeight?: HeightAt;
}

// 벼랑 밑 돌무더기 — 저 위에서 떨어졌다는 게 읽힌다. 배터 띠 안(설 수 없는 자리)에만 놓는다.
export function buildScree({ cliff, count, seed, grainNoise, groundHeight }: ScreeOptions) {
  const { x: X, zTop, zBottom, height: h } = cliff;
  const random = makeRandom(seed);
  const shapes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) shapes.push(createRockShape(random));
  const pieces: THREE.BufferGeometry[] = [];
  const bright = new THREE.Color(CLIFF_STYLE.bright);
  const dark = new THREE.Color(CLIFF_STYLE.dark);
  const color = new THREE.Color();
  const quaternion = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const x = X[0] + random() * (X[1] - X[0]);
    // 아래쪽 4분의 1 안에서만
    const v = 0.82 + random() * 0.17;
    const z = zTop + (zBottom - zTop) * v;
    const y = h * (1 - v);
    // 움푹한 데에 더 잘 모인다
    if (grainNoise(x * 0.2, y * 0.2) < -0.35) continue;
    const size = 0.25 + Math.pow(random(), 2.4) * 1.5;
    const flatness = 0.5 + random() * 0.4;
    const widthRatio = 0.7 + random() * 0.6;
    const rotation = [(random() - 0.5) * 1.2, random() * Math.PI * 2, (random() - 0.5) * 1.2];
    const tint = random();

    const g = shapes[Math.floor(random() * shapes.length)].clone();
    quaternion.setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]));
    scale.set(size * UNITS_PER_METER, size * flatness * UNITS_PER_METER, size * widthRatio * UNITS_PER_METER);
    // 얹지 말고 묻는다 — 비탈에 박혀 있어야 굴러떨어지지 않아 보인다
    const base = groundHeight ? groundHeight(x, z) : y;
    position.set(x * UNITS_PER_METER, (base - size * 0.22) * UNITS_PER_METER, z * UNITS_PER_METER);
    matrix.compose(position, quaternion, scale);
    g.applyMatrix4(matrix);
    color.copy(dark).lerp(bright, 0.35 + tint * 0.6);
    pieces.push(applyVertexColors(g, color));
  }

  shapes.forEach((g) => g.dispose());
  if (!pieces.length) return null;
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

interface BoulderPoint extends CutSample {
  x: number;
  y: number;
  z: number;
  isTop: boolean;
}

interface BouldersOptions {
  x: Range;
  z: Range;
  foot: number;
  /** 숫자거나 (x, z) → 높이. Z3 와 Z4 사이 골처럼 비스듬히 올라가는 능선은 함수로 준다. */
  top: number | HeightAt;
  cellsPerMeter: number;
  carveDepth: number;
  angularity: number;
  strataThickness: number;
  grainNoise: Noise2D;
  strataNoise: Noise2D;
  patternScale?: number;
  /** 위로 갈수록 단면을 좁힌다(0 = 상자 · 0.3 = 사다리꼴). 없으면 실루엣이 직육면체라 상자로 보인다. */
  taper?: number;
}

/**
 * 차단물(B1·B2·B3·수목대 받침)의 회색 상자를 각진 바위 덩이로 바꾼다.
 * 시야 차단 장치라 막는 부피가 그대로여야 해서 절벽처럼 안쪽으로만 판다 — 밖으로 부풀면 막힘 상자보다 커진다.
 * 면마다 가장자리에서 파임이 잦아들어 상자 모서리에서 서로 만난다.
 */
export function buildBoulders({
  x: X,
  z: Z,
  foot,
  top,
  cellsPerMeter,
  carveDepth,
  angularity,
  strataThickness,
  grainNoise,
  strataNoise,
  patternScale = 1,
  taper = 0.22,
}: BouldersOptions) {
  const topAt: HeightAt = typeof top === "function" ? top : () => top;
  const positions: number[] = [];
  const colors: number[] = [];
  const bright = new THREE.Color(CLIFF_STYLE.bright);
  const dark = new THREE.Color(CLIFF_STYLE.dark);
  const moss = new THREE.Color(CLIFF_STYLE.moss);
  const c = new THREE.Color();
  const fade = (t: number) => Math.min(1, Math.sin(Math.PI * t) * 2.2);

  // 절벽면과 같은 규칙이라야 한 공간의 바위로 보인다
  const carve = buildCutFace({ carveDepth, strataThickness, angularity, grainNoise, strataNoise, patternScale });

  const emit = (p: BoulderPoint) => {
    positions.push(p.x * UNITS_PER_METER, p.y * UNITS_PER_METER, p.z * UNITS_PER_METER);
    paintCutFace(
      c,
      { layerIndex: p.layerIndex, d: p.d, t: p.t, below: 0 },
      { palette: { bright, dark, wet: dark, moss }, carveDepth, strataNoise, mossStrength: 0 },
    );
    // 꼭대기에는 이끼가 앉는다 — 위와 옆이 갈려야 덩어리로 보인다
    if (p.isTop) c.lerp(moss, 0.35);
    colors.push(c.r, c.g, c.b);
  };
  const face = (a: BoulderPoint, b: BoulderPoint, d: BoulderPoint) => {
    emit(a);
    emit(b);
    emit(d);
  };
  const grid = (pointAt: (u: number, v: number) => BoulderPoint, nu: number, nv: number, flip: boolean) => {
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) {
        const a = pointAt(i / nu, j / nv);
        const b = pointAt((i + 1) / nu, j / nv);
        const d = pointAt((i + 1) / nu, (j + 1) / nv);
        const e = pointAt(i / nu, (j + 1) / nv);
        if (flip) {
          face(a, e, b);
          face(b, e, d);
        } else {
          face(a, b, e);
          face(b, d, e);
        }
      }
  };

  const w = X[1] - X[0];
  const dz = Z[1] - Z[0];
  const cxm = (X[0] + X[1]) / 2;
  const czm = (Z[0] + Z[1]) / 2;
  // 위로 갈수록 단면을 좁힌다 — 직육면체 윤곽을 깨는 가장 값싼 방법
  const narrow = (x: number, z: number, v: number) => {
    const k = 1 - taper * v;
    return [cxm + (x - cxm) * k, czm + (z - czm) * k];
  };
  // 칸 수를 정할 때만 대표 높이를 쓴다
  const typicalTop = (topAt(X[0], Z[0]) + topAt(X[1], Z[1])) / 2;
  const hh = Math.max(0.5, typicalTop - foot);
  const N = (v: number) => Math.max(1, Math.round(v * cellsPerMeter));

  // 옆면 넷 — 파임은 상자 속으로만
  const side =
    (fixedAxis: "x" | "z", value: number, inward: number) =>
    (u: number, v: number): BoulderPoint => {
      const x0 = fixedAxis === "x" ? value : X[0] + w * u;
      const z0 = fixedAxis === "x" ? Z[0] + dz * u : value;
      const y = foot + (topAt(x0, z0) - foot) * v;
      const [x, z] = narrow(x0, z0, v);
      const { d, layerIndex, t } = carve(x, y, z);
      // 세로 모서리에서는 잦아듦을 약하게 — 세게 주면 상자 모서리가 되살아난다
      const dd = d * (0.45 + 0.55 * fade(u)) * fade(v);
      return fixedAxis === "x"
        ? { x: x + inward * dd, y, z, d: dd, layerIndex, t, isTop: false }
        : { x, y, z: z + inward * dd, d: dd, layerIndex, t, isTop: false };
    };
  // 마지막 인자 = 바깥을 보게 감는 방향
  grid(side("x", X[0], +1), N(dz), N(hh), false);
  grid(side("x", X[1], -1), N(dz), N(hh), true);
  grid(side("z", Z[0], +1), N(w), N(hh), true);
  grid(side("z", Z[1], -1), N(w), N(hh), false);

  // 윗면
  grid(
    (u, v) => {
      const x0 = X[0] + w * u;
      const z0 = Z[0] + dz * v;
      const peak = topAt(x0, z0);
      const [x, z] = narrow(x0, z0, 1); // 옆면의 꼭대기와 맞물리게
      const { d, layerIndex, t } = carve(x, peak, z);
      const dd = d * fade(u) * fade(v);
      return { x, y: peak - dd, z, d: dd, layerIndex, t, isTop: true };
    },
    N(w),
    N(dz),
    true,
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}
