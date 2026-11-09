/**
 * 바위 위(Z3) 4스테이지 자리 — 만나던 자리(선바위 · 너럭바위 · 받침돌 · 독)에서 벼랑 끝 바위 틈(떨어진 자리)까지.
 * 달은 강 쪽(남) 하늘에 낮게 뜬다. 사발 물에 비친 달빛은 북쪽 위로 튀어 받침돌 뒤 선바위에 닿는다.
 * 좌표는 미터. 물건 크기는 가장 긴 변(미터).
 */
import * as THREE from "three";

/** 달 — 방위(+z 에서 +x 쪽으로 돈 각) · 높이각(라디안) */
const MOON_AZIMUTH = 0.12;
const MOON_ELEVATION = THREE.MathUtils.degToRad(25);
/** 달이 있는 쪽(단위 벡터) */
export const MOON_DIR = new THREE.Vector3(
  Math.sin(MOON_AZIMUTH) * Math.cos(MOON_ELEVATION),
  Math.sin(MOON_ELEVATION),
  Math.cos(MOON_AZIMUTH) * Math.cos(MOON_ELEVATION),
);
/** 잔잔한 물에 비친 달빛이 튀어 나가는 쪽 — 달 반대 방위로, 같은 높이각만큼 위로 */
export const REFLECT_DIR = new THREE.Vector3(-MOON_DIR.x, MOON_DIR.y, -MOON_DIR.z);

/** Z3 바위 위 — 이 안에 서 있어야 달이 뜬다 */
export const CLIFF_TOP = { x: [33, 58] as const, z: [4, 27] as const, minY: 12 };

/** 선바위 — 사발 셋의 달빛이 모이는 큰 바위. 넓은 면이 받침돌 쪽(달 쪽)을 본다 */
export const STANDING = { x: 40.46, z: 9.23, height: 2.4, yaw: MOON_AZIMUTH };
/** 둘이 앉던 너럭바위 — 큰 사발의 받침이다 */
export const SEAT = { x: 40.5, z: 11.0, yaw: 0.08, size: 1.6 };

export type BowlSize = "large" | "medium" | "small";
export const BOWL_SIZES: readonly BowlSize[] = ["large", "medium", "small"];

interface BowlSpec {
  name: string;
  /** 지름(미터) */
  diameter: number;
  /** 처음 엎어져 있는 자리 */
  start: { x: number; z: number };
  /** 받침 자리 */
  rest: { x: number; z: number };
  /** 받침돌 모형의 가장 긴 변(미터) — 0 이면 너럭바위(SEAT)가 받침이다 */
  stone: number;
}
/**
 * 사발 셋. 받침은 선바위에서 달 쪽으로 한 줄 — 너럭바위 위(큰 것) · 가운데 받침돌 · 끝 받침돌(작은 것).
 * 멀수록 달빛이 선바위 높은 데 닿는다.
 */
export const BOWLS: Record<BowlSize, BowlSpec> = {
  large: { name: "큰 사발", diameter: 0.3, start: { x: 41.75, z: 11.55 }, rest: { x: 40.69, z: 11.16 }, stone: 0 },
  medium: { name: "사발", diameter: 0.22, start: { x: 40.15, z: 10.95 }, rest: { x: 40.83, z: 12.35 }, stone: 0.62 },
  small: { name: "작은 사발", diameter: 0.15, start: { x: 41.2, z: 10.55 }, rest: { x: 40.97, z: 13.5 }, stone: 0.46 },
};
/** 사발 모형(지름 1 일 때) — 물낯 높이 · 물낯 반지름 */
export const BOWL_WATER = { height: 0.45, radius: 0.385 };

/** 빗물이 찬 옹기 독 · 흙에 반쯤 묻힌 귀때동이(buried 는 묻힌 깊이) */
export const JAR = { x: 42.4, z: 10.4, size: 0.95 };
export const JUG = { x: 43.05, z: 11.6, size: 0.42, buried: 0.09 };
/** 귀때동이 하나로 뿌릴 수 있는 번 */
export const JUG_POURS = 3;

type Point = readonly [number, number];
/**
 * 아랑사의 발자국 길 — 받침돌 곁에서 벼랑 끝 바위 틈까지. 첫 토막만 처음부터 보이고,
 * 나머지는 끊긴 자리에 물을 뿌릴 때마다 한 토막씩 드러난다. 점은 길이 지나는 자리.
 */
