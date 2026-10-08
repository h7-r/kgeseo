// 초목 — 나무·덤불·잎더미를 심을 자리와 손으로 깎은 표본, 바닥에 깔 풀.
// 자리는 시드로 늘 같고(누구 화면에서든 같은 나무), 심는 것은 인스턴스 무리가 맡아 편집기가 하나씩 고른다.
// 좌표·크기는 미터, 지오메트리만 유닛(× UNITS_PER_METER).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { makeRandom } from "@/engine/random";

import { toBaseOrigin, type Spot } from "../placement/instanceGroups";
import { UNITS_PER_METER, type Range } from "../plan/sitePlan";
import { applyVertexColors, type HeightAt, type Noise2D } from "../terrain/ground";
import type { GroundSurface } from "../terrain/groundSurface";
import type { Terrain } from "../terrain/terrain";

export const VEGETATION_STYLE = {
  trunk: "#5B4A3A",
  trunkDark: "#33281F",
  leaf: "#6B8052",
  // 너무 어두우면 잎덩이 밑면(해를 못 받는다)이 새까만 덩어리가 된다
  leafDark: "#46543A",
  leafLight: "#8AA05F",
};

// 지형·지표에서 이 파일이 보는 것만 — 걷는 무대·물·벼랑면을 비우고 땅 높이·가파름을 잰다
type GroundProbe = Pick<Terrain, "groundAt">;
type SurfaceProbe = Pick<GroundSurface, "heightAt" | "steepnessAt">;

// 잎덩이 하나 — 정이십면체 꼭짓점을 흔든다. 인덱스가 없어 면마다 각진 노멀이 서고 툰과 잘 맞는다.
function leafClump(random: () => number) {
  const geometry = new THREE.IcosahedronGeometry(0.5, 0);
  const p = geometry.attributes.position;
  const jitter = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    // 같은 자리에 겹친 꼭짓점은 같이 움직여야 면이 안 찢어진다
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let f = jitter.get(key);
    if (f === undefined) {
      f = 0.68 + random() * 0.5;
      jitter.set(key, f);
    }
    p.setXYZ(i, x * f, y * f, z * f);
  }
  geometry.computeVertexNormals();
  return geometry;
}

interface TreeBeltOptions {
  /** 심을 사각형(m) */
  x: Range;
  z: Range;
  /** 나무가 서는 고도(m). 비탈이면 (x, z) → 높이 함수 */
  ground: number | HeightAt;
  /** 차단물 높이(m) — 나무 키의 기준 */
  height: number;
  count: number;
  seed: number;
  /** 가장자리에서 들여 심는 거리(m) — 기둥이 밖으로 나가면 막힘 사각형과 어긋난다 */
  inset?: number;
  groundBump?: HeightAt | null;
}

/** 수목대(§4 V3 시야 차단) 자리. 심는 것은 인스턴스 무리에 맡겨 구운 나무가 들어가고 편집기가 고른다. */
export function treeBeltSpots({ x, z, ground, height, count, seed, inset = 0.5, groundBump }: TreeBeltOptions): Spot[] {
  const groundAt = typeof ground === "function" ? ground : () => ground;
  const random = makeRandom(seed + 1);
  const x0 = x[0] + inset,
    x1 = x[1] - inset;
  const z0 = z[0] + inset,
    z1 = z[1] - inset;
  const spots: Spot[] = [];
  for (let i = 0; i < count; i++) {
    const px = x0 + random() * (x1 - x0);
    const pz = z0 + random() * (z1 - z0);
    spots.push({
      x: px,
      z: pz,
      y: groundAt(px, pz) + (groundBump ? groundBump(px, pz) : 0),
      // 키가 다 같으면 울타리처럼 보인다
      size: height * (0.85 + random() * 0.6),
    });
  }
  return spots;
}

interface GrassOptions {
  x: Range;
  z: Range;
  elevation: number;
  density?: number;
  seed: number;
  height?: Range;
  clumpNoise?: Noise2D | null;
  groundBump?: HeightAt | null;
  canPlace?: ((x: number, z: number) => boolean) | null;
}

/**
 * 능선을 덮는 풀 한 겹. 포기 하나 ≈ 15 삼각형, 수백 포기를 합쳐 드로우콜 1개.
 * 밟고 지나가는 것이라 충돌이 없고, 그래서 키를 낮게(≤ 0.45 m) 둔다.
 */
