/**
 * 강 밑 물굴 — 자리와 바닥·벽 판정, 그리고 물속 상태(숨·순간이동).
 * 뜬 돌 넷을 다 건지면 강물이 양쪽으로 갈라져(parted) 강바닥 길이 열리고, 길 끝에서 물이 머리 위에서 합쳐진다(cave).
 * 지형은 손대지 않는다 — 이동 훅이 withCave() 로 감싼 지형을 보고, 물굴 안에서만 여기 바닥·벽을 쓴다.
 * 좌표는 전부 미터.
 */
import { useSyncExternalStore } from "react";

import { gameClearTimeout, gameSetTimeout } from "@/engine/input/gameClock";
import { smoothstep } from "@/engine/math";
import { createChangeSignal } from "@/lib/changeSignal";

import type { Heading } from "../../plan/sitePlan";
import { DEFAULT_TERRAIN, type Terrain } from "../../terrain/terrain";
import { isCameraFocused } from "../../scene/cameraFocus";
import { ritual, useRitualStage } from "../ritual/ritualState";
import { isReadingHeld } from "../../dialogue/readPace";

/** 갈라진 물 사이 강바닥 길 — 물가(44.5)에서 강 밑(−6 m)까지 내려간다 */
export const CORRIDOR = { x: 45, halfWidth: 2.2, zStart: 44.5, zEnd: 58, depth: 6 };
/** 여기를 지나면 물이 머리 위에서 합쳐진다 — 물속 */
export const MERGE_Z = 56;
/** 물굴 큰 방 · 고리문 구멍 · 석실 */
export const HALL = { x: [36, 54] as const, z: [58, 74] as const };
export const DOOR = { x: 45, z: 74, halfWidth: 1.45 };
/** 고리문 뒷벽의 x 범위 — 왼쪽은 물레·석판까지, 오른쪽은 큰 방 끝까지(굴러간 바퀴가 벽 밖 맨 물에 드러나지 않게) */
export const DOOR_WALL_X = [38, 54.5] as const;
const PASSAGE = { z: [74, 76] as const };
/** 석실 — 들어서서 상자까지 거리감이 있게 길다 */
export const INNER = { x: [40, 50] as const, z: [76, 88] as const };
/** 설화 흔적 — 큰 방 바닥에 남은 아랑사·아비사 이야기의 자취(LegendTraces). 퍼즐 자리와 길목을 피했다 */
export const LEGEND_SPOTS = {
  wreck: { x: 38.6, z: 69.2 },
  oar: { x: 43.1, z: 66.6 },
  ribbon: { x: 37.5, z: 60.4 },
  lantern: { x: 42.0, z: 70.4 },
  stele: { x: 37.3, z: 66.8 },
  /** 발자국 두 줄 — 나룻배에서 고리문 쪽으로(가운데 자리) */
  prints: { x: 41.4, z: 71.0 },
};
/** 물고기 굴 — 큰 방 동쪽 벽 밑 바위 굴 넷의 가운데(FishBurrows) */
export const FISH_BURROWS = { x: 52.6, z: 69.4 };
export const FLOOR_Y = -CORRIDOR.depth;
/** 고리문 앞 낮은 돌계단 둘 — 문에서 좀 떨어져 시작하고, 올라서면 문까지 평평한 단(landing) */
export const STEPS = { zStart: 71.0, depth: 0.7, rise: 0.17, halfWidth: 1.7, count: 2 };
export const INNER_FLOOR = FLOOR_Y + STEPS.rise * STEPS.count;
/** 고리문 — 바닥에 선 큰 돌바퀴(반지름). 풀리면 옆으로 굴러가 뒤의 아치 통로가 드러난다 */
export const WHEEL_RADIUS = 2.55;
/** 바퀴 두께 — 닫혀 있는 동안은 바퀴 앞면에서 막힌다 */
export const WHEEL_DEPTH = 0.5;
/** 아치 통로 — 바닥에서 이 높이까지 곧게, 그 위는 반원 */
export const ARCH = { halfWidth: DOOR.halfWidth + 0.05, straight: 2.0 };
/** 바퀴 가운데 높이 — 바퀴가 석실 바닥 높이의 단 위에 서 있다 */
export const DOOR_CENTER_Y = INNER_FLOOR + WHEEL_RADIUS + 0.03;
/** 차오른 수면 — 물굴 천장 */
export const SURFACE_Y = 0.7;
/** 물속 걷는 빠르기 배율 — 살짝 무겁게 */
export const UNDERWATER_SPEED = 0.52;
/**
 * 터치(휴대폰) 물속 배율 — 미르 폰 시험 「물속이 너무 느리다」(11/7). PC 는 Shift 로 달려 헤엄치지만 휴대폰은 스틱을 끝까지 밀어야 해서
 * 같은 0.52 면 체감이 훨씬 느리다. 0.75 는 비교 시험값(코덱스 구현 07회차) — ?swim=0.65 처럼 주소로 바꿔 견준다.
 */
