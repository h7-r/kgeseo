/**
 * 강 밑 생물의 자리 · 모양 · 재질 — 오징어 · 문어 · 복어 · 불가사리 · 참게 · 뱀장어 · 넙치 · 쏨뱅이 · 멸치 떼.
 * 미터로 만들고 M 배로 그린다. 색은 바랜 물속 빛깔. 움직임은 seaLifeBehaviors, 그리는 것은 SeaLife.
 */
import * as THREE from "three";

import { createRandom } from "@/engine/random";

import { makeGlowPoints } from "../glowPoints";
import { makeToonMaterial } from "../materials";
import { FLOOR_Y, floorY } from "./caveState";
import { SPECIES, buildFishGeometry, type Species } from "./fishLooks";

type Spot = [number, number];

/** 자리(미터) — 길 끝에서 큰 방을 지나 고리문까지 걸어가며 하나씩 마주치게 흩어 둔다. 퍼즐 자리는 비킨다 */
export const SQUIDS: Spot[] = [
  [49.6, 61.4],
  [41.4, 70.2],
  [44.0, 55.4],
];
export const OCTOPI: Spot[] = [
  [51.4, 59.6],
  [38.4, 71.8],
];
export const PUFFERS: Spot[] = [
  [43.0, 60.6],
  [47.9, 67.6],
  [37.9, 62.9],
];
export const STARS: Spot[] = [
  [44.0, 59.3],
  [46.6, 61.1],
  [37.8, 64.1],
  [50.3, 72.3],
  [42.7, 72.5],
  [44.3, 51.6],
];
export const CRABS: Spot[] = [
  [46.2, 59.2],
  [40.6, 67.9],
  [49.1, 70.7],
  [45.7, 53.2],
];
export const EELS: Spot[] = [
  [52.2, 60.6],
  [38.3, 61.4],
];
/** 멸치 떼 둘 · 둘째 피라미 떼(서쪽 — 첫째 떼와 따로 논다) */
export const ANCHOVY_SCHOOLS: Spot[] = [
  [39.6, 59.6],
  [51.6, 66.4],
];
export const MINNOW_REGION = { x: [37.2, 42.4], z: [66.2, 72.4] };
/** 위장하는 것들 — 모래와 같은 빛깔로 납작 엎드린 넙치 · 바위와 같은 빛깔의 쏨뱅이. 가까이 가야 정체가 드러난다 */
export const FLOUNDERS: Spot[] = [
  [45.8, 62.4],
  [42.3, 65.7],
  [48.3, 71.3],
];
export const STONEFISH: Spot[] = [
  [52.6, 65.4],
  [37.7, 59.4],
];
export const INK_COUNT = 380;
export const PUFFER_SPIKES = 74;

/** 움직이는 생물 하나 */
export interface Mover {
  home: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: THREE.Vector3;
  /** 지금 목표로 가는 남은 시간(초) */
  until: number;
  /** 놀람(먹물 · 부풂 · 달아남) 시작 시각 — 없으면 −∞ */
  scaredAt: number;
  heading: number;
  /** 마지막으로 사람을 다치게 한 때 */
  hitAt: number;
  /** 먹물 공격 — 남은 뿜기 수 · 다음 뿜는 때 · 뿜은 먹이 얼굴에 닿는 때(없으면 −1) */
  shotsLeft: number;
  nextShot: number;
  inkDue: number;
}

const createMover = (x: number, y: number, z: number): Mover => ({
  home: new THREE.Vector3(x, y, z),
  pos: new THREE.Vector3(x, y, z),
  vel: new THREE.Vector3(),
  target: new THREE.Vector3(x, y, z),
  until: 0,
  scaredAt: -1e9,
  heading: 0,
  hitAt: -1e9,
  shotsLeft: 0,
  nextShot: 0,
  inkDue: -1,
});

