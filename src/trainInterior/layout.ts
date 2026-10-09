import type * as THREE from "three";

import { buildMergedBoxes, type BoxPiece } from "@/engine/geometry";
import { createRandom } from "@/engine/random";

import { ATLAS_GRID } from "./atlasTextures";
import type { FluorescentLampState } from "./FluorescentLamp";
import { CAR_LENGTH, CAR_WIDTH, DOOR_WIDTH, DOOR_X, WINDOW_BOTTOM, WINDOW_TOP, WINDOW_WIDTH } from "./dimensions";

// 큰 창 5~6개가 작은 창 8개보다 시원하고 그리는 양도 준다.
const WINDOW_COUNT = Math.max(2, Math.round(CAR_LENGTH / 9));

/** 창 가운데 x 목록 */
const WINDOW_XS = Array.from(
  { length: WINDOW_COUNT },
  (_, i) => -CAR_LENGTH / 2 + 5 + (i * (CAR_LENGTH - 10)) / (WINDOW_COUNT - 1),
);

/** 출입문과 겹치는 창 자리. 문과 창이 겹치면 벽이 뚫려 보여 그 자리(-z 쪽)에는 창을 두지 않는다. */
const isOverlappingDoor = (x: number) => Math.abs(x - DOOR_X) < (WINDOW_WIDTH + DOOR_WIDTH) / 2;
const hasWindow = (x: number, side: number) => !(side === -1 && isOverlappingDoor(x));

/** 창마다 [왼(-z), 오(+z)] 를 따로 뽑아 한쪽만 막힌 창이 나오게 한다. */
export function pickBoardedWindows(windowSeed: number, ratio: number): [boolean, boolean][] {
  const rnd = createRandom(windowSeed * 977 + 13);
  return WINDOW_XS.map(() => [rnd() < ratio, rnd() < ratio]);
}

/** 창 하나를 네 변으로 감싸는 틀 + 아래 턱. 턱이 있어야 벽에 뚫린 구멍이 아니라 창문이 된다. */
export function buildWindowFrames(): THREE.BufferGeometry | null {
  const boxes: BoxPiece[] = [];
  const middle = (WINDOW_TOP + WINDOW_BOTTOM) / 2;
  const height = WINDOW_TOP - WINDOW_BOTTOM;
  for (const x of WINDOW_XS)
    for (const side of [-1, 1]) {
      if (!hasWindow(x, side)) continue;
      const z = side * (CAR_WIDTH / 2 - 0.12);
      boxes.push({ size: [WINDOW_WIDTH, 0.3, 0.24], position: [x, WINDOW_TOP - 0.15, z] });
      boxes.push({ size: [WINDOW_WIDTH, 0.3, 0.24], position: [x, WINDOW_BOTTOM + 0.15, z] });
      boxes.push({ size: [0.3, height, 0.24], position: [x - WINDOW_WIDTH / 2 + 0.15, middle, z] });
      boxes.push({ size: [0.3, height, 0.24], position: [x + WINDOW_WIDTH / 2 - 0.15, middle, z] });
      boxes.push({ size: [WINDOW_WIDTH + 0.4, 0.22, 0.7], position: [x, WINDOW_BOTTOM - 0.1, z + side * -0.3] });
    }
  return buildMergedBoxes(boxes);
}

/** 창과 창 사이 벽. 이걸 막아야 어두운 창밖이 검은 띠가 아니라 창 여러 개로 읽힌다. */
export function buildPillars(): THREE.BufferGeometry | null {
  const boxes: BoxPiece[] = [];
  const halfWidth = WINDOW_WIDTH / 2;
  for (const side of [-1, 1]) {
    const spans: [number, number][] = [];
    let previous = -CAR_LENGTH / 2;
    for (const x of WINDOW_XS.filter((x) => hasWindow(x, side))) {
      spans.push([previous, x - halfWidth]);
      previous = x + halfWidth;
    }
    spans.push([previous, CAR_LENGTH / 2]);
    for (const [a, b] of spans) {
      const w = b - a;
      if (w <= 0.02) continue;
      boxes.push({
        size: [w, WINDOW_TOP - WINDOW_BOTTOM, 0.2],
        position: [(a + b) / 2, (WINDOW_TOP + WINDOW_BOTTOM) / 2, side * (CAR_WIDTH / 2 + 0.1)],
      });
    }
  }
  return buildMergedBoxes(boxes);
}