export const TOUCH_UNDERWATER_SPEED = (() => {
  const value = typeof location === "undefined" ? NaN : Number(new URLSearchParams(location.search).get("swim"));
  return Number.isFinite(value) && value > 0.2 && value <= 1.5 ? value : 0.75;
})();

/** 숨(초) */
export const BREATH_SECONDS = 90;
/** 공기 기둥 안에서 숨이 차는 빠르기(초/초) */
const BREATH_REFILL = 28;

const bankY = DEFAULT_TERRAIN.groundAt(CORRIDOR.x, CORRIDOR.zStart - 0.2).y;

export const smooth = (t: number) => smoothstep(Math.min(1, Math.max(0, t)));

/** 강바닥 길이 다 내려가는 z — 물가에서 바로 내려가기 시작해 여기서 바닥(−6 m)에 닿는다 */
const RAMP_END_Z = CORRIDOR.zStart + 8.5;

/** 강바닥 길 높이 — 물가에서 곧장 내려가(경사 약 35°) 53 부터 바닥 */
export function corridorY(z: number) {
  return bankY + (FLOOR_Y - bankY) * smooth((z - (CORRIDOR.zStart + 0.2)) / (RAMP_END_Z - (CORRIDOR.zStart + 0.2)));
}

/** 큰 방 바닥 — 평평한 데 잔 굴곡(계단은 뺀 높이. 바닥 메시가 쓴다) */
export const hallFloorY = (x: number, z: number) => FLOOR_Y + 0.05 * Math.sin(x * 1.3) * Math.sin(z * 1.7);

/** 물굴 바닥 — 길 · 큰 방 · 문 앞 계단 · 석실(한 단 위) */
export function floorY(x: number, z: number) {
  if (z < CORRIDOR.zEnd) return corridorY(z);
  if (z >= HALL.z[1]) return INNER_FLOOR;
  if (z >= STEPS.zStart && Math.abs(x - DOOR.x) <= STEPS.halfWidth) {
    const step = Math.min(STEPS.count, Math.floor((z - STEPS.zStart) / STEPS.depth) + 1);
    return FLOOR_Y + STEPS.rise * step;
  }
  return hallFloorY(x, z);
}

let isDoorOpen = false;
export const setDoorOpen = (open: boolean) => {
  isDoorOpen = open;
};

type GroundSample = ReturnType<Terrain["groundAt"]>;

/** 물이 갈라진 뒤 강가로 돌아오기 전까지 — 물굴 안 모든 것이 이때만 보이고 막힌다 */
export const isCaveShown = () => ritual.isAtLeast("parted") && ritual.stage() !== "cleared";

/** 컴포넌트용 — 기우제 단계가 바뀔 때 다시 그린다 */
export function useCaveShown() {
  useRitualStage();
  return isCaveShown();
}