/** 헤엄 셰이더 — 꼬리 쪽(−x)일수록 좌우로 크게(Fishes 와 같은 셈). 마리마다 aPhase */
function makeSwimMaterial(freq: number, time: { value: number }, amount = 1) {
  const material = makeToonMaterial("#FFFFFF", { vertexColors: true, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute float aPhase;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
      {
        float w = clamp((0.2 - position.x) / 0.7, 0.0, 1.0);
        transformed.z += sin(uTime * ${freq.toFixed(1)} + aPhase - position.x * 5.0) * (0.11 * w * w + 0.012) * ${amount.toFixed(2)};
      }`,
      );
  };
  material.customProgramCacheKey = () => `sealife-swim-${freq}-${amount}`;
  return material;
}

/** 오징어 — 앞(+z)이 뾰족한 몸통 · 끝의 지느러미 · 뒤로 늘어진 다리 여덟과 긴 촉완 둘. 미터 */
function buildSquidParts() {
  const mantle = new THREE.LatheGeometry(
    [
      [0, -0.02],
      [0.05, 0.02],
      [0.068, 0.1],
      [0.062, 0.22],
      [0.038, 0.32],
      [0, 0.38],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    16,
  );
  mantle.rotateX(Math.PI / 2);
  // 화살촉 지느러미 — 몸통 끝을 감싸는 마름모
  const fin = new THREE.Shape();
  fin.moveTo(0, 0.2);
  fin.lineTo(0.1, 0.31);
  fin.lineTo(0, 0.42);
  fin.lineTo(-0.1, 0.31);
  fin.closePath();
  const squidFin = new THREE.ShapeGeometry(fin).rotateX(-Math.PI / 2).scale(1, 1, -1);
  const arm = new THREE.CylinderGeometry(0.009, 0.004, 0.2, 5);
  arm.translate(0, -0.1, 0);
  arm.rotateX(Math.PI / 2);
  const tentacle = new THREE.CylinderGeometry(0.006, 0.003, 0.36, 5);
  tentacle.translate(0, -0.18, 0);
  tentacle.rotateX(Math.PI / 2);
  return { mantle, squidFin, arm, tentacle };
}

/** 복어 몸 위 가시 자리 — 고르게 흩은 점 */
function spikeDirections(count: number) {
  const directions: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996;
    directions.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  return directions;
}

/** 불가사리 — 다섯 팔 별. 바닥에 납작 */
function buildStarfish() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.12 : 0.045;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** 뱀장어 — 앞(+z)이 머리인 긴 관. 꼬리로 갈수록 가늘다. 꼭짓점 셰이더가 물결치게 한다 */
function buildEel() {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 20; i++) points.push(new THREE.Vector3(0, 0, 0.45 - (i / 20) * 0.95));
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, 40, 0.028, 8, false);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const back = new THREE.Color("#3F3E2C");
  const belly = new THREE.Color("#B8AE86");
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const z = position.getZ(i);
    const t = (0.45 - z) / 0.95; // 0 머리 · 1 꼬리
    const taper = t < 0.08 ? 0.55 + t * 5.6 : 1 - Math.pow(Math.max(0, t - 0.1) / 0.9, 1.4) * 0.85;
    position.setX(i, position.getX(i) * taper);
    position.setY(i, position.getY(i) * taper * 1.15);
    color.copy(back).lerp(belly, THREE.MathUtils.smoothstep(-position.getY(i), 0, 0.02));
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function makeEelMaterial(time: { value: number }, phase: number) {
  const material = makeToonMaterial("#FFFFFF", { vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
      {
        float t = clamp((0.45 - position.z) / 0.95, 0.0, 1.0);
        transformed.x += sin(uTime * 3.2 + ${phase.toFixed(2)} - position.z * 9.0) * (0.015 + 0.07 * t);
      }`,
      );
  };
  material.customProgramCacheKey = () => `sealife-eel-${phase.toFixed(2)}`;
  return material;
}

/** 떼 — 중심이 어슬렁거리고 마리마다 그 둘레를 돈다 */
export interface School {
  mesh: THREE.InstancedMesh;
  center: Mover;
  fish: { a: number; r: number; y: number; speed: number; pos: THREE.Vector3; vel: THREE.Vector3 }[];
}

function createSchool(
  species: Species,
  count: number,
  freq: number,
  center: [number, number, number],
  spread: { r: [number, number]; y: number; speed: [number, number] },
  time: { value: number },
  random: () => number,
): School {
  const geometry = buildFishGeometry(species);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) phases[i] = random() * Math.PI * 2;
  geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
  const mesh = new THREE.InstancedMesh(geometry, makeSwimMaterial(freq, time, 0.8), count);
  mesh.frustumCulled = false;
  return {
    mesh,
    center: createMover(...center),
    fish: Array.from({ length: count }, () => ({
      a: random() * Math.PI * 2,
      r: spread.r[0] + random() * spread.r[1],
      y: (random() - 0.5) * spread.y,
      speed: spread.speed[0] + random() * spread.speed[1],
      pos: new THREE.Vector3(...center),
      vel: new THREE.Vector3(),
    })),
  };
}

/** 먹물 알갱이와 공격 차례 — 한 번에 한 마리만 덤빈다 */
export function createInk() {
  return {
    points: makeGlowPoints(INK_COUNT, { additive: false, softness: 1.1 }),
    pos: Array.from({ length: INK_COUNT }, () => new THREE.Vector3()),
    vel: Array.from({ length: INK_COUNT }, () => new THREE.Vector3()),
    age: new Float32Array(INK_COUNT).fill(99),
    next: 0,
    attacker: null as Mover | null,
    lastAttackEnd: -1e9,
  };
}
export type Ink = ReturnType<typeof createInk>;

