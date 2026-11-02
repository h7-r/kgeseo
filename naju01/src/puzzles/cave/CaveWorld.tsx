/**
 * 강 밑 — 갈라진 강물 사이 강바닥 길, 머리 위에서 합쳐지는 수면, 바위 아래 조개밭(큰 방)과 석실, 그리고 숨.
 * 눈에 보이는 세계만 맡는다: 모래 바닥·물벽·수면·바위(미르 모형)·물풀·조개껍데기·빛줄기·거품, 물속 안개와 소리, 숨이 다했을 때.
 * 퍼즐(공기주머니 셋 · 고리문 · 석실)은 AirStations / RingDoor / InnerChamber 가 따로 든다. 카메라는 건드리지 않는다.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { createRandom } from "@/engine/random";
import { TOON_GRADIENT } from "@/engine/toon";

import { PEBBLE_START_INDEX, buildBakedRockPrototypes, buildBakedWeedPrototypes, buildPebblePrototypes } from "../../models/nature";
import { MESH_NAMES } from "../../plan/meshNames";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { M, makeGlowPoints, pointScaleFor } from "../fishTrap/shared";
import { showNotice } from "../interaction";
import { ritual, useRitualStage } from "../ritual/ritualState";
import {
  CORRIDOR,
  DOOR,
  ARCH,
  LEGEND_SPOTS,
  DOOR_WALL_X,
  FLOOR_Y,
  HALL,
  INNER,
  INNER_FLOOR,
  MERGE_Z,
  STEPS,
  SURFACE_Y,
  corridorY,
  getBreath,
  getLastAirSpot,
  getUnderwater,
  hallFloorY,
  resetCaveState,
  setBreath,
  setPartOpenness,
  setUnderwater,
  teleportPlayer,
  setCavePlayerFoot,
  takeSandStir,
  tickBreath,
} from "./caveState";
import { nearLightPuzzle } from "./lightLayout";
import {
  buildGround,
  buildInstances,
  buildShellGeometry,
  makeCeilingMaterial,
  makeCurtainMaterial,
  makeSandMaterial,
  makeSeaweedMaterial,
  makeShaftTexture,
  normalizePrototype,
  type Placement,
} from "./seabed";
import { mangaInk } from "../../world/mangaStyle";

/** 물이 갈라지는 데 걸리는 시간(초) */
const PART_SECONDS = 7;
/** 물속 안개 — 가깝고 청록. 멀리 바위 윤곽은 남게 */
const UNDERWATER_FOG = { color: new THREE.Color("#0C3644"), near: 1.5, far: 27 };
/** 갈라진 길 안 — 물벽 사이 물보라 빛. 길 끝까지 보여야 한다 */
const CORRIDOR_FOG = { color: new THREE.Color("#7FA6AE"), far: 46 };
/** 물벽 꼭대기 — 딱 수면까지. 수면 위 허공에는 아무것도 없다 */
const CURTAIN_TOP = SURFACE_Y - 0.02;
/** 물속에서 감추는 뭍 소품 — 동굴 바로 위에 있어 올려다보면 떠 보인다 */
const SURFACE_PROPS = new Set(["원경.나루터", "소품.나룻배"]);
/** 물벽이 끝나는 z — 큰 방 어귀 바위 바로 앞 */
const CURTAIN_END = 57.2;
const BUBBLES = 460;
/** 흔들림에 일어나는 모래 먼지 수 · 떠 있는 시간(초) · 흐려진 물빛 */
const SAND_COUNT = 320;
const SAND_LIFE = 4.5;
const SAND_MURK = new THREE.Color("#5C5A4A");
/** 고리문 앞 등불 세기 — 화톳불(2.6)보다 조금 약하게 */
const DOOR_LIGHT = 2.0;
/** 큰 방 바깥 깊은 바닥 — 이만큼 더 내려가며 모래 언덕이 인다 */
const DEEP_DROP = 3.4;

const STONE = { wall: "#4A534F", floor: "#4F5A56", rock: "#5E6B69", farRock: "#2E4A52" };

const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

/** 큰 방 네모에서 바깥으로 얼마나 떨어졌나(미터) */
function outsideHall(x: number, z: number) {
  const dx = Math.max(HALL.x[0] - x, 0, x - HALL.x[1]);
  const dz = Math.max(HALL.z[0] - z, 0, z - HALL.z[1]);
  return Math.hypot(dx, dz);
}

/** 눈에 보이는 바닥 높이 — 걷는 자리는 floorY 와 같고, 그 밖은 강바닥·깊은 모래 언덕으로 이어진다 */
function seabedY(x: number, z: number) {
  const dx = Math.abs(x - CORRIDOR.x);
  if (z < HALL.z[0]) {
    // 갈라진 길 — 가운데가 길이고 양옆은 강바닥이 완만히 올라간다(물벽 너머로 비친다)
    const rise = Math.min(1.6, 0.12 * Math.pow(Math.max(0, dx - CORRIDOR.halfWidth), 1.4));
    return corridorY(z) + rise + 0.05 * Math.sin(x * 1.1) * Math.sin(z * 1.4);
  }
  if (z >= INNER.z[0] - 0.5 && x >= INNER.x[0] - 1 && x <= INNER.x[1] + 1 && z <= INNER.z[1] + 1) return INNER_FLOOR - 0.5;
  const d = outsideHall(x, z);
  const inside = hallFloorY(x, z);
  if (d <= 0) return inside;
  const dunes = 1.1 * Math.sin(x * 0.33 + 1.2) * Math.sin(z * 0.29 + 0.4) + 0.35 * Math.sin(x * 0.9) * Math.cos(z * 0.7);
  const deep = FLOOR_Y - 0.4 - DEEP_DROP * smooth(d / 16) + dunes * smooth(d / 5);
  return THREE.MathUtils.lerp(inside, deep, smooth(d / 1.5));
}

