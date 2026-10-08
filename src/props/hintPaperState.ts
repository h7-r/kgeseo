/**
 * 밸브 힌트 쪽지가 지금 어디 있나.
 * 버려도 사라지지 않는다 — 잘못 누른 사람이 되돌릴 수 있어야 하고, 동전·관창처럼
 * 내려놓으면 그 자리에 남아야 같은 세계의 물건으로 읽힌다.
 */
import { useSyncExternalStore } from "react";
import type { Vector3Tuple } from "three";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

/**
 * vending — 캔과 함께 나와 배출구에 있다 · hand — 집어 들었다(drinkState 의 paper 와 짝)
 * floor — 버렸다(다시 주울 수 있다) · stored — [H] 로 힌트함에 적어 넣었다(실물 없음)
 */
type HintPaperLocation = "vending" | "hand" | "floor" | "stored";

/** 힌트함에 들어갈 때 쓰는 내용. UI 가 그대로 읽는다. */
export const VALVE_HINT = {
  id: "valveHint",
  name: "밸브 쪽지",
  description: "자판기 배출구에서 캔과 함께 나온 쪽지. 핸들휠 그림 아래 다섯 칸이 비어 있다.",
} as const;

interface HintPaperState {
  location: HintPaperLocation;
  /** floor 일 때만 쓴다 */
  droppedAt: Vector3Tuple | null;
  /** 떨어지는 연출의 시작 시각(ms) */
  droppedTime: number;
}

const state: HintPaperState = {
  location: "vending",
  droppedAt: null,
  droppedTime: 0,
};

const signal = createChangeSignal();

// 버리면 본 데가 아니라 서 있는 발 앞에 떨어뜨린다. 겨냥 자리(findPlacement)는 좌표를
// 본부실 바닥 경계 안으로 당겨, 복도에서 쓰면 쪽지가 벽 속으로 끌려간다.
let footSpot: Vector3Tuple | null = null;
export const setFootSpot = (spot: Vector3Tuple | null) => {
  footSpot = spot;
};
export const getFootSpot = () => footSpot;

export const hintPaperLocation = () => state.location;
export const hintPaperDroppedAt = () => state.droppedAt;

/** 자판기·바닥에서 집어 든다. */
export function pickUpHintPaper() {
  if (state.location === "hand" || state.location === "stored") return false;
  state.location = "hand";
  signal.notify();
  return true;
}

/**
 * 손에서 놓는다. location 이 무엇이든 바닥으로 보낸다 — hand 일 때만 놓으면
 * 핫리로드로 집기가 한 번 빠졌을 때 손만 비고 쪽지가 사라진다. 들었는지는 부르는 쪽이 확인한다.
 */
export function dropHintPaper(spot: Vector3Tuple | null | undefined) {
  state.location = "floor";
  state.droppedAt = spot ? [spot[0], spot[1], spot[2]] : null;
  state.droppedTime = performance.now();
  signal.notify();
  return true;
}

/** [H] — 힌트함에 적어 넣는다. 실물은 사라진다. */
export function storeHintPaper() {
  if (state.location !== "hand") return false;
  state.location = "stored";
  state.droppedAt = null;
  signal.notify();
  return true;
}

/** 힌트함에서 뺐다 — 실물 쪽지를 도로 바닥에 내놓는다. 자리가 없으면 마지막 자리, 그것도 없으면 기본 자리. */
export function restoreHintPaper(spot?: Vector3Tuple | null) {
  if (state.location !== "stored") return false;
  state.location = "floor";
  if (spot) state.droppedAt = [spot[0], spot[1], spot[2]];
  state.droppedTime = performance.now();
  signal.notify();
  return true;
}

/** 개발·테스트용 */
function resetHintPaper() {
  state.location = "vending";
  state.droppedAt = null;
  state.droppedTime = 0;
  signal.notify();
}

export const useHintPaper = () => useSyncExternalStore(signal.subscribe, signal.version);

exposeDevHook("hintPaper", { state, dropHintPaper, storeHintPaper, resetHintPaper });