export function buildGrass({
  x,
  z,
  elevation,
  density = 1.4,
  seed,
  height = [0.18, 0.45],
  clumpNoise,
  groundBump,
  canPlace,
}: GrassOptions): THREE.BufferGeometry | null {
  const random = makeRandom(seed);
  const pieces: THREE.BufferGeometry[] = [];
  const light = new THREE.Color("#93A86A");
  const mid = new THREE.Color("#6B7C4C");
  const dark = new THREE.Color("#3D4A2E");
  const color = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  const w = x[1] - x[0];
  const d = z[1] - z[0];
  const candidates = Math.round(w * d * density * 1.8); // 뭉침으로 걸러지니 넉넉히
  for (let i = 0; i < candidates; i++) {
    const px = x[0] + random() * w;
    const pz = z[0] + random() * d;
    const pick = random();
    const h = height[0] + random() * (height[1] - height[0]);
    const bladeCount = 3 + Math.floor(random() * 2);
    const tint = random();
    // 풀은 고르게 나지 않는다 — 뭉치고 비게
    const chance = THREE.MathUtils.clamp(0.5 + (clumpNoise ? clumpNoise(px * 0.3, pz * 0.3) : 0) * 0.85, 0, 1);
    if (pick > chance) continue;
    if (canPlace && !canPlace(px, pz)) continue;

    const y = elevation + (groundBump ? groundBump(px, pz) : 0);
    for (let k = 0; k < bladeCount; k++) {
      const source = new THREE.CylinderGeometry(
        0.004 * UNITS_PER_METER,
        h * 0.09 * UNITS_PER_METER,
        h * (0.7 + random() * 0.5) * UNITS_PER_METER,
        3,
        1,
      );
      const blade = source.toNonIndexed();
      source.dispose();
      const lean = 0.15 + random() * 0.5;
      quaternion.setFromEuler(
        new THREE.Euler(lean * Math.cos(k * 2.1), random() * Math.PI * 2, lean * Math.sin(k * 2.1)),
      );
      scale.set(1, 1, 1);
      position.set(
        (px + (random() - 0.5) * h * 0.35) * UNITS_PER_METER,
        (y + h * 0.38) * UNITS_PER_METER,
        (pz + (random() - 0.5) * h * 0.35) * UNITS_PER_METER,
      );
      matrix.compose(position, quaternion, scale);
      blade.applyMatrix4(matrix);
      // 끝이 볕을 받아 밝다
      color.copy(dark).lerp(mid, 0.4 + tint * 0.5);
      color.lerp(light, random() * 0.35);
      pieces.push(applyVertexColors(blade, color));
    }
  }
  if (!pieces.length) return null;
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

interface ScatterBushesOptions {
  terrain: GroundProbe;
  surface: SurfaceProbe;
  core: { x: Range; z: Range };
  treeCount?: number;
  shrubCount?: number;
  seed?: number;
  noise: (x: number, z: number) => number;
}

/**
 * 언덕 전체 수풀. 모티브 사진에서 초록이 없는 데는 깎아지른 암벽뿐이다.
 * ① 걷는 무대(구역·통로)는 비운다 — 이 나무들엔 막힘이 없어 밀리지 않는 나무가 되고 §4 시야도 무너진다.
 * ② 급경사엔 흙이 안 붙는다 ③ 물가는 비운다 ④ 소음으로 뭉치게 — 고르면 점을 찍어 놓은 것이 된다.
 */
export function scatterBushes({
  terrain,
  surface,
  core,
  treeCount = 420,
  shrubCount = 900,
  seed = 640811,
  noise,
}: ScatterBushesOptions): { treeSpots: Spot[]; shrubSpots: Spot[] } {
  const random = makeRandom(seed);
  const treeSpots: Spot[] = [];
  const shrubSpots: Spot[] = [];
  const w = core.x[1] - core.x[0];
  const d = core.z[1] - core.z[0];

  const candidates = (count: number) => {
    const accepted: { x: number; z: number; y: number; steepness: number }[] = [];
    // 넉넉히 뽑아 규칙으로 거른다(대부분이 걸러진다)
    let remaining = count * 14;
    while (remaining-- > 0 && accepted.length < count) {
      const x = core.x[0] + random() * w;
      const z = core.z[0] + random() * d;
      const g = terrain.groundAt(x, z);
      if (g.isWater || g.isFall) continue;
      if (g.path || g.zone) continue;
      if (z > 41) continue; // 물가 젖은 띠
      accepted.push({ x, z, y: surface.heightAt(x, z), steepness: surface.steepnessAt(x, z) });
    }
    return accepted;
  };

  for (const p of candidates(treeCount)) {
    if (p.steepness > 0.55) continue;
    const clump = noise(p.x * 0.09 + 5, p.z * 0.09) * 0.5 + 0.5;
    if (random() > 0.15 + clump * clump * 1.2) continue;
    // 3~8 m — 크기가 갈려야 숲으로 읽힌다
    treeSpots.push({ x: p.x, z: p.z, y: p.y, size: 3.2 + random() * 4.6 });
  }
  // 덤불은 나무보다 급한 데까지 가서 나무 사이를 메운다
  for (const p of candidates(shrubCount)) {
    if (p.steepness > 0.9) continue;
    const clump = noise(p.x * 0.16 + 31, p.z * 0.16) * 0.5 + 0.5;
    if (random() > 0.25 + clump * 1.0) continue;
    shrubSpots.push({ x: p.x, z: p.z, y: p.y, size: 0.6 + random() * 1.7 });
  }
  return { treeSpots, shrubSpots };
}

/** 측정한 통로 — 폭과 중심선(점마다 옆 방향 법선) */
interface MeasuredPathProbe {
  width: number;
  centerline?: { x: number; z: number; nx: number; nz: number }[];
}

interface RoadsideBushOptions {
  measuredPaths: MeasuredPathProbe[];
  surface: SurfaceProbe;
  terrain: GroundProbe;
  shoulderEdge?: number;
  margin?: number;
  band?: number;
  spacing?: number;
  seed?: number;
}

/**
 * 길 양옆 수풀. scatterBushes 는 통로 밴드를 통째로 비워 길 옆이 휑하다 — 실제 산길은 양옆이 가장 빽빽하다.
 * 밴드 바로 바깥에 띠를 만들어, 완만하면 나무·덤불, 급한 비탈 옆면이면 기둥 없는 잎더미를 심는다.
 */
export function roadsideBushSpots({
  measuredPaths,
  surface,
  terrain,
  shoulderEdge = 0.54,
  margin = 0.9,
  band = 3.2,
  spacing = 1.1,
  seed = 415207,
}: RoadsideBushOptions): { trees: Spot[]; shrubs: Spot[]; leafPiles: Spot[] } {
  const random = makeRandom(seed);
  const trees: Spot[] = [];
  const shrubs: Spot[] = [];
  const leafPiles: Spot[] = [];
  for (const path of measuredPaths) {
    const halfWidth = path.width / 2;
    const line = path.centerline ?? [];
    for (let i = 0; i < line.length; i++) {
      const p = line[i];
      for (const sideSign of [-1, 1]) {
        // 여백을 좁히면 나무가 어깨를 스쳐 길을 걷는 시야가 답답하다
        const distance = halfWidth + shoulderEdge + margin + random() * band;
        const x = p.x + p.nx * distance * sideSign;
        const z = p.z + p.nz * distance * sideSign;
        const g = terrain.groundAt(x, z);
        if (g.isWater || g.isFall || g.path) continue;
        if (random() > spacing / 2) continue;
        const y = surface.heightAt(x, z);
        const steepness = surface.steepnessAt(x, z);
        if (steepness > 0.45) {
          leafPiles.push({ x, y, z, size: 0.8 + random() * 1.6 });
        } else if (random() < 0.34) {
          trees.push({ x, y, z, size: 2.6 + random() * 3.4 });
        } else {
          shrubs.push({ x, y, z, size: 0.6 + random() * 1.3 });
        }
      }
    }
  }
  return { trees, shrubs, leafPiles };
}

// 인스턴스 표본 — 높이 1 · 밑동 원점. 같은 모양이면 복제 티가 나서 여러 벌 만든다.

/** 나무 표본 — 기둥 + 잎덩이 2~3 */
export function treePrototypes(count = 5, seed = 9001): THREE.BufferGeometry[] {
  const random = makeRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let n = 0; n < count; n++) {
    const pieces: THREE.BufferGeometry[] = [];
    const trunkLight = new THREE.Color(VEGETATION_STYLE.trunk);
    const trunkDark = new THREE.Color(VEGETATION_STYLE.trunkDark);
    const leafLight = new THREE.Color(VEGETATION_STYLE.leafLight);
    const leafMid = new THREE.Color(VEGETATION_STYLE.leaf);
    const leafDark = new THREE.Color(VEGETATION_STYLE.leafDark);
    const color = new THREE.Color();
    const trunkHeight = 0.38 + random() * 0.14;
    const thickness = 0.035 + random() * 0.02;
    const trunk = new THREE.CylinderGeometry(thickness * 0.6, thickness, trunkHeight, 5, 1).toNonIndexed();
    trunk.translate(0, trunkHeight / 2, 0);
    color.copy(trunkDark).lerp(trunkLight, 0.4 + random() * 0.55);
    pieces.push(applyVertexColors(trunk, color));
    const clumpCount = 2 + Math.floor(random() * 2);
    for (let k = 0; k < clumpCount; k++) {
      const t = k / Math.max(1, clumpCount - 1);
      const r = (0.3 - t * 0.13) * (0.85 + random() * 0.35);
      const clump = leafClump(random);
      clump.scale(r * 2, r * 2 * (0.7 + random() * 0.5), r * 2);
      clump.translate(
        (random() - 0.5) * r * 0.5,
        trunkHeight + (1 - trunkHeight) * (0.15 + t * 0.7),
        (random() - 0.5) * r * 0.5,
      );
      color.copy(leafDark).lerp(leafMid, 0.35 + random() * 0.5);
      color.lerp(leafLight, t * 0.45);
      pieces.push(applyVertexColors(clump, color));
    }
    prototypes.push(toBaseOrigin(mergeGeometries(pieces, false)));
    pieces.forEach((g) => g.dispose());
  }
  return prototypes;
}