/** 바위·자갈·물풀·조개껍데기 자리 — 씨앗이 같으면 늘 같은 자리 */
function planDecor() {
  const random = createRandom(7731);
  const rocks: Placement[] = [];
  const farRocks: Placement[] = [];
  const pebbles: Placement[] = [];
  const weeds: Placement[] = [];
  const shells: Placement[] = [];
  const pick = (n: number) => Math.floor(random() * n);
  const rock = (list: Placement[], x: number, z: number, size: number, extra: Partial<Placement> = {}) =>
    list.push({ x, z, y: seabedY(x, z), size, yaw: random() * Math.PI * 2, sink: 0.12 + random() * 0.1, variant: pick(7), squash: 0.7 + random() * 0.4, ...extra });

  // 큰 방 둘레 — 두 겹. 안쪽 겹은 걷는 경계(36·54·58·74)에 안쪽 면이 닿게, 바깥 겹은 더 크게 뒤에
  const alongZ = (xEdge: number, sign: 1 | -1) => {
    for (let z = HALL.z[0] - 0.5; z <= HALL.z[1] + 0.8; z += 2.1 + random() * 0.6) {
      const size = 2.6 + random() * 1.8;
      rock(rocks, xEdge + sign * size * 0.42, z, size);
      const back = 4 + random() * 2.5;
      rock(rocks, xEdge + sign * (size * 0.8 + back * 0.4), z + (random() - 0.5) * 2, back);
    }
  };
  alongZ(HALL.x[0], -1);
  alongZ(HALL.x[1], 1);
  // 앞벽(길이 들어오는 쪽) — 길 폭은 비운다
  for (let x = HALL.x[0] + 0.5; x <= HALL.x[1]; x += 2 + random() * 0.6) {
    if (Math.abs(x - CORRIDOR.x) < CORRIDOR.halfWidth + 1.6) continue;
    const size = 2.4 + random() * 1.6;
    rock(rocks, x, HALL.z[0] - size * 0.42, size);
    rock(rocks, x + (random() - 0.5) * 1.5, HALL.z[0] - size * 0.8 - 1.6, 3.5 + random() * 2);
  }
  // 뒷벽 — 고리문 벽 양옆
  for (let x = HALL.x[0] + 0.5; x <= HALL.x[1]; x += 1.9 + random() * 0.5) {
    if (x > DOOR_WALL_X[0] - 0.5 && x < DOOR_WALL_X[1] + 0.5) continue;
    const size = 2.6 + random() * 1.6;
    rock(rocks, x, HALL.z[1] + size * 0.42, size);
  }
  // 석실 둘레 — 바위 틈 사이에 지은 방
  for (let z = INNER.z[0] + 0.5; z <= INNER.z[1] + 0.5; z += 1.9 + random() * 0.5) {
    rock(rocks, INNER.x[0] - 0.9 - random() * 0.4, z, 2.2 + random() * 1.2, { y: INNER_FLOOR });
    rock(rocks, INNER.x[1] + 0.9 + random() * 0.4, z, 2.2 + random() * 1.2, { y: INNER_FLOOR });
  }
  for (let x = INNER.x[0] - 1; x <= INNER.x[1] + 1; x += 1.8 + random() * 0.5) {
    if (Math.abs(x - CORRIDOR.x) < 1.4) continue;
    rock(rocks, x, INNER.z[1] + 1 + random() * 0.4, 2.4 + random() * 1.2, { y: INNER_FLOOR });
  }
  // 방 안 흩어진 바위 — 길목·퍼즐 자리는 피한다
  const reserved: [number, number, number][] = [
    [CORRIDOR.x, 60, 3],
    [39.6, 62.6, 2],
    [51.6, 69.4, 3],
    [CORRIDOR.x, 71.5, 3.5],
    // 고리문 바퀴가 굴러가는 길(오른쪽 4.4 m) — 바퀴와 겹치지 않게
    [CORRIDOR.x + 3.2, 72.8, 3.6],
    // 설화 흔적 자리
    ...Object.values(LEGEND_SPOTS).map(({ x, z }) => [x, z, 1.4] as [number, number, number]),
  ];
  let tries = 0;
  while (rocks.length < 90 && tries++ < 400) {
    const x = HALL.x[0] + 1.2 + random() * (HALL.x[1] - HALL.x[0] - 2.4);
    const z = HALL.z[0] + 1.2 + random() * (HALL.z[1] - HALL.z[0] - 2.4);
    if (reserved.some(([rx, rz, r]) => Math.hypot(rx - x, rz - z) < r)) continue;
    // 진주 빛길 — 빛이 지나는 줄과 진주 자리엔 바위를 안 둔다
    if (nearLightPuzzle(x, z, 1.4)) continue;
    if (Math.abs(x - CORRIDOR.x) < 1.6 && z < 66) continue;
    rock(rocks, x, z, 0.45 + random() * 0.9, { sink: 0.25 });
  }
  // 멀리 — 안개 속 큰 윤곽. 머리가 수면 위로 안 나오게 크기를 누른다
  for (let i = 0; i < 34; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 22 + random() * 36;
    const x = CORRIDOR.x + Math.cos(angle) * radius;
    const z = 66 + Math.sin(angle) * radius;
    if (z < 62) continue;
    const y = seabedY(x, z);
    const size = Math.min(SURFACE_Y - 0.6 - y, 5 + random() * 5);
    rock(farRocks, x, z, size, { squash: 0.55 + random() * 0.35, sink: 0.2 });
  }
  // 자갈 — 길과 방 바닥
  for (let i = 0; i < 260; i++) {
    const onPath = i < 80;
    const x = onPath ? CORRIDOR.x + (random() - 0.5) * 9 : HALL.x[0] + random() * (HALL.x[1] - HALL.x[0]);
    const z = onPath ? CORRIDOR.zStart + 1 + random() * (HALL.z[0] - CORRIDOR.zStart) : HALL.z[0] + random() * (HALL.z[1] - HALL.z[0]);
    if (!onPath && nearLightPuzzle(x, z, 0.35)) continue;
    pebbles.push({ x, z, y: seabedY(x, z), size: 0.12 + random() * 0.28, yaw: random() * 6.3, sink: 0.3, variant: pick(7), squash: 0.6 + random() * 0.4 });
  }
  // 물풀 — 둘레 바위 밑동과 그 너머
  for (let i = 0; i < 110; i++) {
    const outside = i < 70;
    const side = random() < 0.5 ? -1 : 1;
    const x = outside ? CORRIDOR.x + side * (10.5 + random() * 14) : HALL.x[0] + 0.6 + random() * (HALL.x[1] - HALL.x[0] - 1.2);
    const z = outside ? 56 + random() * 40 : HALL.z[0] + 0.5 + random() * (HALL.z[1] - HALL.z[0] - 1);
    if (!outside && reserved.some(([rx, rz, r]) => Math.hypot(rx - x, rz - z) < r + 0.5)) continue;
    if (!outside && nearLightPuzzle(x, z, 1.6)) continue;
    if (!outside && outsideHall(x, z) === 0 && Math.min(x - HALL.x[0], HALL.x[1] - x) > 1.6 && random() < 0.7) continue;
    weeds.push({ x, z, y: seabedY(x, z), size: 0.45 + random() * 0.7, yaw: random() * 6.3, variant: pick(2) });
  }
  // 조개껍데기 — 「바위 아래 조개밭」. 방 바닥 곳곳, 퍼즐 조개밭 둘레는 더 촘촘히
  for (let i = 0; i < 190; i++) {
    const nearBed = i < 70;
    const x = nearBed ? 50.8 + (random() - 0.5) * 8 : HALL.x[0] + 0.5 + random() * (HALL.x[1] - HALL.x[0] - 1);
    const z = nearBed ? 63.8 + (random() - 0.5) * 7 : HALL.z[0] + 0.5 + random() * (HALL.z[1] - HALL.z[0] - 1);
    if (Math.abs(x - CORRIDOR.x) < 1.2 && z < 66) continue;
    if (nearLightPuzzle(x, z, 0.5)) continue;
    shells.push({ x, z, y: seabedY(x, z) + 0.005, size: 0.09 + random() * 0.14, yaw: random() * 6.3, variant: pick(3) });
  }
  // 수면에서 내려오는 빛줄기
  const shafts: { x: number; z: number; tilt: number; yaw: number; width: number; phase: number }[] = [];
  for (let i = 0; i < 16; i++) {
    const far = i >= 10;
    shafts.push({
      x: far ? CORRIDOR.x + (random() - 0.5) * 60 : HALL.x[0] + 1 + random() * (HALL.x[1] - HALL.x[0] - 2),
      z: far ? 60 + random() * 40 : HALL.z[0] + 1 + random() * (HALL.z[1] - HALL.z[0] - 2),
      tilt: 0.12 + random() * 0.22,
      yaw: random() * Math.PI,
      width: 1.2 + random() * 1.8,
      phase: random() * 6.28,
    });
  }
  // 석실 쪽 동굴 어귀 — 들어온 구멍 양옆에 바위가 비어져 나와 바위 틈으로 보이게(석상 · 등 받침은 비킨다).
  // 다른 자리의 난수를 흩뜨리지 않게 맨 끝에 놓는다
  for (const [x, size, squash] of [
    [CORRIDOR.x - ARCH.halfWidth - 0.35, 1.05, 1.5],
    [CORRIDOR.x + ARCH.halfWidth + 0.35, 0.95, 1.7],
    [CORRIDOR.x - ARCH.halfWidth - 0.15, 0.7, 0.8],
    [CORRIDOR.x + ARCH.halfWidth + 0.2, 0.6, 0.9],
  ] as const)
    rock(rocks, x, INNER.z[0] + 0.12, size, { y: INNER_FLOOR, squash });
  return { rocks, farRocks, pebbles, weeds, shells, shafts };
}