export function createSeaLifeAssets() {
  const random = createRandom(4471);
  const time = { value: 0 };
  const materials = {
    // 오징어 — 희고 반투명한 날씬한 몸에 잔 갈색 점. 문어(짙은 얼룩 갈색 · 굵은 다리)와 확 다르게
    squid: makeToonMaterial("#E9E0D2", { transparent: true, opacity: 0.9, emissive: new THREE.Color("#2A241E") }),
    squidSpot: makeToonMaterial("#B87862"),
    octopus: makeToonMaterial("#7A5440"),
    octopusPale: makeToonMaterial("#C9A88C"),
    octopusDark: makeToonMaterial("#4E3426"),
    flounder: FLOUNDERS.map(() => makeToonMaterial("#B6AA8A")),
    stonefish: STONEFISH.map(() => makeToonMaterial("#5E6B69")),
    eye: makeToonMaterial("#16130F"),
    eyeWhite: makeToonMaterial("#E6E0CC"),
    puffer: makeToonMaterial("#C2A05A"),
    pufferBelly: makeToonMaterial("#E6DCB8"),
    pufferSpot: makeToonMaterial("#5A4A2C"),
    spike: makeToonMaterial("#D8CDA4"),
    starfish: [makeToonMaterial("#C46A44"), makeToonMaterial("#B88456"), makeToonMaterial("#A4553F")],
    crab: makeToonMaterial("#6E5C42"),
    crabDark: makeToonMaterial("#4A3D2C"),
    crabClaw: makeToonMaterial("#8A6E4C"),
    fin: makeToonMaterial("#E2C6B4", { side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
  };
  const geometries = {
    ...buildSquidParts(),
    sphere: new THREE.SphereGeometry(1, 14, 10),
    spike: new THREE.ConeGeometry(0.0045, 0.058, 4).translate(0, 0.029, 0),
    star: buildStarfish(),
    leg: new THREE.CylinderGeometry(0.006, 0.004, 0.09, 5).translate(0, -0.045, 0),
    claw: new THREE.BoxGeometry(0.05, 0.022, 0.032),
    eel: buildEel(),
    tail: new THREE.ConeGeometry(0.035, 0.05, 3).rotateZ(Math.PI / 2).scale(1, 1, 0.2),
  };
  /** 가시마다 자리 · 방향(복어 자기 좌표) — 한 번 재 두고 부풀기만 바꾼다 */
  const spikeFrames = spikeDirections(PUFFER_SPIKES).map((direction) => ({
    position: new THREE.Vector3(direction.x * 0.066, direction.y * 0.058, direction.z * 0.08),
    quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction),
  }));
  // 멸치 · 피라미 — 물고기 생김새(fishLooks)를 그대로, 멸치는 작고 가늘게
  const anchovySpecies = { ...SPECIES[0], back: "#7E8C90", belly: "#E8ECEA", fin: "#C9D2D0", tall: 0.9, wide: 0.42 };
  const anchovies = ANCHOVY_SCHOOLS.map(([x, z]) =>
    createSchool(
      anchovySpecies,
      46,
      13,
      [x, FLOOR_Y + 1.6, z],
      { r: [0.15, 0.45], y: 0.45, speed: [1.4, 0.9] },
      time,
      random,
    ),
  );
  const minnows = createSchool(
    SPECIES[0],
    22,
    9,
    [39.8, FLOOR_Y + 2.0, 69.0],
    { r: [0.4, 0.9], y: 0.7, speed: [0.6, 0.5] },
    time,
    random,
  );
  const eelMaterials = EELS.map((_, i) => makeEelMaterial(time, i * 2.1));
  const movers = {
    squids: SQUIDS.map(([x, z]) => createMover(x, floorY(x, z) + 1.7 + random() * 0.6, z)),
    octopi: OCTOPI.map(([x, z]) => createMover(x, floorY(x, z), z)),
    flounders: FLOUNDERS.map(([x, z]) => createMover(x, floorY(x, z) + 0.015, z)),
    stonefish: STONEFISH.map(([x, z]) => createMover(x, floorY(x, z) + 0.05, z)),
    puffers: PUFFERS.map(([x, z]) => createMover(x, floorY(x, z) + 1.0 + random() * 0.5, z)),
    crabs: CRABS.map(([x, z]) => createMover(x, floorY(x, z), z)),
    eels: EELS.map(([x, z]) => createMover(x, floorY(x, z) + 0.12, z)),
  };
  const stars = STARS.map(([x, z], i) => ({
    x,
    z,
    yaw: random() * 6.3,
    size: 0.8 + random() * 0.6,
    material: i % 3,
    phase: random() * 6,
  }));
  return {
    random,
    time,
    materials,
    geometries,
    spikeFrames,
    anchovies,
    minnows,
    ink: createInk(),
    eelMaterials,
    movers,
    stars,
  };
}
export type SeaLifeAssets = ReturnType<typeof createSeaLifeAssets>;

export function disposeSeaLifeAssets(assets: SeaLifeAssets) {
  Object.values(assets.geometries).forEach((geometry) => geometry.dispose());
  Object.values(assets.materials).forEach((material) =>
    Array.isArray(material) ? material.forEach((each) => each.dispose()) : material.dispose(),
  );
  assets.eelMaterials.forEach((material) => material.dispose());
  for (const school of [...assets.anchovies, assets.minnows]) {
    school.mesh.geometry.dispose();
    (school.mesh.material as THREE.Material).dispose();
  }
  assets.ink.points.points.geometry.dispose();
  assets.ink.points.material.dispose();
}