export const cave = {
  /** 물이 갈라져 있는 동안만 바닥·벽을 바꿔 끼운다 */
  isOpen: isCaveShown,
  /** 물굴 자리인가 — 코어 밖(z 50 너머)으로 나가도 되는 곳 */
  contains: (x: number, z: number) => z >= CORRIDOR.zStart && z <= INNER.z[1] + 0.5 && Math.abs(x - CORRIDOR.x) <= 11,
  groundAt(x: number, z: number): GroundSample | null {
    if (!cave.contains(x, z)) return null;
    return { y: floorY(x, z), zone: null, path: null, isFall: false, isWater: false, noFallRecovery: true };
  },
  /** 막히는 곳 이름 — 물벽 · 동굴 벽 · 고리문 · 석실 벽 · 소품. 안 막히면 null */
  blockedAt(x: number, z: number, radius: number): string | null {
    if (z < CORRIDOR.zStart) return null;
    for (const obstacle of obstacles) {
      const distance = Math.hypot(obstacle.x - x, obstacle.z - z);
      if (distance >= obstacle.radius + radius) continue;
      // 물속 점프로 발이 꼭대기를 넘으면 지나간다
      if (playerFoot.y > obstacle.top - 0.05) continue;
      // 이미 안에 들어와 있으면(위에서 내려앉은 경우) 바깥쪽으로는 빠져나갈 수 있다
      if (distance >= Math.hypot(obstacle.x - playerFoot.x, obstacle.z - playerFoot.z) - 1e-4) continue;
      return obstacle.name;
    }
    if (z < CORRIDOR.zEnd) return Math.abs(x - CORRIDOR.x) + radius > CORRIDOR.halfWidth ? "물벽" : null;
    // 닫힌 바퀴는 벽보다 앞으로 나와 있다 — 바퀴 앞면에서 막는다
    if (!isDoorOpen && z >= DOOR.z - WHEEL_DEPTH - radius && Math.abs(x - DOOR.x) < WHEEL_RADIUS + radius)
      return "고리문";
    if (z < DOOR.z - radius) return x - radius < HALL.x[0] || x + radius > HALL.x[1] ? "동굴 벽" : null;
    const inDoorway = Math.abs(x - DOOR.x) + radius <= DOOR.halfWidth;
    if (z < PASSAGE.z[1]) return isDoorOpen && inDoorway ? null : "고리문";
    // 받침을 다 맞히기 전 받침 줄 너머는 캄캄한 어둠이다 — 그 안에서 헤매며 멈춘 것처럼 되지 않게 몸을 막는다(11/11 플레이테스트)
    if (chamberBackLimitZ !== null && z + radius > chamberBackLimitZ) return "받침 너머 어둠";
    if (z + radius <= INNER.z[1]) return x - radius < INNER.x[0] || x + radius > INNER.x[1] ? "석실 벽" : null;
    return "석실 벽";
  },
};

/** 석실 받침 줄 너머를 막는 선(z, 미터). 받침을 다 맞히기 전에만 InnerChamber 가 건다 — null 이면 막지 않는다 */
let chamberBackLimitZ: number | null = null;
export const setChamberBackLimit = (z: number | null) => {
  chamberBackLimitZ = z;
};

/** 물굴 안 소품의 둥근 충돌 자리(미터) — 석상 · 받침 · 등 · 비석 · 바위 틈 같은 것을 몸이 뚫고 지나가지 않게 */
interface CaveObstacle {
  x: number;
  z: number;
  radius: number;
  /** 꼭대기 높이(미터) — 발이 이보다 높으면 넘어간다 */
  top: number;
  name: string;
}
/** 지금 발 자리 — 물굴이 매 프레임 적는다(넘어가기 · 빠져나가기 판정) */
const playerFoot = { x: 0, y: -99, z: 0 };
export const setCavePlayerFoot = (x: number, y: number, z: number) => {
  playerFoot.x = x;
  playerFoot.y = y;
  playerFoot.z = z;
};
const obstacles: CaveObstacle[] = [];
/** 등록하고, 지우는 함수를 돌려준다(컴포넌트가 내려갈 때) */
export function registerCaveObstacles(list: CaveObstacle[]) {
  obstacles.push(...list);
  return () => {
    for (const item of list) {
      const at = obstacles.indexOf(item);
      if (at >= 0) obstacles.splice(at, 1);
    }
  };
}

/** 이동 훅이 쓰는 지형 — 물굴이 열려 있고 그 자리면 물굴 바닥·벽, 아니면 원래 지형 */
export function withCave<T extends Terrain>(terrain: T): T {
  return {
    ...terrain,
    groundAt: (x: number, z: number) => (cave.isOpen() && cave.groundAt(x, z)) || terrain.groundAt(x, z),
    blockedAt: (x: number, z: number, y?: number, radius?: number) =>
      (cave.isOpen() ? cave.blockedAt(x, z, radius ?? 0.3) : null) ?? terrain.blockedAt(x, z, y, radius),
  };
}

/** 물이 갈라진 정도(0~1) — 물굴이 매 프레임 올리고, 기우제 물판이 그 폭만큼 틈을 벌린다 */
let partOpenness = 0;
export const setPartOpenness = (value: number) => {
  partOpenness = value;
};
export const getPartOpenness = () => partOpenness;

// ── 물속 상태 ──
const signal = createChangeSignal();
let isUnderwater = false;
let breath = BREATH_SECONDS;
/** 숨이 다해 까매지는 정도(0~1) */
let blackout = 0;
/** 마지막으로 먹물을 뒤집어쓴 때(performance 초) · 그때마다 하나씩 는다 — 화면에 먹 얼룩이 튄다 */
let inkHitAt = -1;
let inkHits = 0;
/** 석실 받침 너머 어둠 속에 들어선 정도(0~1) — 화면 위에 검은 막을 덮는다(만화 외곽선까지 가린다) */
let insideDark = 0;
let snapshot = { isUnderwater, breath, blackout, inkHitAt, inkHits, insideDark };