/** 잎더미 표본 — 기둥 없이 잎만. 암벽 틈에서 자란 덤불이라 막대가 튀어나오면 안 된다. */
export function leafPilePrototypes(count = 5, seed = 9002, clumps: Range = [3, 6]): THREE.BufferGeometry[] {
  const random = makeRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  const leafLight = new THREE.Color(VEGETATION_STYLE.leafLight);
  const leafMid = new THREE.Color(VEGETATION_STYLE.leaf);
  const leafDark = new THREE.Color(VEGETATION_STYLE.leafDark);
  const color = new THREE.Color();
  for (let n = 0; n < count; n++) {
    const pieces: THREE.BufferGeometry[] = [];
    const clumpCount = clumps[0] + Math.floor(random() * (clumps[1] - clumps[0] + 1));
    for (let k = 0; k < clumpCount; k++) {
      const t = k / Math.max(1, clumpCount - 1);
      const r = (0.5 - t * 0.18) * (0.6 + random() * 0.7);
      const clump = leafClump(random);
      clump.scale(r * 2, r * 2 * (0.6 + random() * 0.6), r * 2);
      clump.translate((random() - 0.5) * 0.8, 0.15 + t * 0.5 + (random() - 0.5) * 0.2, (random() - 0.5) * 0.8);
      color.copy(leafDark).lerp(leafMid, 0.3 + random() * 0.5);
      color.lerp(leafLight, t * 0.5);
      pieces.push(applyVertexColors(clump, color));
    }
    prototypes.push(toBaseOrigin(mergeGeometries(pieces, false)));
    pieces.forEach((g) => g.dispose());
  }
  return prototypes;
}

