// 구역 바닥을 코드로 만든다(옛 지형 경로 — Leva 「블렌더지형」을 끄면 이쪽이 땅을 그린다).
// 모델링이 아니라 코드인 이유: 절벽 높이가 아직 미정이고, 걷는 바닥(sitePlan 숫자)과 보이는 바닥이 어긋나면 안 된다.
//
// 툰 셰이딩은 위를 보는 바닥을 한 칸의 단색으로 뭉갠다 → 굴곡은 꼭짓점 색(알베도)에 굽는다.
// 요철은 ±0.12 m 를 못 넘으니(밟히는 턱처럼 보인다) 지오메트리는 얕게 밀고 노멀만 과장한다.
// 자갈은 상자가 아니라 정이십면체를 흔든 깎인 돌을 돌려 쓰고, 소음으로 뭉치고 비게 뿌린다.
// 바깥과 주고받는 좌표·크기는 미터, 지오메트리만 유닛이다.

import * as THREE from "three";

import { makeRandom } from "@/engine/random";

import { CLIFF_OUTLINE, UNITS_PER_METER, type Cliff, type Range, type ZoneCode } from "../plan/sitePlan";
import type { GroundSurface } from "./groundSurface";

export type GroundStyleCode = ZoneCode | "undesigned";

/** 바닥의 성격. 도면 숫자가 아니라 화풍 값이라 sitePlan 이 아니라 여기 둔다. */
export interface GroundStyle {
  /** 위아래로 흔들리는 폭(±m). 0.12 를 넘기지 않는다 */
  bump: number;
  /** 1 m 당 주기 — 클수록 잔결 */
  grainScale: number;
  /** 꼭짓점 색이 흔들리는 세기. 채널마다 달라 색조도 흔들린다 */
  mottle: number;
  /** 1 m² 당 알 개수 */
  density: number;
  pebbleSize: Range;
  /** 1 이면 공, 작을수록 넓적한 돌 */
  flatness: number;
  /** 0 이면 고르게, 1 에 가까울수록 뭉쳐서 뿌린다 */
  clumping: number;
  /** 가끔 섞는 큰 바위 — 없으면 알갱이 크기가 한 가지라 「14 m 절벽 아래」 스케일이 안 읽힌다 */
  boulder: { chance: number; size: Range };
  color: string;
  color2: string;
  pebbleColor: string;
  shade: string;
}

export const GROUND_STYLE: Record<GroundStyleCode, GroundStyle> = {
  // 나루터 — 사람이 밟아 다져진 흙. 잔자갈이 드문드문.
  Z1: {
    bump: 0.05,
    grainScale: 0.35,
    mottle: 0.1,
    density: 0.5,
    pebbleSize: [0.08, 0.24],
    flatness: 0.45,
    clumping: 0.5,
    boulder: { chance: 0.012, size: [0.7, 1.6] },
    color: "#93836B",
    color2: "#6E5F49",
    pebbleColor: "#8F8270",
    shade: "#4E4436",
  },
  // 자갈밭 — 이 맵에서 바닥이 주인공인 유일한 구역이라 촘촘하게.
  Z2: {
    bump: 0.09,
    grainScale: 0.55,
    mottle: 0.12,
    density: 3.4,
    pebbleSize: [0.1, 0.4],
    flatness: 0.6,
    clumping: 0.75,
    boulder: { chance: 0.02, size: [0.9, 2.6] },
    color: "#9A968E",
    color2: "#6F7068",
    pebbleColor: "#94908A",
    shade: "#4A4C50",
  },
  // 바위 위 — 알갱이가 아니라 암반이 깨진 조각. 크고 납작하게.
  Z3: {
    bump: 0.07,
    grainScale: 0.5,
    mottle: 0.13,
    density: 0.45,
    pebbleSize: [0.22, 0.9],
    flatness: 0.22,
    clumping: 0.6,
    boulder: { chance: 0.03, size: [1.0, 2.4] },
    color: "#9C917A",
    color2: "#77786A",
    pebbleColor: "#9A907A",
    shade: "#4C4738",
  },
  // 능선 — 흙에 풀. 요철이 가장 크고 알은 적다.
  Z4: {
    bump: 0.11,
    grainScale: 0.7,
    mottle: 0.14,
    density: 0.7,
    pebbleSize: [0.12, 0.36],
    flatness: 0.5,
    clumping: 0.8,
    boulder: { chance: 0.02, size: [0.8, 2.0] },
    color: "#87956F",
    color2: "#5E6B4C",
    pebbleColor: "#838E71",
    shade: "#3A452F",
  },
  // 도면에 아무것도 없는 자리. 회색이면 들판 한가운데 코어만 패치로 떠서 바깥 들판과 같은 계열로 둔다.
  // 「설계 안 됨」 신호는 색이 아니라 디테일이 없다는 것이 준다.
  undesigned: {
    bump: 0.045,
    grainScale: 0.4,
    mottle: 0.09,
    density: 0.16,
    pebbleSize: [0.1, 0.3],
    flatness: 0.55,
    clumping: 0.7,
    boulder: { chance: 0.01, size: [0.6, 1.4] },
    color: "#82885F",
    color2: "#6E7550",
    pebbleColor: "#8A8C74",
    shade: "#4A5038",
  },
};

