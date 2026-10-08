// Playable Core 바깥으로 이어지는 풍경 — 들판·논밭·숲·마을·산줄기.
// 코어 끝에서 세상이 끊기면 아무리 안을 다듬어도 세트장 안으로 보인다.
// 갈 수 없는 곳이라 충돌도 판정도 없다. 멀수록 성글게, 멀수록 지평선 색으로 녹인다 — 이 하나가 깊이를 만든다.
// 코어 가장자리에서 높이 0 으로 맞춰 이어 붙인 티가 안 나게 한다.
// 좌표·크기는 미터, 지오메트리만 유닛.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { makeRandom } from "@/engine/random";

import { UNITS_PER_METER, type Range, type River } from "../plan/sitePlan";
import { applyVertexColors, type HeightAt, type Noise2D } from "../terrain/ground";
import { farBankBendAt, riverBendAt } from "./river";

type CoreBounds = { x: Range; z: Range };
type RiverBand = Pick<River, "zStart" | "farBankWidth">;

export const DISTANT_STYLE = {
  field: "#7E8560",
  field2: "#8E8A63",
  paddy: "#8C9558",
  paddy2: "#6E7A46",
  // 물 댄 논은 하늘을 비춘다 — 이것 하나로 논이 논으로 읽힌다
  wetPaddy: "#8FA0A6",
  wetPaddy2: "#7A8C96",
  dryField: "#8A7B5C",
  forest: "#55663F",
  forestLight: "#6E7F4C",
  // 지붕 두 갈래 — 한 색이면 상자 무더기다
  thatch: "#9A8A5C",
  tile: "#4E5058",
  earthWall: "#8E7C63",
  plasterWall: "#AFA694",
  mountain: "#6B7686",
  // 무대 안팎 색 온도를 잇는 코어 흙빛
  coreSoil: "#82885F",
};

const mix = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, t);

/** 코어 가장자리에서 몇 m (0 = 코어 옆) */
const coreDistance = (core: CoreBounds, x: number, z: number) => {
  const dx = Math.max(core.x[0] - x, 0, x - core.x[1]);
  const dz = Math.max(core.z[0] - z, 0, z - core.z[1]);
  return Math.hypot(dx, dz);
};

// 뙈기 — 멀수록 크게. 먼 띠 격자(38 m)에 26 m 뙈기를 그리면 무늬가 사라져 단색 융단이 된다.
const plotSizeAt = (core: CoreBounds, x: number, z: number) => 26 * (1 + (coreDistance(core, x, z) / 260) * 1.7);

// 곧은 격자는 바둑판이다. 실제 논밭은 물길과 지형을 따라 굽는다. 들판과 산울타리가 같은 뙈기를 봐야 한다.
const warpField = (noise: Noise2D, x: number, z: number) => [
  x + noise(x * 0.0035, z * 0.0035) * 16 + noise(x * 0.012, z * 0.012) * 4,
  z + noise(x * 0.0035 + 31, z * 0.0035 + 17) * 16 + noise(x * 0.012 + 5, z * 0.012) * 4,
];

interface FieldOptions {
  core: CoreBounds;
  river: RiverBand;
  /** 코어 가장자리에서 잰 거리(m) 구간 — 이 띠만 만든다 */
  inner?: number;
  outer?: number;
  cell?: number;
  /** 높이 경사가 완만해지는 기준. 두 띠가 같은 값을 써야 이음매가 없다. */
  referenceDistance?: number;
  hazeDistance?: number;
  /** 겹치는 자리에서 가까운 띠가 이기게 먼 띠를 조금 내린다 */
  sink?: number;
  noise: Noise2D;
  horizonColor?: string;
}

interface FieldPoint {
  x: number;
  y: number;
  c: THREE.Color;
}

/**
 * 코어를 도넛처럼 둘러싸는 들판. 코어 안과 강은 건너뛴다.
 * 가까운 띠는 촘촘하게, 먼 띠는 성글게 두 번 부른다 — 900 m 를 한 번에 촘촘히 깔면 삼각형이 수십만 개다.
 */