/** 덤불 표본 — 짧은 줄기 + 잎덩이 */
export function shrubPrototypes(count = 5, seed = 9003): THREE.BufferGeometry[] {
  const random = makeRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  const trunkLight = new THREE.Color(VEGETATION_STYLE.trunk);
  const trunkDark = new THREE.Color(VEGETATION_STYLE.trunkDark);
  const leafLight = new THREE.Color(VEGETATION_STYLE.leafLight);
  const leafMid = new THREE.Color(VEGETATION_STYLE.leaf);
  const leafDark = new THREE.Color(VEGETATION_STYLE.leafDark);
  const color = new THREE.Color();
  for (let n = 0; n < count; n++) {
    const pieces: THREE.BufferGeometry[] = [];
    const stemHeight = 0.18 + random() * 0.12;
    const stem = new THREE.CylinderGeometry(0.03, 0.045, stemHeight, 5, 1).toNonIndexed();
    stem.translate(0, stemHeight / 2, 0);
    color.copy(trunkDark).lerp(trunkLight, 0.4 + random() * 0.5);
    pieces.push(applyVertexColors(stem, color));
    const clumpCount = 2 + Math.floor(random() * 3);
    for (let k = 0; k < clumpCount; k++) {
      const t = k / Math.max(1, clumpCount - 1);
      const r = (0.42 - t * 0.12) * (0.7 + random() * 0.6);
      const clump = leafClump(random);
      clump.scale(r * 2, r * 2 * (0.65 + random() * 0.5), r * 2);
      clump.translate((random() - 0.5) * 0.5, stemHeight + (1 - stemHeight) * (0.2 + t * 0.6), (random() - 0.5) * 0.5);
      color.copy(leafDark).lerp(leafMid, 0.35 + random() * 0.5);
      color.lerp(leafLight, t * 0.45);
      pieces.push(applyVertexColors(clump, color));
    }
    prototypes.push(toBaseOrigin(mergeGeometries(pieces, false)));
    pieces.forEach((g) => g.dispose());
  }
  return prototypes;
}