export type Noise2D = (x: number, z: number) => number;

/** 시드 고정 값소음(세 겹). 시드가 같으면 팀원 화면에도 똑같이 뜬다. */
export function createNoise(seed: number): Noise2D {
  const random = makeRandom(seed);
  const N = 128;
  // N 이 2의 거듭제곱이라 나머지 대신 비트 마스크 — 음수도 결과가 같다(-1 & 127 === 127).
  const mask = N - 1;
  const table = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) table[i] = random() * 2 - 1;

  // 셈하는 차례를 바꾸면 부동소수 끝자리가 달라져 지형 지문이 바뀐다.
  const layer = (x: number, z: number) => {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const tx = x - xi;
    const tz = z - zi;
    const u = tx * tx * (3 - 2 * tx);
    const v = tz * tz * (3 - 2 * tz);
    const x0 = (xi & mask) * N;
    const x1 = ((xi + 1) & mask) * N;
    const z0 = zi & mask;
    const z1 = (zi + 1) & mask;
    const a = table[x0 + z0];
    const b = table[x1 + z0];
    const c = table[x0 + z1];
    const d = table[x1 + z1];
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };

  // 넓은 굴곡 · 중간결 · 잔결
  return (x, z) =>
    layer(x, z) * 0.55 + layer(x * 2.7 + 11, z * 2.7 + 7) * 0.3 + layer(x * 7.3 + 31, z * 7.3 + 19) * 0.15;
}

/**
 * 깎인 돌 하나(지름 1 기준). PolyhedronGeometry 는 인덱스가 없어 같은 자리 꼭짓점이 여러 번 들어 있으므로
 * 좌표를 열쇠로 같은 만큼 흔들어야 면이 안 찢어진다.
 */
export function createRockShape(random: () => number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(0.5, 0);
  const position = geometry.attributes.position;
  const scaleByCorner = new Map<string, number>();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let f = scaleByCorner.get(key);
    if (f === undefined) {
      f = 0.6 + random() * 0.62;
      scaleByCorner.set(key, f);
    }
    position.setXYZ(i, x * f, y * f, z * f);
  }
  // 인덱스가 없어 면마다 각진 노멀이 나온다 = 깎인 돌
  geometry.computeVertexNormals();
  return geometry;
}