export function buildFields({
  core,
  river,
  inner = 0,
  outer = 260,
  cell = 7,
  referenceDistance = 260,
  hazeDistance = 900,
  sink = 0,
  noise,
  horizonColor = "#CFCBBE",
}: FieldOptions) {
  const x0 = core.x[0] - outer;
  const x1 = core.x[1] + outer;
  const z0 = core.z[0] - outer;
  const z1 = core.z[1] + outer;
  const nx = Math.round((x1 - x0) / cell);
  const nz = Math.round((z1 - z0) / cell);

  const field = new THREE.Color(DISTANT_STYLE.field);
  const field2 = new THREE.Color(DISTANT_STYLE.field2);
  const paddy = new THREE.Color(DISTANT_STYLE.paddy);
  const paddy2 = new THREE.Color(DISTANT_STYLE.paddy2);
  const dryField = new THREE.Color(DISTANT_STYLE.dryField);
  const wetPaddy = new THREE.Color(DISTANT_STYLE.wetPaddy);
  const wetPaddy2 = new THREE.Color(DISTANT_STYLE.wetPaddy2);
  const coreSoil = new THREE.Color(DISTANT_STYLE.coreSoil);
  const horizon = new THREE.Color(horizonColor);
  const c = new THREE.Color();

  const distance = (x: number, z: number) => coreDistance(core, x, z);
  // 공기에 씻긴 정도 0~1 — 절대 거리로 재야 띠마다 색이 안 튄다
  const haze = (x: number, z: number) => THREE.MathUtils.clamp(distance(x, z) / hazeDistance, 0, 1);

  // 코어 옆에서 0, 멀수록 완만하게 굽이친다
  const heightAt = (x: number, z: number) => {
    const t = THREE.MathUtils.clamp(distance(x, z) / referenceDistance, 0, 1);
    const roll = noise(x * 0.006, z * 0.006) * 26 + noise(x * 0.021, z * 0.021) * 7;
    const farHills = noise(x * 0.0016 + 9, z * 0.0016) * 55;
    let y = roll * Math.pow(t, 1.6) + farHills * Math.pow(t, 2.2);
    // 강기슭 — 물 밑까지 이어 깔고 내려 두어야 격자(7 m) 틈으로 하늘돔 밑동이 안 비친다.
    // max 로 묶으면 강 건너 땅 전체가 파인다. min 이라야 양쪽 물가 사이만 파이고, 저편은 물 끝에서 정확히 0 이다.
    const nearBank = river.zStart + riverBendAt(x);
    const waterEnd = river.zStart + river.farBankWidth + 3 + farBankBendAt(x); // 수면 메시의 저편 끝
    const bank = Math.min(
      THREE.MathUtils.clamp((z - (nearBank - 12)) / 12, 0, 1),
      THREE.MathUtils.clamp((waterEnd - z) / 8, 0, 1),
    );
    y -= 1.6 * bank * bank;
    return y - sink;
  };

  const plotSize = (x: number, z: number) => plotSizeAt(core, x, z);
  const warp = (x: number, z: number) => warpField(noise, x, z);
  const plot = (px: number, pz: number) => {
    const [x, z] = warp(px, pz);
    const size = plotSize(px, pz);
    const gx = Math.floor(x / size);
    const gz = Math.floor(z / size);
    let h = Math.imul(gx ^ Math.imul(gz, 0x27d4eb2d), 0x165667b1);
    h ^= h >>> 15;
    return ((h >>> 0) % 1000) / 1000;
  };

  const positions: number[] = [];
  const colors: number[] = [];
  const insideCore = (x: number, z: number) =>
    x > core.x[0] - 1 && x < core.x[1] + 1 && z > core.z[0] - 1 && z < core.z[1] + 1;
  // 강 골짜기는 가로 전체를 비운다(좁히면 강이 연못처럼 끊긴다). 기슭 6 m 는 물 밑으로 이어 깐다.
  const inWater = (x: number, z: number) =>
    z > river.zStart + 6 + riverBendAt(x) && z < river.zStart + river.farBankWidth - 2 + farBankBendAt(x);

  // 코어 동쪽 끝에서 마을까지 가는 길 — 길이 있어야 집 무더기가 마을이 된다
  const roadStart = [core.x[1] + 2, core.z[0] + 12];
  const roadEnd = [core.x[1] + 72, core.z[0] - 55];
  const roadDistance = (x: number, z: number) => {
    const dx = roadEnd[0] - roadStart[0];
    const dz = roadEnd[1] - roadStart[1];
    const L2 = dx * dx + dz * dz;
    let u = ((x - roadStart[0]) * dx + (z - roadStart[1]) * dz) / L2;
    u = Math.max(0, Math.min(1, u));
    // 살짝 굽은 길
    const bend = Math.sin(u * Math.PI * 1.7) * 9;
    const cx = roadStart[0] + dx * u - (dz / Math.sqrt(L2)) * bend;
    const cz = roadStart[1] + dz * u + (dx / Math.sqrt(L2)) * bend;
    return Math.hypot(x - cx, z - cz);
  };

  const pointAt = (x: number, z: number): FieldPoint => {
    let y = heightAt(x, z);
    const m = haze(x, z);
    const t = plot(x, z);
    // 논둑 — 색만 갈리면 색종이고, 둑이 서야 농지다. 둑 폭도 뙈기와 같이 커져야 멀리서 안 사라진다.
    const size = plotSize(x, z);
    const [wx, wz] = warp(x, z);
    const fx = ((wx % size) + size) % size;
    const fz = ((wz % size) + size) % size;
    const dikeWidth = 1.1 * (size / 26);
    const isDike = Math.min(fx, size - fx, fz, size - fz) < dikeWidth;
    if (isDike) y += 0.35;
    const isRoad = roadDistance(x, z) < 2.4;
    // 논 절반은 물을 대 둔다
    const isWetPaddy = t < 0.34 && plot(x - 21, z + 4) < 0.5;
    if (isRoad) c.copy(dryField).offsetHSL(0, -0.05, 0.06);
    else if (isDike) c.copy(dryField).offsetHSL(0, -0.02, -0.05);
    else if (isWetPaddy) c.copy(mix(wetPaddy, wetPaddy2, plot(x + 13, z + 13)));
    else if (t < 0.34) c.copy(mix(paddy, paddy2, plot(x + 13, z + 13)));
    else if (t < 0.55) c.copy(dryField);
    else c.copy(mix(field, field2, plot(x + 7, z - 9)));
    // 이랑 — 없으면 색종이 조각이다. 물 댄 논은 잔잔해야 하므로 거의 안 준다.
    const furrow = Math.sin(((x + z * 0.3) * 0.9 * 26) / plotSize(x, z) + t * 30) * 0.5 + 0.5;
    c.offsetHSL(0, 0, (furrow - 0.5) * (isWetPaddy ? 0.012 : 0.05));
    // 코어 가까이는 무대 안 흙빛으로 이어 준다 — 경계가 어렴풋이 보이지 않게
    const blend = 1 - THREE.MathUtils.clamp(distance(x, z) / 32, 0, 1);
    if (blend > 0) c.lerp(coreSoil, Math.pow(blend, 1.3) * 0.6);
    c.lerp(horizon, Math.pow(m, 0.75) * 0.82);
    return { x, y, c: c.clone() };
  };

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const ax = x0 + cell * i;
      const az = z0 + cell * j;
      const bx = ax + cell;
      const bz = az + cell;
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      const d = distance(cx, cz);
      if (d < inner || d > outer) continue;
      if (insideCore(cx, cz) || inWater(cx, cz)) continue;
      // 색은 칸마다 하나 — 꼭짓점마다 뽑으면 뙈기 사이가 수채화처럼 번진다. 높이는 꼭짓점마다 그대로.
      const cellColor = pointAt(cx, cz).c;
      const P = [pointAt(ax, az), pointAt(bx, az), pointAt(bx, bz), pointAt(ax, bz)];
      const Z = [az, az, bz, bz];
      for (const k of [0, 3, 1, 1, 3, 2]) {
        positions.push(P[k].x * UNITS_PER_METER, P[k].y * UNITS_PER_METER, Z[k] * UNITS_PER_METER);
        colors.push(cellColor.r, cellColor.g, cellColor.b);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return { geometry, heightAt, haze, distance };
}

interface DistantTreeSpot {
  x: number;
  y: number;
  z: number;
  size: number;
  rotation: number;
  shapeIndex: number;
  color: number;
}

interface DistantHouseSpot extends DistantTreeSpot {
  widthRatio: number;
  depthRatio: number;
}

interface ForestVillageOptions {
  core: CoreBounds;
  river: RiverBand;
  heightAt: HeightAt;
  haze: HeightAt;
  noise: Noise2D;
  outer?: number;
  forestCount?: number;
  houseCount?: number;
  taekchonCount?: number;
  seed?: number;
  horizonColor?: string;
}

/**
 * 숲(나무 덩이 무리)·산울타리·진부촌·택촌. 나무와 집은 자리만 돌려주고 무리(InstancedMesh)로 세운다 —
 * 구워 합치면 하나도 못 고른다. 산울타리만 굽는다.
 * 난수 횟수·순서가 손 배치(edits.json)에 묶여 있다. 하나라도 어긋나면 숲 자리가 통째로 다시 깔린다.
 */
export function buildForestVillages({
  core,
  river,
  heightAt,
  haze,
  noise,
  outer = 700,
  forestCount = 320,
  houseCount = 34,
  taekchonCount = 26,
  seed = 7717,
  horizonColor = "#CFCBBE",
}: ForestVillageOptions) {
  const random = makeRandom(seed);
  const pieces: THREE.BufferGeometry[] = [];
  const treeSpots: DistantTreeSpot[] = [];
  const houseSpots: DistantHouseSpot[] = []; // 진부촌 — 강 이쪽(북·내륙)
  const taekchonSpots: DistantHouseSpot[] = []; // 택촌 — 강 건너(남)
  const horizon = new THREE.Color(horizonColor);
  const forest = new THREE.Color(DISTANT_STYLE.forest);
  const forestLight = new THREE.Color(DISTANT_STYLE.forestLight);
  // 지붕 색은 distantHousePrototypes 가 벽 색 비율로 굽는다. 여기서는 모양 번호만 정한다.
  const earthWall = new THREE.Color(DISTANT_STYLE.earthWall);
  const plasterWall = new THREE.Color(DISTANT_STYLE.plasterWall);
  const c = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  const isUsable = (x: number, z: number) => {
    // 저해상도 덩이는 멀리 있을 때만 그럴싸하다 — 코어에서 20 m 는 떨어뜨린다
    if (x > core.x[0] - 20 && x < core.x[1] + 20 && z > core.z[0] - 20 && z < core.z[1] + 20) return false;
    if (z > river.zStart - 3 + riverBendAt(x) && z < river.zStart + river.farBankWidth + 4 + farBankBendAt(x))
      return false;
    return true;
  };

  // 숲 — 무리 지어 나야 숲으로 보인다
  let planted = 0;
  let attempts = 0;
  while (planted < forestCount && attempts < forestCount * 30) {
    attempts++;
    // 무리의 중심을 먼저 잡고 그 둘레에 흩는다
    const cx = core.x[0] - outer + random() * (outer * 2 + 80);
    const cz = core.z[0] - outer + random() * (outer * 2 + 50);
    const clusterSize = 3 + Math.floor(random() * 9);
    if (!isUsable(cx, cz)) continue;
    // 숲은 산기슭·둔덕에 몰리고 평지는 논밭이 된다
    const groundY = heightAt(cx, cz);
    if (random() > THREE.MathUtils.clamp(0.3 + groundY / 40, 0, 1)) continue;
    for (let k = 0; k < clusterSize && planted < forestCount; k++) {
      const x = cx + (random() - 0.5) * 34;
      const z = cz + (random() - 0.5) * 34;
      if (!isUsable(x, z)) continue;
      const m = haze(x, z);
      const size = 4 + random() * 5.5;
      const y = heightAt(x, z);
      c.copy(mix(forest, forestLight, random())).lerp(horizon, Math.pow(m, 0.75) * 0.82);
      const leafColor = c.clone();
      // 줄기·잎덩이 모양 몫의 난수(Euler 셋, 눌림, 자리 흔들림 둘)를 그대로 굴린다
      const leafJitter: number[] = [];
      for (let b = 0; b < 2; b++) {
        random();
        random();
        random();
        leafJitter.push(random());
        random();
        random();
      }
      treeSpots.push({
        x,
        y,
        z,
        size,
        rotation: leafJitter[0] * Math.PI * 2,
        shapeIndex: Math.floor(leafJitter[1] * 6) % 6,
        color: leafColor.getHex(),
      });
      planted++;
    }
  }

  // 산울타리 — 뙈기 경계에 덤불이 줄지어 서야 중경(40~260 m)이 채워진다
  for (let i = 0; i < 900; i++) {
    const x = core.x[0] - 300 + random() * 680;
    const z = core.z[0] - 300 + random() * 650;
    if (!isUsable(x, z)) continue;
    const m = haze(x, z);
    const size = plotSizeAt(core, x, z);
    const [wx, wz] = warpField(noise, x, z);
    const fx = ((wx % size) + size) % size;
    const fz = ((wz % size) + size) % size;
    // 경계 2 m 안쪽에만, 그것도 드문드문 — 줄이 끊겨야 자연스럽다
    if (Math.min(fx, size - fx, fz, size - fz) > 2) continue;
    if (random() > 0.45) continue;
    const y = heightAt(x, z);
    const height = 1.6 + random() * 2.4;
    const g = new THREE.IcosahedronGeometry(height * 0.4 * UNITS_PER_METER, 0);
    quaternion.setFromEuler(new THREE.Euler(random(), random() * 6.3, random()));
    scale.set(1, 0.7 + random() * 0.4, 1);
    position.set(x * UNITS_PER_METER, (y + height * 0.42) * UNITS_PER_METER, z * UNITS_PER_METER);
    matrix.compose(position, quaternion, scale);
    g.applyMatrix4(matrix);
    c.copy(mix(forest, forestLight, random() * 0.7)).lerp(horizon, Math.pow(m, 0.75) * 0.82);
    pieces.push(applyVertexColors(g, c));
  }

  // 집 한 채. 키·폭·깊이 → 방위 → 벽색 → 지붕 차례로 난수를 굴린다(두 마을이 같은 차례다).
  // 지붕 몫(straw) 난수는 모양 번호에만 쓰지만 굴려야 뒤따르는 집 자리가 안 밀린다.
  const house = (x: number, z: number, headingOf: () => number): DistantHouseSpot => {
    const m = haze(x, z);
    const y = heightAt(x, z);
    const w = 4 + random() * 4;
    const d = 3.5 + random() * 3;
    const h = 2.4 + random() * 1.2;
    const heading = headingOf();
    c.copy(mix(earthWall, plasterWall, random())).lerp(horizon, Math.pow(m, 0.75) * 0.8);
    const wallColor = c.clone();
    const roofHeight = 1.1 + random() * 0.8;
    const straw = random();
    return {
      x,
      y,
      z,
      size: h + roofHeight + 0.6, // 용마루까지의 키
      rotation: heading,
      widthRatio: w / (h + roofHeight + 0.6),
      depthRatio: d / (h + roofHeight + 0.6),
      shapeIndex: (straw < 0.5 ? 0 : 2) + (random() < 0.5 ? 0 : 1),
      color: wallColor.getHex(),
    };
  };

  // 진부촌 — §383 이 「원경·방향」으로 두라고 한 그대로. 북동쪽(내륙)에 모아야 마을로 보인다. 모두 초가집이다.
  const villageX = core.x[1] + 72;
  const villageZ = core.z[0] - 55;
  for (let i = 0; i < houseCount; i++) {
    const x = villageX + (random() - 0.5) * 90;
    const z = villageZ + (random() - 0.5) * 70;
    if (!isUsable(x, z)) continue;
    houseSpots.push(house(x, z, () => random() * 6.3));
  }

  // 택촌 — 강 건너 마을. 진부촌과 택촌 방향이 갈려야 「강을 사이에 둔 두 마을」(F-02)이 읽힌다.
  // 맨 뒤에서 난수를 굴려 앞 루프들의 자리를 한 톨도 안 건드린다.
  const taekchonX = (core.x[0] + core.x[1]) / 2;
  const taekchonZ = river.zStart + river.farBankWidth + 26; // 저편 물가에서 뭍으로 더 들어간 자리
  for (let i = 0; i < taekchonCount; i++) {
    const x = taekchonX + (random() - 0.5) * 76;
    const z = taekchonZ + (random() - 0.5) * 22;
    if (!isUsable(x, z)) continue;
    // 어촌은 물가를 향해 앉는다
    taekchonSpots.push(house(x, z, () => Math.PI + (random() - 0.5) * 1.4));
  }

  let geometry: THREE.BufferGeometry | null = null;
  if (pieces.length) {
    geometry = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
  }
  return { geometry, treeSpots, houseSpots, taekchonSpots };
}

// 원경 표본의 꼭짓점 색은 비율만 담는다 — 1 이 「인스턴스 색 그대로」, 0.72 가 「그보다 어둡게」.
// 색은 거리에 따라 지평색으로 섞여 그루마다 다르므로 instanceColor 로 준다.

/** 원경 나무 — 밑동이 원점, 키 1. 줄기 + 잎덩이 둘. */
export function distantTreePrototypes(count = 6, seed = 4801) {
  const random = makeRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, v: number) => applyVertexColors(g, { r: v, g: v, b: v });
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.42, 5, 1).toNonIndexed();
    trunk.translate(0, 0.21, 0);
    pieces.push(paint(trunk, 0.72));
    for (const [height, radius, squash] of [
      [0.5, 0.34, 1.0],
      [0.76, 0.24, 0.9],
    ]) {
      const g = new THREE.IcosahedronGeometry(radius, 0).toNonIndexed();
      g.scale(1, squash * (0.85 + random() * 0.35), 1);
      g.rotateY(random() * Math.PI * 2);
      g.translate((random() - 0.5) * 0.12, height, (random() - 0.5) * 0.12);
      pieces.push(paint(g, 1));
    }
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    merged.computeVertexNormals();
    prototypes.push(merged);
  }
  return prototypes;
}