function publish() {
  snapshot = { isUnderwater, breath, blackout, inkHitAt, inkHits, insideDark };
  signal.notify();
}

export const setUnderwater = (next: boolean) => {
  if (isUnderwater === next) return;
  isUnderwater = next;
  publish();
};
export const getUnderwater = () => isUnderwater;
export const useIsUnderwater = () => useSyncExternalStore(signal.subscribe, getUnderwater);
export const useBreath = () => useSyncExternalStore(signal.subscribe, () => snapshot);

/** 공기 기둥 — 뒤집힌 독 · 숨구멍에서 솟는 거품. 그 안에 서면 숨이 찬다 */
interface AirColumn {
  x: number;
  z: number;
  radius: number;
  isOn: () => boolean;
}
const airColumns: AirColumn[] = [];
export function registerAirColumn(column: AirColumn) {
  airColumns.push(column);
  return () => {
    const index = airColumns.indexOf(column);
    if (index >= 0) airColumns.splice(index, 1);
  };
}
const isInAir = (x: number, z: number) => airColumns.some((c) => c.isOn() && Math.hypot(c.x - x, c.z - z) <= c.radius);

/** 마지막으로 숨을 쉰 자리 — 숨이 다하면 여기로 돌아간다 */
let lastAirSpot = { x: CORRIDOR.x, z: MERGE_Z - 2.5 };
const rememberAirSpot = (x: number, z: number) => {
  lastAirSpot = { x, z };
};

/**
 * 숨을 지키는 장면 — 문이 열리는 장면처럼 보여 주는 동안은 숨이 줄지도, 생물에게 다치지도 않는다(공기 기둥 안 회복은 된다).
 * 화면 고정(focusCamera)만 멈추던 것을 장면 단위로 — 고리문은 화면이 풀린 뒤에도 바퀴가 굴러 그동안 숨이 깎였다(미르 11/10).
 * 받을 때 해제 함수를 돌려준다 — 같은 장면이 겹쳐도 한쪽 해제가 다른 쪽을 풀지 않게(Codex 01). 저장하지 않는다.
 */
const breathGuards = new Set<symbol>();
export function guardBreath(label: string): () => void {
  const token = Symbol(label);
  breathGuards.add(token);
  return () => {
    breathGuards.delete(token);
  };
}
/** 정해진 시간(초, 게임 시계 — 멈춤 중엔 안 줄어든다)만큼 지킨다 */
export function guardBreathFor(label: string, seconds: number): () => void {
  const release = guardBreath(label);
  const timer = gameSetTimeout(release, seconds * 1000);
  return () => {
    gameClearTimeout(timer);
    release();
  };
}
/** 지금 숨을 지키는 중인가 — 장면 · 화면 고정 */
export const isBreathGuarded = () => breathGuards.size > 0 || isCameraFocused() || isReadingHeld();

let wasBreathGuarded = false;
/** 숨 — 매 프레임. 물속이 아니거나 공기 기둥 안이면 찬다. 다하면 true 를 돌려주고 숨을 채운다. 지키는 장면 동안은 줄지 않는다 */
export function tickBreath(dt: number, x: number, z: number) {
  if (isBreathHeld) return false;
  const breathBefore = breath;
  const blackoutBefore = blackout;
  const inAir = !isUnderwater || isInAir(x, z);
  if (inAir) {
    if (isInAir(x, z)) rememberAirSpot(x, z);
    breath = Math.min(BREATH_SECONDS, breath + BREATH_REFILL * dt);
  } else if (!isBreathGuarded()) breath = Math.max(0, breath - dt);
  const drowned = breath <= 0;
  if (drowned) breath = BREATH_SECONDS;
  // 까매짐은 숨이 다하면 1 로 튀고 2초쯤에 걸쳐 걷힌다
  blackout = drowned ? 1 : Math.max(0, blackout - dt * 0.5);
  // 숨이 가득 찬 채 물 밖에 있으면 값이 그대로다 — 그대로면 알리지 않는다(매 프레임 HUD 가 다시 그려졌다, 성능 진단 11/13).
  // 숨 보호가 걸리거나 풀리는 순간은 값이 멈춰도 알린다 — HUD 가 그때 경고 깜빡임을 멈추고 되살린다(Codex 리뷰)
  const isGuarded = isBreathGuarded();
  const hasGuardChanged = isGuarded !== wasBreathGuarded;
  wasBreathGuarded = isGuarded;
  if (drowned || hasGuardChanged || breath !== breathBefore || blackout !== blackoutBefore) publish();
  return drowned;
}
export const getLastAirSpot = () => lastAirSpot;
export const getBreath = () => breath;
/** 개발용 — 숨을 바로 맞춘다 */
export const setBreath = (seconds: number) => {
  breath = seconds;
  publish();
};