/** 구멍 뚫린 돌벽(미터) — 고리문이 앉는 뒷벽 가운데 토막. 두께가 곧 석실로 가는 통로 */
function buildDoorWall() {
  const shape = new THREE.Shape();
  // 수면 바로 밑까지 — 위로 삐져나오면 강가에서 네모난 윗선이 보인다
  const top = SURFACE_Y - 0.05;
  shape.moveTo(DOOR_WALL_X[0], FLOOR_Y - 0.3);
  shape.lineTo(DOOR_WALL_X[1], FLOOR_Y - 0.3);
  shape.lineTo(DOOR_WALL_X[1], top);
  shape.lineTo(DOOR_WALL_X[0], top);
  shape.closePath();
  // 동굴 어귀 — 바닥에서 올라가 둥글게 닫히되, 바위를 깨고 낸 듯 가장자리가 들쭉날쭉하다. 닫혀 있을 땐 앞의 돌바퀴가 가린다
  const hole = new THREE.Path();
  const bottom = INNER_FLOOR - 0.05;
  const springing = INNER_FLOOR + ARCH.straight;
  const jag = (k: number) => 0.13 * Math.sin(k * 2.9 + 0.7) + 0.07 * Math.sin(k * 7.3 + 2.1);
  hole.moveTo(CORRIDOR.x - ARCH.halfWidth + 0.06, bottom);
  hole.lineTo(CORRIDOR.x + ARCH.halfWidth - 0.04, bottom);
  // 오른쪽 벽 — 아래는 조금 좁고, 군데군데 튀어나온 돌
  for (let k = 1; k <= 5; k++) {
    const y = bottom + ((springing - bottom) * k) / 5;
    hole.lineTo(CORRIDOR.x + ARCH.halfWidth - 0.08 + jag(k + 10), y);
  }
  // 천장 — 반원보다 살짝 납작하고 모나게
  const steps = 13;
  for (let k = 1; k < steps; k++) {
    const a = (k / steps) * Math.PI;
    const r = ARCH.halfWidth + jag(k) * 1.1;
    hole.lineTo(CORRIDOR.x + Math.cos(a) * r, springing + Math.sin(a) * r * 0.92);
  }
  for (let k = 5; k >= 1; k--) {
    const y = bottom + ((springing - bottom) * k) / 5;
    hole.lineTo(CORRIDOR.x - ARCH.halfWidth + 0.08 - jag(k + 20), y);
  }
  hole.closePath();
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, { depth: INNER.z[0] - HALL.z[1], bevelEnabled: false });
}