/** 한쪽 벽의 유리. 판이 아니라 얇은 상자여야 합칠 수 있고, 창 하나가 UV 0~1 을 통째로 받는다. */
export function buildGlass(side: number): THREE.BufferGeometry | null {
  return buildMergedBoxes(
    WINDOW_XS.filter((x) => hasWindow(x, side)).map((x) => ({
      size: [WINDOW_WIDTH - 0.5, WINDOW_TOP - WINDOW_BOTTOM - 0.5, 0.04],
      position: [x, (WINDOW_TOP + WINDOW_BOTTOM) / 2, side * (CAR_WIDTH / 2 + 0.15)],
    })),
  );
}

/** 막힌 창의 판자. 각도를 조금씩 틀어야 급하게 대충 막은 것으로 보인다 — 반듯하면 창틀로 보인다. */
export function buildPlanks(
  boarded: [boolean, boolean][],
  plankCount: number,
  plankThickness: number,
  windowSeed: number,
): THREE.BufferGeometry | null {
  const rnd = createRandom(windowSeed * 31 + 7);
  const boxes: BoxPiece[] = [];
  WINDOW_XS.forEach((x, i) => {
    for (const side of [-1, 1]) {
      if (!hasWindow(x, side)) continue;
      if (!boarded[i][side === -1 ? 0 : 1]) continue;
      for (let k = 0; k < plankCount; k++) {
        const gap = (WINDOW_TOP - WINDOW_BOTTOM) / (plankCount + 1);
        const y = WINDOW_BOTTOM + gap * (k + 1) + (rnd() - 0.5) * 0.4;
        boxes.push({
          size: [WINDOW_WIDTH + 0.5 + rnd() * 0.8, plankThickness, 0.14],
          position: [x + (rnd() - 0.5) * 0.6, y, side * (CAR_WIDTH / 2 + 0.02)],
          rotation: [0, 0, (rnd() - 0.5) * 0.13],
        });
      }
    }
  });
  return buildMergedBoxes(boxes);
}

/** 짐 선반과 받침 팔. 팔이 없으면 판이 공중에 떠 보인다. */
export function buildShelf(): THREE.BufferGeometry | null {
  return buildMergedBoxes(
    [-1, 1].flatMap((side): BoxPiece[] => [
      { size: [CAR_LENGTH - 5, 0.18, 1.7], position: [0, WINDOW_TOP + 0.7, side * (CAR_WIDTH / 2 - 1.0)] },
      ...Array.from({ length: 7 }, (_, i): BoxPiece => ({
        size: [0.16, 0.9, 1.5],
        position: [-CAR_LENGTH / 2 + 5 + (i * (CAR_LENGTH - 10)) / 6, WINDOW_TOP + 1.15, side * (CAR_WIDTH / 2 - 1.0)],
      })),
    ]),
  );
}

interface LampSpot {
  x: number;
  state: FluorescentLampState;
}

/** 씨앗을 고정해야 새로고침해도 같은 등이 죽어 있다 — '이 열차는 원래 저랬다'가 된다. */
export function computeLampSpots(
  lampSeed: number,
  lampCount: number,
  deadRatio: number,
  flickerRatio: number,
  flickerPeriod: number,
): LampSpot[] {
  const rnd = createRandom(lampSeed * 613 + 29);
  return Array.from({ length: lampCount }, (_, i) => {
    const x = -CAR_LENGTH / 2 + 6 + (i * (CAR_LENGTH - 12)) / Math.max(1, lampCount - 1);
    const r = rnd();
    let state: FluorescentLampState;
    if (r < deadRatio) state = { kind: "dead" };
    else if (r < deadRatio + flickerRatio)
      // 위상을 흩어야 여러 개가 동시에 깜빡이지 않는다(그러면 조명 연출로 보인다).
      state = { kind: "flicker", phase: rnd() * 60, period: flickerPeriod * (0.8 + rnd() * 0.6) };
    else state = { kind: "steady" };
    return { x, state };
  });
}

interface SeatSpot {
  x: number;
  z: number;
  /** +1 = +x 를 본다(등받이는 -x 쪽) */
  facing: number;
}

interface SeatLayoutOptions {
  groupCount: number;
  groupSpacing: number;
  facingGap: number;
  start: number;
  wallGap: number;
}

/**
 * 1인용 좌석을 네 개씩 마주 보게 놓는다. 2인 벤치는 덩어리가 커 상자처럼 읽혔고,
 * 마주 보는 자리는 누군가 이야기를 나눈 자리가 되어 단서를 놓기에도 좋다.
 */