/**
 * 원경 집 — 밑동이 원점, 용마루까지 키 1. 벽 + 초가지붕.
 * 네 벌 모두 초가다. 볕에 바랜 정도를 네 단계로 나눠야 마을이 복사해 붙인 것처럼 안 보인다.
 */
export function distantHousePrototypes(seed = 6203) {
  const random = makeRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, r: number, gg: number, bb: number) =>
    applyVertexColors(g, { r, g: gg, b: bb });
  // 지붕/벽 비율
  const roofRatios: [number, number, number][] = [
    [0.92, 0.8, 0.52], // 갓 이은 짚 — 누렇다
    [0.84, 0.74, 0.5],
    [0.76, 0.7, 0.53], // 한 해 묵은 짚
    [0.68, 0.64, 0.52], // 삭아 잿빛이 도는 짚
  ];
  for (let i = 0; i < 4; i++) {
    const wallHeight = 0.62 + random() * 0.06; // 키 1 중 벽 몫
    const pieces: THREE.BufferGeometry[] = [];
    const wall = new THREE.BoxGeometry(1, wallHeight, 1).toNonIndexed();
    wall.translate(0, wallHeight / 2, 0);
    pieces.push(paint(wall, 1, 1, 1));
    // 초가는 이엉을 얹어 허리가 부푼 둥근 짚더미다. 허리를 부풀려야 뾰족한 고깔로 안 보인다.
    const roofHeight = 1 - wallHeight;
    const roof = new THREE.ConeGeometry(0.86, roofHeight, 8, 3).toNonIndexed();
    const p = roof.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + roofHeight / 2; // 0(처마) ~ roofHeight(마루)
      const t = THREE.MathUtils.clamp(y / roofHeight, 0, 1);
      // 허리(t≈0.45)에서 가장 부풀고 마루로 갈수록 오므라든다
      const swell = 1 + Math.sin(Math.PI * Math.pow(t, 0.85)) * 0.17;
      p.setX(k, p.getX(k) * swell);
      p.setZ(k, p.getZ(k) * swell);
    }
    roof.rotateY(random() * Math.PI * 2);
    roof.translate(0, wallHeight + roofHeight / 2, 0);
    pieces.push(paint(roof, ...roofRatios[i]));
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    merged.computeVertexNormals();
    prototypes.push(merged);
  }
  return prototypes;
}