/** 꼭짓점 색을 한 색으로 깐다(합치려면 모두 같은 속성을 가져야 한다). */
export function applyVertexColors<T extends THREE.BufferGeometry>(
  geometry: T,
  color: { r: number; g: number; b: number },
): T {
  const n = geometry.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

type ShadeLookup = (x: number, z: number) => number;

interface BuildGroundOptions {
  surface: Pick<GroundSurface, "heightAt" | "colorAt" | "normalAt">;
  core: { x: Range; z: Range };
  cliff: Pick<Cliff, "x" | "zBottom">;
  cellsPerMeter: number;
  normalExaggeration: number;
  shade?: ShadeLookup | null;
}

/**
 * 코어 전체를 그물 한 장으로 덮는다. 모든 자리가 surface.heightAt 하나를 보므로 구역 사이 이음매가 없다.
 * 절벽면 메시가 확실히 덮는 칸만 건너뛴다.
 */
export function buildGround({ surface, core, cliff, cellsPerMeter, normalExaggeration, shade }: BuildGroundOptions) {
  const w = core.x[1] - core.x[0];
  const d = core.z[1] - core.z[0];
  const nx = Math.max(2, Math.round(w * cellsPerMeter));
  const nz = Math.max(2, Math.round(d * cellsPerMeter));

  // 격자 꼭짓점을 한 번씩만 잰다(같은 자리를 네 번 묻지 않게)
  const heights = new Float32Array((nx + 1) * (nz + 1));
  const colorGrid = new Float32Array((nx + 1) * (nz + 1) * 3);
  const normalGrid = new Float32Array((nx + 1) * (nz + 1) * 3);
  const xs = new Float32Array(nx + 1);
  const zs = new Float32Array(nz + 1);
  for (let i = 0; i <= nx; i++) xs[i] = core.x[0] + (w * i) / nx;
  for (let j = 0; j <= nz; j++) zs[j] = core.z[0] + (d * j) / nz;

  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i;
      const x = xs[i];
      const z = zs[j];
      heights[k] = surface.heightAt(x, z);
      const c = surface.colorAt(x, z, shade ? shade(x, z) : 0);
      colorGrid[k * 3] = c.r;
      colorGrid[k * 3 + 1] = c.g;
      colorGrid[k * 3 + 2] = c.b;
      const n = surface.normalAt(x, z, normalExaggeration);
      normalGrid[k * 3] = n[0];
      normalGrid[k * 3 + 1] = n[1];
      normalGrid[k * 3 + 2] = n[2];
    }
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  // 칸이 절벽 띠 안에 완전히 들어갈 때만 건너뛴다. 한가운데로 판정하면 어깨(Z 26)에 칸 하나 폭의 틈이 남는다.
  // 마루선이 x 마다 달라 그 x 의 마루 아래만 건너뛴다 — 물러난 마루가 만든 어깨에는 땅을 그린다.
  const isInsideCliffBand = (x0: number, x1: number, z0: number, z1: number) => {
    if (!(x0 >= cliff.x[0] - 0.05 && x1 <= cliff.x[1] + 0.05)) return false;
    const crest = Math.max(CLIFF_OUTLINE(x0).crest, CLIFF_OUTLINE(x1).crest);
    return z0 > crest + 0.02 && z1 < cliff.zBottom - 0.02;
  };

  const pushVertex = (i: number, j: number) => {
    const k = j * (nx + 1) + i;
    positions.push(xs[i] * UNITS_PER_METER, heights[k] * UNITS_PER_METER, zs[j] * UNITS_PER_METER);
    colors.push(colorGrid[k * 3], colorGrid[k * 3 + 1], colorGrid[k * 3 + 2]);
    normals.push(normalGrid[k * 3], normalGrid[k * 3 + 1], normalGrid[k * 3 + 2]);
  };

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (isInsideCliffBand(xs[i], xs[i + 1], zs[j], zs[j + 1])) continue;
      pushVertex(i, j);
      pushVertex(i, j + 1);
      pushVertex(i + 1, j);
      pushVertex(i + 1, j);
      pushVertex(i, j + 1);
      pushVertex(i + 1, j + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

/** 돌 발치 그늘을 칠할 때 쓰는 원 */
export interface ScatterFootprint {
  x: number;
  z: number;
  radius: number;
}

/** 인스턴스로 심는 자갈 자리(편집기가 하나씩 고른다) */
export interface PebbleSpot {
  x: number;
  y: number;
  z: number;
  size: number;
  heightRatio: number;
  widthRatio: number;
  color?: number;
}

interface BuildGroundScatterOptions {
  surface: Pick<GroundSurface, "styleAt" | "steepnessAt" | "heightAt">;
  core: { x: Range; z: Range };
  densityScale: number;
  seed: number;
  clumpNoise: Noise2D;
  canPlace?: ((x: number, z: number) => boolean) | null;
}

/**
 * 맵 전체에 자갈·돌을 뿌린다. 밀도·크기는 그 자리의 결이 정해 경계에서 뚝 끊기지 않는다.
 * 난수를 뽑는 차례가 곧 자갈 배치라(edits.json 이 번호로 붙는다) 순서를 바꾸면 안 된다.
 */
export function buildGroundScatter({
  surface,
  core,
  densityScale,
  seed,
  clumpNoise,
  canPlace,
}: BuildGroundScatterOptions) {
  const random = makeRandom(seed);
  // 돌 모양 표본 여섯을 만들던 자리 — 모양은 이제 인스턴스 무리가 따로 만든다.
  // 그래도 난수 차례는 그대로 소비해야 자리·색이 손 배치(edits.json)와 어긋나지 않는다.
  for (let i = 0; i < 6; i++) createRockShape(random).dispose();

  const w = core.x[1] - core.x[0];
  const d = core.z[1] - core.z[0];
  // 가장 촘촘한 결로 후보를 뽑고 자리마다 제 결의 확률로 거른다
  const maxDensity = Math.max(...Object.values(GROUND_STYLE).map((s) => s.density)) * 3.2;
  const candidateCount = Math.round(w * d * maxDensity * densityScale * 1.6);
  const footprints: ScatterFootprint[] = [];
  const spots: PebbleSpot[] = [];
  const color = new THREE.Color();

  for (let i = 0; i < candidateCount; i++) {
    const x = core.x[0] + random() * w;
    const z = core.z[0] + random() * d;
    const densityRoll = random();
    const clumpRoll = random();
    const sizeRoll = random();
    const widthRatio = 0.7 + random() * 0.6;
    // 모양 번호·회전은 인스턴스 무리가 따로 정한다 — 난수 차례만 지킨다
    random();
    random();
    random();
    random();
    const colorRoll = random();

    const style = surface.styleAt(x, z);
    if (!style) continue;
    // 급사면은 흙이 씻겨 돌이 더 드러난다 — 안 그러면 산허리가 매끈한 초록 벽으로만 보인다.
    const steepness = surface.steepnessAt(x, z);
    if (densityRoll > (style.density * (1 + steepness * 2.2)) / maxDensity) continue;
    const keepChance = THREE.MathUtils.clamp(0.5 + clumpNoise(x * 0.4, z * 0.4) * style.clumping, 0, 1);
    if (clumpRoll > keepChance) continue;
    if (canPlace && !canPlace(x, z)) continue;

    // 큰 것이 있어야 옆의 잔돌이 잔돌로 보인다
    const isBoulder = random() < style.boulder.chance;
    const size = isBoulder
      ? style.boulder.size[0] + random() * (style.boulder.size[1] - style.boulder.size[0])
      : style.pebbleSize[0] + (style.pebbleSize[1] - style.pebbleSize[0]) * Math.pow(sizeRoll, 2.2);
    const height = size * (isBoulder ? Math.min(1, style.flatness + 0.28) : style.flatness);
    const y = surface.heightAt(x, z);
    // 색은 아래에서 난수로 정해진 뒤 얹는다 — 미리 뽑으면 난수 차례가 바뀌어 배치가 달라진다.
    const spot: PebbleSpot = { x, y: y - height * 0.18, z, size, heightRatio: height / size, widthRatio };
    spots.push(spot);
    color
      .copy(new THREE.Color(style.shade))
      .lerp(new THREE.Color(style.color2).lerp(new THREE.Color(style.pebbleColor), colorRoll), 0.34 + random() * 0.62);
    // 인스턴스 무리도 같은 색을 쓴다
    spot.color = color.getHex();
    footprints.push({ x, z, radius: size * 0.55 });
  }
  return { footprints, spots };
}

/** 돌 발치를 어둡게 칠할 때 쓰는 조회기. 격자로 나눠 근처 돌만 본다. */
export function buildContactShadows(footprints: ScatterFootprint[]): ShadeLookup {
  if (!footprints.length) return () => 0;
  // 반경을 크게 잡으면 자갈밭처럼 촘촘한 데서 바닥 전체가 시커메진다 — 돌 바로 발치만.
  const reachOf = (a: ScatterFootprint) => a.radius * 2.1;
  const cell = Math.max(
    0.8,
    footprints.reduce((m, a) => Math.max(m, reachOf(a)), 0),
  );
  const grid = new Map<string, ScatterFootprint[]>();
  for (const a of footprints) {
    const key = `${Math.floor(a.x / cell)},${Math.floor(a.z / cell)}`;
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, (bucket = []));
    bucket.push(a);
  }
  return (x, z) => {
    let darkness = 0;
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const bucket = grid.get(`${cx + i},${cz + j}`);
        if (!bucket) continue;
        for (const a of bucket) {
          const reach = reachOf(a);
          const dist = Math.hypot(x - a.x, z - a.z);
          if (dist < reach) darkness = Math.max(darkness, 1 - dist / reach);
        }
      }
    return darkness * darkness;
  };
}

/**
 * 인스턴스용 돌 표본(지름 1 · 원점 중심). 병합한 돌은 하나를 고를 수 없어 길 위 돌을 못 치운다.
 * 돌은 반쯤 파묻히므로 나무와 달리 밑동이 아니라 중심이 원점이다.
 */
export function rockPrototypes(count = 6, seed = 7301): THREE.BufferGeometry[] {
  const random = makeRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const geometry = createRockShape(random);
    geometry.computeBoundingSphere();
    const r = geometry.boundingSphere?.radius || 0.5;
    geometry.scale(0.5 / r, 0.5 / r, 0.5 / r);
    prototypes.push(geometry);
  }
  return prototypes;
}