export const TRAIL: readonly (readonly Point[])[] = [
  [
    [41.5, 14.3],
    [42.6, 14.9],
    [43.7, 15.7],
    [44.7, 16.7],
  ],
  [
    [44.7, 16.7],
    [45.5, 17.7],
    [46.3, 18.6],
    [47.0, 19.5],
  ],
  [
    [47.0, 19.5],
    [47.8, 20.4],
    [48.6, 21.2],
    [49.3, 22.1],
  ],
  [
    [49.3, 22.1],
    [49.9, 23.0],
    [50.3, 23.9],
    [50.45, 24.7],
  ],
];
/** 미끄러진 자리 — 마지막 발자국에서 벼랑 밖으로 길게 끌린 자국 */
export const SLIP: { from: Point; to: Point } = { from: [50.45, 24.7], to: [50.5, 25.75] };

interface Watcher {
  kind: "man" | "woman";
  /** 풀숲 속 숨은 자리 · 손을 뻗다 멈춘 자리 · 달아난 길 */
  hide: Point;
  reach: Point;
  flee: readonly Point[];
  /** 달아나다 멈춰 선 자리(있으면) — flee 는 여기까지, away 는 그 뒤로 다시 달아난 길 */
  away?: readonly Point[];
}
/**
 * 숨어 있던 셋(사내 둘 · 여인 하나) — 동쪽 풀숲에서 나와 벼랑 끝 앞에서 멈췄다가 달아났다.
 * 첫째 사내는 돌아서자마자 곁의 바위 틈(CLEFT) 앞에서 한 번 멈췄다 — 손에 쥔 것을 거기 던지고 달아났다.
 */
export const WATCHERS: readonly Watcher[] = [
  {
    kind: "man",
    hide: [55.3, 21.0],
    reach: [51.85, 23.55],
    flee: [
      [52.0, 23.45],
      [52.1, 23.38],
    ],
    away: [
      [52.7, 22.6],
      [53.8, 21.7],
      [55.3, 20.6],
    ],
  },
  {
    kind: "man",
    hide: [55.4, 20.3],
    reach: [51.6, 22.95],
    flee: [
      [52.8, 21.9],
      [54.2, 20.9],
      [55.4, 20.0],
    ],
  },
  {
    kind: "woman",
    hide: [55.3, 19.6],
    reach: [50.95, 23.0],
    flee: [
      [52.2, 21.4],
      [53.8, 20.2],
      [55.3, 19.2],
    ],
  },
];
/**
 * 주머니가 떨어진 자리 — 벼랑 끝 동쪽, 큰 바위와 구렁이 바위 사이의 빈 흙바닥(뒤로는 또 한 바위가 막아선 품).
 * 어느 바위에도 닿지 않게 한가운데 놓는다 — 바위에 붙이면 틈에 끼인 것처럼 보인다
 */
export const CLEFT = { x: 51.98, z: 24.02 };
/** 셋이 모여 섰던 자리 — 세 번째 물은 여기에도 끼얹어진다(길을 따라, 미터) */
export const GATHER: readonly Point[] = [
  [50.6, 23.3],
  [51.3, 23.2],
  [52.0, 23.4],
];
/** 벼랑 끝 바위 틈에 남은 것(story/scene3 가 놓는다) — 벗겨진 짚신 한 짝 · 붉은 댕기 */
export const EDGE_RELICS = { shoe: { x: 50.0, z: 24.2 }, ribbon: { x: 48.9, z: 23.1 } };

/** 떨어진 자리 — 마지막 발자국이 미끄러지기 시작한 곳. 틈은 바로 그 뒤에 열린다 */
export const FALL_SPOT = { x: 50.45, z: 24.62 };
/**
 * 구렁이 바위 — 떨어진 자리 곁(동쪽)의 낮은 너럭바위. 윗면에 구렁이 모양 홈이 파였다.
 * size 는 바위의 가장 긴 변, groove 는 홈(=끼운 구렁이상)의 가장 긴 변. 바위는 길이 방향을 남북으로 눕힌다
 */
export const SERPENT_STONE = { x: 51.2, z: 24.2, size: 1.15, yaw: Math.PI / 2, groove: 0.46, grooveYaw: 0.7 };
/**
 * 벼랑 끝 틈 — 미끄러진 자국 위, 두 바위 사이 좁은 목에 선다. 발자국을 끝까지 따라가면 들어서게 된다.
 * 크기는 바위 사이 너비에 맞춘다(미터).
 */
export const EDGE_RIFT = { x: 50.35, z: 24.95, width: 1.5, height: 2.4 };
/** 틈을 지나 깨어나는 자리 — 바위 아래 물가(Z2), 금줄을 바라보고 선다 */
export const RITE_ARRIVAL = { x: 44.2, z: 39.4, heading: "-Z" as const };
/** 굿판 한가운데 — 금줄 안 소반 자리 */
export const RITE_CENTER = { x: 45, z: 37 };