/** 생물에게 다쳐도 이만큼(초)은 남긴다 — 생물이 직접 익사시키지 않는다 */
const HURT_FLOOR_SECONDS = 5;

/**
 * 물속 생물에게 다쳐 숨이 깎인다 — 복어 가시 15 · 먹물 7. 깎인 숨은 깎인 채로 간다.
 * 0 까지 깎으면 다음 숨 셈이 「익사」로 보고 숨을 70초로 도로 채워, 숨이 적을 때 복어에 찔리는 쪽이 오히려 이득이었다.
 * 이미 바닥 아래면 더 깎지도 채우지도 않는다.
 */
/** 숨을 깎는다 — 실제로 깎았으면 true(알림은 그때만 · 화면 고정 중엔 안 다친다) */
export function hurtBreath(seconds: number, cause: "spike" | "ink"): boolean {
  // 화면이 고정된 동안은 다치지 않는다 — 몸이 멈춘 채 숨이 깎이지 않게(박람회 출품판 26회차 Codex)
  if (!isUnderwater || isBreathGuarded()) return false;
  const before = breath;
  breath = Math.max(Math.min(breath, HURT_FLOOR_SECONDS), breath - seconds);
  if (cause === "ink") {
    inkHitAt = performance.now() / 1000;
    inkHits += 1;
  }
  publish();
  // 숨이 이미 바닥(HURT_FLOOR_SECONDS 이하)이면 깎이지 않는다 — 그때는 「숨이 줄었다」를 띄우지 않게(먹물 얼룩은 그대로 · Codex 리뷰)
  return breath < before;
}

export const setInsideDark = (level: number) => {
  const next = Math.round(level * 50) / 50;
  if (next === insideDark) return;
  insideDark = next;
  publish();
};

/** 물속이 흔들리면 바닥 모래가 일어 물이 흐려진다 — 흔드는 쪽이 세기(0~1)를 더하고, 물굴이 매 프레임 줄여 가며 그린다 */
let sandStir = 0;
export const stirSand = (amount: number) => {
  if (isUnderwater) sandStir = Math.min(1.5, sandStir + amount);
};
export const takeSandStir = (dt: number) => {
  const now = sandStir;
  sandStir = Math.max(0, sandStir - dt * 0.35);
  return now;
};

/** 먹물 공격을 시작했나 — 물에 들자마자 덤비면 거슬려서, 진주 빛 잇기에서 셋째 조개를 돌리기 시작한 뒤부터 */
let isInkArmed = false;
export const armInk = () => {
  isInkArmed = true;
};
export const getInkArmed = () => isInkArmed;

// ── 순간이동 — 이동 훅이 등록한다(숨이 다했을 때 · 물살에 실려 나갈 때) ──
type Teleport = (x: number, z: number, heading?: Heading) => void;
let teleporter: { current: Teleport | null } | null = null;
export const registerTeleporter = (ref: { current: Teleport | null }) => {
  teleporter = ref;
};
export const teleportPlayer = (x: number, z: number, heading?: Heading) => teleporter?.current?.(x, z, heading);

/** 물길에 끌려 나가는 동안은 숨이 줄지 않는다 — 끌려가다 익사 처리되면 안 된다 */
let isBreathHeld = false;
export const holdBreathWhileLeaving = () => {
  isBreathHeld = true;
};
/** 물길에 끌려 나가는 중인가 — 그동안은 「안전한 곳으로 이동」을 막는다(movement/safeSpot) */
export const isLeavingChamber = () => isBreathHeld;
/** 물 밖으로 나왔다 — 숨과 까매짐을 걷는다. 이 뒤로는 숨을 세지 않아 안 걷으면 화면이 까만 채 남는다 */
export function clearBreathAfterLeaving() {
  isBreathHeld = false;
  breath = BREATH_SECONDS;
  blackout = 0;
  publish();
}

/** 개발용 초기화 */
export function resetCaveState() {
  breathGuards.clear();
  isDoorOpen = false;
  isUnderwater = false;
  breath = BREATH_SECONDS;
  blackout = 0;
  isInkArmed = false;
  publish();
}