interface MountainOptions {
  layers?: number;
  noise: Noise2D;
  horizonColor?: string;
  /** 들판 높이 — 산 밑자락을 여기 앉혀야 들판에 파묻히거나 뜨지 않는다 */
  heightAt?: HeightAt;
}

/**
 * 300~900 m 산줄기를 겹겹이 세워 지평선을 만든다. 빛을 안 받는 평면 실루엣 —
 * 멀리 있는 것에 음영을 주면 오히려 가깝게 보인다.
 */
export function buildMountainRidges({ layers = 4, noise, horizonColor = "#CFCBBE", heightAt }: MountainOptions) {
  const pieces: THREE.BufferGeometry[] = [];
  // 가까운 산은 숲이 보여 푸르고 어둡고, 멀수록 파랗고 밝다
  const palette = ["#4F5E4A", "#5A6A63", "#6B7686", "#7C8798"];
  const horizon = new THREE.Color(horizonColor);
  const c = new THREE.Color();

  for (let layer = 0; layer < layers; layer++) {
    const t = layer / Math.max(1, layers - 1);
    const R = 300 + layer * 190; // 반지름(m)
    const peak = 45 + layer * 55;
    c.set(palette[Math.min(layer, palette.length - 1)]).lerp(horizon, 0.18 + t * 0.62);
    const positions: number[] = [];
    const colors: number[] = [];
    const N = 200;
    const ridgeHeight = (a: number) =>
      (noise(Math.cos(a) * R * 0.004 + layer * 11, Math.sin(a) * R * 0.004) * 0.5 + 0.5) * peak + peak * 0.25;
    for (let i = 0; i < N; i++) {
      const a1 = (i / N) * Math.PI * 2;
      const a2 = ((i + 1) / N) * Math.PI * 2;
      const p1 = [Math.cos(a1) * R + 40, Math.sin(a1) * R + 25];
      const p2 = [Math.cos(a2) * R + 40, Math.sin(a2) * R + 25];
      // 밑자락을 들판에 조금 아래로 앉힌다 — 틈이 나면 안 된다
      const base1 = (heightAt ? heightAt(p1[0], p1[1]) : 0) - 6;
      const base2 = (heightAt ? heightAt(p2[0], p2[1]) : 0) - 6;
      const h1 = base1 + 6 + ridgeHeight(a1);
      const h2 = base2 + 6 + ridgeHeight(a2);
      // 안쪽(코어 쪽)에서 보이도록 감는다
      const points = [
        [p1[0], base1, p1[1]],
        [p2[0], base2, p2[1]],
        [p2[0], h2, p2[1]],
        [p1[0], base1, p1[1]],
        [p2[0], h2, p2[1]],
        [p1[0], h1, p1[1]],
      ];
      for (const [px, py, pz] of points) {
        positions.push(px * UNITS_PER_METER, py * UNITS_PER_METER, pz * UNITS_PER_METER);
        colors.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    pieces.push(g);
  }
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}