export function computeSeatSpots({
  groupCount,
  groupSpacing,
  facingGap,
  start,
  wallGap,
}: SeatLayoutOptions): SeatSpot[] {
  const spots: SeatSpot[] = [];
  for (let group = 0; group < groupCount; group++) {
    const base = -CAR_LENGTH / 2 + start + group * groupSpacing;
    // 앞줄은 +x, 뒷줄은 -x 를 본다.
    for (const [rowIndex, facing] of [
      [0, 1],
      [1, -1],
    ]) {
      const x = base + rowIndex * facingGap;
      if (x > CAR_LENGTH / 2 - 4) continue;
      for (const side of [-1, 1]) spots.push({ x, z: side * (CAR_WIDTH / 2 - wallGap), facing });
    }
  }
  return spots;
}

interface SeatGeometries {
  fabric: THREE.BufferGeometry | null;
  frame: THREE.BufferGeometry | null;
  armrest: THREE.BufferGeometry | null;
}

/**
 * 좌석을 재질별(천·틀·팔걸이) 세 덩어리로 합친다. 좌석마다 아틀라스 칸이 달라 얼룩·찢김이 다 다르다.
 * 치수(scale 1): 폭 1.55 ≈ 0.47 m · 깊이 1.7 · 앉는 높이 1.5 · 등받이 위 4.4 ≈ 1.32 m.
 */
export function buildSeats(spots: SeatSpot[], scale: number): SeatGeometries {
  const K = scale;
  const N = ATLAS_GRID;
  const fabric: BoxPiece[] = [],
    frame: BoxPiece[] = [],
    armrest: BoxPiece[] = [];
  spots.forEach(({ x, z, facing: d }, seatIndex) => {
    // 한 좌석의 앉는 면·등받이·머리받침은 같은 칸(같은 천)이다.
    const cell = { uvCell: [seatIndex % N, ((seatIndex / N) | 0) % N] as [number, number], uvGrid: N };
    // 두 겹으로 쌓아 앞 모서리를 둥글게
    fabric.push({ size: [1.7 * K, 0.34 * K, 1.55 * K], position: [x, 1.52 * K, z], ...cell });
    fabric.push({ size: [1.5 * K, 0.18 * K, 1.4 * K], position: [x + d * 0.1 * K, 1.74 * K, z], ...cell });
    // 등받이는 8° 눕힌다. 반듯하면 사무용 의자처럼 보인다
    fabric.push({
      size: [0.42 * K, 2.5 * K, 1.55 * K],
      position: [x - d * 0.78 * K, 2.95 * K, z],
      rotation: [0, 0, d * 0.14],
      ...cell,
    });
    // 머리 받침이 있어야 열차 좌석이 된다
    fabric.push({
      size: [0.4 * K, 0.85 * K, 1.15 * K],
      position: [x - d * 1.06 * K, 4.32 * K, z],
      rotation: [0, 0, d * 0.14],
      ...cell,
    });
    // 팔걸이는 가로 + 세로 두 토막이라야 널빤지로 안 보인다
    for (const side of [-1, 1]) {
      armrest.push({
        size: [1.5 * K, 0.16 * K, 0.15 * K],
        position: [x + d * 0.05 * K, 2.42 * K, z + side * 0.82 * K],
      });
      armrest.push({
        size: [0.16 * K, 0.62 * K, 0.15 * K],
        position: [x - d * 0.62 * K, 2.1 * K, z + side * 0.82 * K],
      });
    }
    // 가운데 기둥 + 바닥 받침판
    frame.push({ size: [0.42 * K, 1.3 * K, 0.42 * K], position: [x, 0.72 * K, z], ...cell });
    frame.push({ size: [1.3 * K, 0.16 * K, 1.15 * K], position: [x, 0.1 * K, z], ...cell });
    // 등받이 뒤 손잡이 봉. 작지만 밀도를 만든다
    frame.push({ size: [0.14 * K, 0.14 * K, 1.3 * K], position: [x - d * 1.02 * K, 4.82 * K, z], ...cell });
  });
  return { fabric: buildMergedBoxes(fabric), frame: buildMergedBoxes(frame), armrest: buildMergedBoxes(armrest) };
}

interface SeatCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** 지오메트리와 같은 자리 목록에서 만든다. 따로 계산하면 보이는 것과 못 지나가는 곳이 어긋난다. */
export function computeSeatColliders(spots: SeatSpot[], scale: number): SeatCollider[] {
  return spots.map(({ x, z, facing }) => ({
    minX: x - (facing > 0 ? 1.3 : 1.0) * scale,
    maxX: x + (facing > 0 ? 1.0 : 1.3) * scale,
    minZ: z - 0.95 * scale,
    maxZ: z + 0.95 * scale,
  }));
}
