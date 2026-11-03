/**
 * 강 밑 꾸밈 자리 — 눈에 보이는 바닥 높이, 바위 · 자갈 · 물풀 · 조개껍데기 · 빛줄기가 설 자리, 고리문이 앉는 돌벽.
 * 걷는 자리의 판정(floorY)은 caveState 가 맡고, 여기는 그 바깥까지 이어지는 보이는 세계만 정한다. 미터.
 */
import * as THREE from "three";

import { smoothstep } from "@/engine/math";
import { createRandom } from "@/engine/random";

import {
  ARCH,
  CORRIDOR,
  DOOR_WALL_X,
  FLOOR_Y,
  HALL,
  INNER,
  INNER_FLOOR,
  LEGEND_SPOTS,
  SURFACE_Y,
  corridorY,
  hallFloorY,
} from "./caveState";
import { nearLightPuzzle } from "./lightLayout";
import type { Placement } from "./seabed";

/** 큰 방 바깥 깊은 바닥 — 이만큼 더 내려가며 모래 언덕이 인다 */
export const DEEP_DROP = 3.4;

const smooth = (t: number) => smoothstep(Math.min(1, Math.max(0, t)));

/** 큰 방 네모에서 바깥으로 얼마나 떨어졌나(미터) */
function outsideHall(x: number, z: number) {
  const dx = Math.max(HALL.x[0] - x, 0, x - HALL.x[1]);
  const dz = Math.max(HALL.z[0] - z, 0, z - HALL.z[1]);
  return Math.hypot(dx, dz);
}

/** 눈에 보이는 바닥 높이 — 걷는 자리는 floorY 와 같고, 그 밖은 강바닥·깊은 모래 언덕으로 이어진다 */
export function seabedY(x: number, z: number) {
  const dx = Math.abs(x - CORRIDOR.x);
  if (z < HALL.z[0]) {
    // 갈라진 길 — 가운데가 길이고 양옆은 강바닥이 완만히 올라간다(물벽 너머로 비친다)
    const rise = Math.min(1.6, 0.12 * Math.pow(Math.max(0, dx - CORRIDOR.halfWidth), 1.4));
    return corridorY(z) + rise + 0.05 * Math.sin(x * 1.1) * Math.sin(z * 1.4);
  }
  if (z >= INNER.z[0] - 0.5 && x >= INNER.x[0] - 1 && x <= INNER.x[1] + 1 && z <= INNER.z[1] + 1)
    return INNER_FLOOR - 0.5;
  const distance = outsideHall(x, z);
  const inside = hallFloorY(x, z);
  if (distance <= 0) return inside;
  const dunes =
    1.1 * Math.sin(x * 0.33 + 1.2) * Math.sin(z * 0.29 + 0.4) + 0.35 * Math.sin(x * 0.9) * Math.cos(z * 0.7);
  const deep = FLOOR_Y - 0.4 - DEEP_DROP * smooth(distance / 16) + dunes * smooth(distance / 5);
  return THREE.MathUtils.lerp(inside, deep, smooth(distance / 1.5));
}

export interface LightShaft {
  x: number;
  z: number;
  tilt: number;
  yaw: number;
  width: number;
  phase: number;
}

/** 바위·자갈·물풀·조개껍데기 자리 — 씨앗이 같으면 늘 같은 자리 */
export function planDecor() {
  const random = createRandom(7731);
  const rocks: Placement[] = [];
  const farRocks: Placement[] = [];
  const pebbles: Placement[] = [];
  const weeds: Placement[] = [];
  const shells: Placement[] = [];
  const pick = (n: number) => Math.floor(random() * n);
  const rock = (list: Placement[], x: number, z: number, size: number, extra: Partial<Placement> = {}) =>
    list.push({
      x,
      z,
      y: seabedY(x, z),
      size,
      yaw: random() * Math.PI * 2,
      sink: 0.12 + random() * 0.1,
      variant: pick(7),
      squash: 0.7 + random() * 0.4,
      ...extra,
    });

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
    const z = onPath
      ? CORRIDOR.zStart + 1 + random() * (HALL.z[0] - CORRIDOR.zStart)
      : HALL.z[0] + random() * (HALL.z[1] - HALL.z[0]);
    if (!onPath && nearLightPuzzle(x, z, 0.35)) continue;
    pebbles.push({
      x,
      z,
      y: seabedY(x, z),
      size: 0.12 + random() * 0.28,
      yaw: random() * 6.3,
      sink: 0.3,
      variant: pick(7),
      squash: 0.6 + random() * 0.4,
    });
  }
  // 물풀 — 둘레 바위 밑동과 그 너머
  for (let i = 0; i < 110; i++) {
    const outside = i < 70;
    const side = random() < 0.5 ? -1 : 1;
    const x = outside
      ? CORRIDOR.x + side * (10.5 + random() * 14)
      : HALL.x[0] + 0.6 + random() * (HALL.x[1] - HALL.x[0] - 1.2);
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
    shells.push({
      x,
      z,
      y: seabedY(x, z) + 0.005,
      size: 0.09 + random() * 0.14,
      yaw: random() * 6.3,
      variant: pick(3),
    });
  }
  // 수면에서 내려오는 빛줄기
  const shafts: LightShaft[] = [];
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
export function buildDoorWall() {
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