export default function CaveWorld() {
  const stage = useRitualStage();
  const { scene, gl, camera } = useThree();
  const isShown = ritual.isAtLeast("parted") && stage !== "cleared";

  const built = useMemo(() => {
    const random = createRandom(991);
    const time = { value: 0 };
    const seabed = buildGround({
      width: 150,
      depth: 112,
      centerX: CORRIDOR.x,
      centerZ: CORRIDOR.zStart + 56,
      segmentsX: 190,
      segmentsZ: 150,
      heightAt: seabedY,
    });
    const doorWall = buildDoorWall();
    const sand = makeSandMaterial();
    const curtain = makeCurtainMaterial(FLOOR_Y - 1, CURTAIN_TOP);
    const ceiling = makeCeilingMaterial();
    const seaweed = makeSeaweedMaterial(time);
    const stone = (color: string) => new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT });
    const rockMaterial = new THREE.MeshToonMaterial({ color: STONE.rock, vertexColors: true, gradientMap: TOON_GRADIENT });
    const farRockMaterial = new THREE.MeshToonMaterial({ color: STONE.farRock, vertexColors: true, gradientMap: TOON_GRADIENT });
    const shellMaterial = new THREE.MeshToonMaterial({ color: "#C9BDA6", vertexColors: true, gradientMap: TOON_GRADIENT, side: THREE.DoubleSide });
    const shaftTexture = makeShaftTexture();
    const shaft = new THREE.MeshBasicMaterial({
      map: shaftTexture,
      color: "#F4F7F5",
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    // 멀리 둘러친 벽 — 안개 색 그대로라 보이진 않지만, 바닥→벽→수면의 깊이가 이어져 지평선에 윤곽선이 안 생긴다
    const horizon = new THREE.MeshBasicMaterial({ color: UNDERWATER_FOG.color, side: THREE.BackSide, fog: true });
    const materials = { wall: stone(STONE.wall), floor: stone(STONE.floor), sand, curtain, ceiling, seaweed, rockMaterial, farRockMaterial, shellMaterial, shaft, horizon };
    materials.wall.emissive = new THREE.Color("#0E1A1E");

    const plan = planDecor();
    const rockPrototypes = buildBakedRockPrototypes().map(normalizePrototype);
    const farPrototypes = buildBakedRockPrototypes(true).map(normalizePrototype);
    const pebblePrototypes = buildPebblePrototypes().slice(PEBBLE_START_INDEX).map(normalizePrototype);
    const weedPrototypes = buildBakedWeedPrototypes().map(normalizePrototype);
    const shellPrototypes = [buildShellGeometry(), buildShellGeometry(10, 18).scale(0.85, 1.2, 1), buildShellGeometry(12, 22).scale(1.15, 0.8, 0.9)];
    const instances = [
      ...buildInstances(rockPrototypes, plan.rocks, rockMaterial),
      ...buildInstances(farPrototypes, plan.farRocks, farRockMaterial),
      ...buildInstances(pebblePrototypes, plan.pebbles, rockMaterial),
      ...buildInstances(weedPrototypes, plan.weeds, seaweed),
      ...buildInstances(shellPrototypes, plan.shells, shellMaterial),
    ];
    const disposable = [...rockPrototypes, ...farPrototypes, ...pebblePrototypes, ...weedPrototypes, ...shellPrototypes];

    // 일어난 모래 — 흔들림에 바닥에서 피어올라 물을 흐린다
    const silt = makeGlowPoints(SAND_COUNT, { additive: false, softness: 0.9 });
    const siltState = { pos: Array.from({ length: SAND_COUNT }, () => new THREE.Vector3()), vel: Array.from({ length: SAND_COUNT }, () => new THREE.Vector3()), age: new Float32Array(SAND_COUNT).fill(99), next: 0, carry: 0 };
    const bubbles = makeGlowPoints(BUBBLES, { additive: false, softness: 1.4 });
    const bubbleSeeds = new Float32Array(BUBBLES * 3);
    for (let i = 0; i < BUBBLES; i++) {
      bubbleSeeds[i * 3] = random();
      bubbleSeeds[i * 3 + 1] = random();
      bubbleSeeds[i * 3 + 2] = random();
      // 반은 거품, 반은 떠다니는 티끌
      const isDust = i % 2 === 1;
      bubbles.size.setX(i, isDust ? 0.012 + random() * 0.02 : 0.025 + random() * 0.05);
      bubbles.color.setXYZ(i, 0.78, 0.92, 0.95);
    }
    bubbles.points.visible = false;
    return { time, seabed, doorWall, materials, instances, disposable, shafts: plan.shafts, bubbles, bubbleSeeds, shaftTexture, silt, siltState };
  }, []);

  useEffect(
    () => () => {
      built.seabed.dispose();
      built.doorWall.dispose();
      built.disposable.forEach((g) => g.dispose());
      built.instances.forEach((mesh) => mesh.dispose());
      Object.values(built.materials).forEach((m) => m.dispose());
      built.shaftTexture.dispose();
      built.bubbles.points.geometry.dispose();
      built.bubbles.material.dispose();
      built.silt.points.geometry.dispose();
      built.silt.material.dispose();
    },
    [built],
  );

  // ── 강물 가르기 · 물속 · 숨 ──
  const partedAt = useRef(-1);
  const underwaterMix = useRef(0);
  const murk = useRef(0);
  const wasUnderwater = useRef(false);
  const clipPlanes = useRef<THREE.Plane[] | null>(null);
  const curtains = useRef<THREE.Mesh[]>([]);
  const horizonWall = useRef<THREE.Mesh>(null);

  // 동굴 바로 위 뭍 소품(나루터 · 나룻배) — 물속에서 올려다보면 허공에 뜬 돌처럼 보여서, 물속에 있는 동안만 감춘다
  const surfaceProps = useRef<{ meshes: THREE.Object3D[]; hidden: boolean } | null>(null);
  const hideSurfaceProps = (hide: boolean) => {
    if (!surfaceProps.current) {
      if (!hide) return;
      const meshes: THREE.Object3D[] = [];
      scene.traverse((node) => {
        if (SURFACE_PROPS.has(node.name)) meshes.push(node);
      });
      // 아직 안 읽힌 모형이면 다음 장면에서 다시 찾는다
      if (!meshes.length) return;
      surfaceProps.current = { meshes, hidden: false };
    }
    const props = surfaceProps.current;
    if (props.hidden === hide) return;
    props.hidden = hide;
    for (const mesh of props.meshes) mesh.visible = !hide;
  };

  // 물이 갈라지면 강 수면과 강바닥(미르 쪽 메시)을 길 폭만큼 잘라 낸다 — 재질은 안 바꾸고 자르는 면만 건다.
  // 강바닥 지형이 길보다 높아서 안 자르면 길 위에 검은 판처럼 덮인다. 길 구간(z 44.5~58)에서만 자른다
  useEffect(() => {
    if (!isShown) return undefined;
    const names = new Set<string>([MESH_NAMES.riverSurface, MESH_NAMES.ground, MESH_NAMES.riverStones, MESH_NAMES.groundPebbles]);
    const materials = new Set<THREE.Material>();
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // 이름 없는 「땅 밑받침」(NajuScene 의 어두운 상자)도 — 길이 그 밑으로 내려가서 안 자르면 검은 판으로 길을 덮는다
      const isBaseSlab = mesh.geometry.type === "BoxGeometry" && (list[0] as THREE.MeshToonMaterial)?.color?.getHexString() === "2e323a";
      if (names.has(mesh.name) || isBaseSlab) for (const m of list) if (m) materials.add(m);
    });
    if (!materials.size) return undefined;
    const planes = [
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), CORRIDOR.x * M),
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -CORRIDOR.x * M),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), CORRIDOR.zStart * M),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -CORRIDOR.zEnd * M),
    ];
    const previous = gl.localClippingEnabled;
    gl.localClippingEnabled = true;
    materials.forEach((material) => {
      material.clippingPlanes = planes;
      material.clipIntersection = true;
      material.needsUpdate = true;
    });
    clipPlanes.current = planes;
    return () => {
      materials.forEach((material) => {
        material.clippingPlanes = null;
        material.clipIntersection = false;
        material.needsUpdate = true;
      });
      gl.localClippingEnabled = previous;
      clipPlanes.current = null;
    };
  }, [isShown, scene, gl]);

  // 물에서 나오면(강가로 돌아오면) 소리·안개를 되돌린다
  useEffect(() => {
    if (stage !== "cleared") return;
    setUnderwater(false);
    audio.setAmbientLevel(1);
    audio.setReverb(0.25);
    director.cue({ 날씨: "갬", 초: 0 });
  }, [stage]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuCaveDev", {
      teleport: (x: number, z: number) => teleportPlayer(x, z),
      setBreath,
      reset: resetCaveState,
    });
  }, []);

  useFrame((_, dt) => {
    const time = performance.now() / 1000;
    // 물속에서는 만화 선을 먹빛으로 — 둘레 등빛을 타 갈색으로 물들지 않게
    mangaInk.black = isShown && getUnderwater() ? 1 : 0;
    hideSurfaceProps(isShown && getUnderwater());
    // 발 자리 — 눈높이에서 키(1.25 m)만큼 아래
    setCavePlayerFoot(camera.position.x / M, camera.position.y / M - 1.25, camera.position.z / M);
    if (!isShown) {
      if (partedAt.current >= 0) {
        partedAt.current = -1;
        setPartOpenness(0);
        built.bubbles.points.visible = false;
      }
      return;
    }
    // 갈라짐
    if (partedAt.current < 0) {
      partedAt.current = time;
      audio.play("우르릉");
      showNotice("강물이 양쪽으로 갈라진다. 강바닥에 길이 드러났다.", 5);
    }
    const openness = THREE.MathUtils.smoothstep((time - partedAt.current) / PART_SECONDS, 0, 1);
    setPartOpenness(openness);
    // 갈라지는 동안 땅이 운다 — 지진처럼 흔들리고 우르릉이 겹친다
    if (openness < 1) {
      director.cue({ 카메라: "흔들림", 세기: dt * 1.4 });
      if (Math.floor((time - partedAt.current) / 2.2) !== Math.floor((time - partedAt.current - dt) / 2.2)) audio.play("우르릉");
    }
    const gap = CORRIDOR.halfWidth * openness;
    if (clipPlanes.current) {
      clipPlanes.current[0].constant = (CORRIDOR.x - gap) * M;
      clipPlanes.current[1].constant = -(CORRIDOR.x + gap) * M;
    }
    curtains.current[0]?.position.setX(CORRIDOR.x - gap);
    curtains.current[1]?.position.setX(CORRIDOR.x + gap);
    built.time.value = time;
    built.materials.curtain.uniforms.uTime.value = time;
    built.materials.ceiling.uniforms.uTime.value = time;
    built.materials.sand.uniforms.uTime.value = time;

    // 물속 판정 — 길 끝(MERGE_Z)을 지나면 물이 머리 위에서 합쳐진다
    const x = camera.position.x / M;
    const z = camera.position.z / M;
    const under = getUnderwater() ? z > MERGE_Z - 1 : z > MERGE_Z;
    if (under !== wasUnderwater.current) {
      wasUnderwater.current = under;
      setUnderwater(under);
      audio.setAmbientLevel(under ? 0.1 : 1);
      audio.setReverb(under ? 0.55 : 0.25);
      // 물속에서는 비가 안 보인다 — 걷히는 큐를 길게 걸고, 올라오면 바로 끝낸다
      director.cue({ 날씨: "갬", 초: under ? 3600 : 0 });
      if (under) {
        audio.play("첨벙");
        director.cue({ 카메라: "흔들림", 세기: 0.8 });
        if (ritual.stage() === "parted") {
          ritual.enterCave();
          showNotice("물이 머리 위에서 닫혔다. 숨은 60초 — 거품이 솟는 곳에 서면 다시 찬다.", 5.5);
        }
      }
    }
    // 안개 — 연출(director)이 이 프레임에 써 둔 값 위에 물속 색을 섞는다
    underwaterMix.current += ((under ? 1 : 0) - underwaterMix.current) * Math.min(1, dt * 2.5);
    const mix = underwaterMix.current;
    built.materials.sand.uniforms.uCaustic.value = 0.2 + mix * 0.5;
    if (horizonWall.current) horizonWall.current.visible = mix > 0.3;
    // 갈라진 길 안에서는 비안개 대신 물보라 빛 — 길이 잿빛 네모로 뭉개지지 않게 멀리까지 보인다
    const inCorridor = under ? 0 : smooth((z - (CORRIDOR.zStart - 3)) / 3) * smooth((CORRIDOR.halfWidth + 3 - Math.abs(x - CORRIDOR.x)) / 2);
    if (scene.fog instanceof THREE.Fog && (mix > 0.001 || inCorridor > 0.001)) {
      if (inCorridor > 0.001) {
        scene.fog.color.lerp(CORRIDOR_FOG.color, inCorridor);
        scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, CORRIDOR_FOG.far * M, inCorridor);
      }
      scene.fog.color.lerp(UNDERWATER_FOG.color, mix);
      scene.fog.near = THREE.MathUtils.lerp(scene.fog.near, UNDERWATER_FOG.near * M, mix);
      scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, UNDERWATER_FOG.far * M, mix);
      if ((scene.background as THREE.Color | null)?.isColor) (scene.background as THREE.Color).copy(scene.fog.color);
    }
    // ── 흔들림에 모래가 인다 — 바닥에서 모래 먼지가 피어올라 물이 잠깐 흐려진다 ──
    {
      const stir = takeSandStir(dt);
      const { silt, siltState } = built;
      if (under && stir > 0.02) {
        siltState.carry += stir * 140 * dt;
        while (siltState.carry >= 1) {
          siltState.carry -= 1;
          const k = siltState.next;
          siltState.next = (siltState.next + 1) % SAND_COUNT;
          const a = Math.random() * Math.PI * 2;
          const r = 0.6 + Math.random() * 4.5;
          const sx = x + Math.cos(a) * r;
          const sz = z + Math.sin(a) * r;
          siltState.pos[k].set(sx, seabedY(sx, sz) + 0.05, sz);
          siltState.vel[k].set((Math.random() - 0.5) * 0.4, 0.35 + Math.random() * 0.7, (Math.random() - 0.5) * 0.4);
          siltState.age[k] = 0;
        }
      }
      for (let k = 0; k < SAND_COUNT; k++) {
        siltState.age[k] += dt;
        const age = siltState.age[k];
        if (age > SAND_LIFE) {
          silt.alpha.setX(k, 0);
          continue;
        }
        siltState.vel[k].multiplyScalar(Math.exp(-dt * 1.1));
        siltState.vel[k].y -= 0.05 * dt;
        siltState.pos[k].addScaledVector(siltState.vel[k], dt);
        const p = siltState.pos[k];
        silt.position.setXYZ(k, p.x * M, p.y * M, p.z * M);
        const t = age / SAND_LIFE;
        silt.size.setX(k, 0.18 + t * 0.9);
        silt.alpha.setX(k, 0.32 * Math.min(1, age * 4) * (1 - t));
        silt.color.setXYZ(k, 0.62, 0.57, 0.46);
      }
      silt.commit();
      silt.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
      // 흐려짐 — 안개가 가까이 오고 모래빛이 섞인다
      murk.current += (Math.min(1, stir) - murk.current) * Math.min(1, dt * 2);
      if (under && scene.fog instanceof THREE.Fog && murk.current > 0.01) {
        scene.fog.far *= 1 - 0.55 * murk.current;
        scene.fog.near *= 1 - 0.6 * murk.current;
        scene.fog.color.lerp(SAND_MURK, murk.current * 0.45);
        if ((scene.background as THREE.Color | null)?.isColor) (scene.background as THREE.Color).copy(scene.fog.color);
      }
    }
    // 숨이 5초 아래 — 화면이 떨린다(곧 숨이 끊긴다)
    if (under && getBreath() < 5) director.cue({ 카메라: "흔들림", 세기: dt * (1.2 + (5 - getBreath()) * 0.4) });
    // 숨
    if (tickBreath(dt, x, z)) {
      const spot = getLastAirSpot();
      teleportPlayer(spot.x, spot.z);
      audio.play("전환");
      showNotice("숨이 다했다. 마지막으로 숨 쉰 자리로 돌아왔다.", 4);
    }

    // 거품·티끌 — 카메라 둘레 상자 안에서 떠오른다
    const bubbles = built.bubbles;
    bubbles.points.visible = mix > 0.05;
    if (bubbles.points.visible) {
      bubbles.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
      const box = 16;
      const height = SURFACE_Y - FLOOR_Y;
      for (let i = 0; i < BUBBLES; i++) {
        const sx = built.bubbleSeeds[i * 3];
        const sy = built.bubbleSeeds[i * 3 + 1];
        const sz = built.bubbleSeeds[i * 3 + 2];
        const isDust = i % 2 === 1;
        const bx = x + ((((sx - 0.5) * box - x + box * 0.5) % box) + box) % box - box * 0.5;
        const bz = z + ((((sz - 0.5) * box - z + box * 0.5) % box) + box) % box - box * 0.5;
        const by = FLOOR_Y + ((sy * height + time * (isDust ? 0.04 + sx * 0.05 : 0.25 + sx * 0.3)) % height);
        bubbles.position.setXYZ(i, (bx + Math.sin(time * (isDust ? 0.4 : 1.3) + i) * (isDust ? 0.25 : 0.08)) * M, by * M, bz * M);
        bubbles.alpha.setX(i, mix * (isDust ? 0.3 : 0.55) * (1 - (by - FLOOR_Y) / height));
      }
      bubbles.commit();
    }
    built.materials.shaft.opacity = 0.13 + 0.05 * Math.sin(time * 0.9);
  });

  if (!isShown) return null;
  const { materials } = built;
  const curtainHeight = CURTAIN_TOP - (FLOOR_Y - 1);
  const curtainY = (CURTAIN_TOP + FLOOR_Y - 1) / 2;
  return (
    <>
      <group scale={M}>
        {/* 모래 바닥 — 길 · 큰 방 · 그 너머 깊은 데까지 한 장 */}
        <mesh geometry={built.seabed} material={materials.sand} receiveShadow />
        {/* 바위 · 자갈 · 물풀 · 조개껍데기 */}
        {built.instances.map((mesh, i) => (
          <primitive key={i} object={mesh} />
        ))}
        {/* 고리문이 앉는 돌벽 — 구멍이 뚫려 있고 두께가 곧 석실로 가는 통로 */}
        <mesh geometry={built.doorWall} material={materials.wall} position={[0, 0, HALL.z[1]]} />
        {/* 석실 — 돌로 깐 한 단 높은 바닥 */}
        <mesh material={materials.floor} position={[(INNER.x[0] + INNER.x[1]) / 2, INNER_FLOOR - 0.2, (HALL.z[1] + INNER.z[1] + 0.6) / 2]} receiveShadow>
          <boxGeometry args={[INNER.x[1] - INNER.x[0] + 1, 0.4, INNER.z[1] + 0.6 - HALL.z[1]]} />
        </mesh>
        {/* 문 앞 낮은 돌계단 — 올라서면 문까지 평평한 단 */}
        {Array.from({ length: STEPS.count }, (_, i) => i + 1).map((step) => (
          <mesh key={step} material={materials.floor} position={[CORRIDOR.x, FLOOR_Y + (STEPS.rise * step) / 2, STEPS.zStart + STEPS.depth * (step - 0.5)]}>
            <boxGeometry args={[STEPS.halfWidth * 2, STEPS.rise * step, STEPS.depth]} />
          </mesh>
        ))}
        <mesh material={materials.floor} position={[CORRIDOR.x, FLOOR_Y + (INNER_FLOOR - FLOOR_Y) / 2, (STEPS.zStart + STEPS.depth * STEPS.count + DOOR.z) / 2]}>
          <boxGeometry args={[STEPS.halfWidth * 2, INNER_FLOOR - FLOOR_Y, DOOR.z - (STEPS.zStart + STEPS.depth * STEPS.count)]} />
        </mesh>
        {/* 수면 — 길 끝부터 멀리까지 천장(길 끝을 비스듬히 닫던 물판은 통로를 가로지르는 띠로 보여 뺐다) */}
        <mesh material={materials.ceiling} position={[CORRIDOR.x, SURFACE_Y, MERGE_Z + 60]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[160, 121]} />
        </mesh>
        {/* 물벽 — 갈라진 강물. 바닥에서 하늘까지. 자리는 매 프레임 벌어진 폭을 따른다 */}
        {[0, 1].map((side) => (
          <mesh
            key={side}
            ref={(mesh) => {
              if (mesh) curtains.current[side] = mesh;
            }}
            material={materials.curtain}
            position={[CORRIDOR.x, curtainY, (CORRIDOR.zStart + CURTAIN_END) / 2]}
            rotation={[0, Math.PI / 2, 0]}
          >
            <planeGeometry args={[CURTAIN_END - CORRIDOR.zStart, curtainHeight]} />
          </mesh>
        ))}
        {/* 멀리 둘러친 벽(안개 속) — 물속에서만. 수면 위까지 높아야 수면 너머로 빈 하늘이 안 새어 윤곽선이 안 생긴다 */}
        <mesh ref={horizonWall} material={materials.horizon} position={[CORRIDOR.x, (FLOOR_Y - DEEP_DROP - 4 + 40) / 2, 68]} visible={false}>
          <cylinderGeometry args={[72, 72, 40 - (FLOOR_Y - DEEP_DROP - 4), 48, 1, true]} />
        </mesh>
        {/* 고리문 앞 · 밸브 옆 — 돌벽이 그늘에 묻히지 않게 */}
        <pointLight position={[CORRIDOR.x, FLOOR_Y + 3.2, HALL.z[1] - 4]} color="#BFE8EA" intensity={DOOR_LIGHT} distance={13 * M} decay={1.4} />
        <pointLight position={[CORRIDOR.x - 4, FLOOR_Y + 2.2, HALL.z[1] - 2]} color="#F2D9A8" intensity={DOOR_LIGHT * 0.6} distance={7 * M} decay={1.4} />
        <pointLight position={[CORRIDOR.x, INNER_FLOOR + 2.6, INNER.z[0] + 4]} color="#BFE8EA" intensity={DOOR_LIGHT * 0.8} distance={10 * M} decay={1.4} />
        {/* 빛줄기 — 비스듬히 내려온다 */}
        {built.shafts.map((s, i) => (
          <mesh key={i} material={materials.shaft} position={[s.x, (FLOOR_Y + SURFACE_Y) / 2, s.z]} rotation={[0, s.yaw, s.tilt]}>
            <planeGeometry args={[s.width, SURFACE_Y - FLOOR_Y + 2]} />
          </mesh>
        ))}
      </group>
      <primitive object={built.bubbles.points} />
      <primitive object={built.silt.points} />
    </>
  );
}
