/**
 * 자판기 동전(토큰)의 지금 상태와 규칙.
 * 캔 그림 동전은 음료 자판기에만, 종이컵 그림 동전은 커피 자판기에만 들어간다.
 * 틀리게 넣으면 그 자판기 반환구로 도로 나와 다시 주울 수 있다.
 */
import { useSyncExternalStore } from "react";
import type { Vector3Tuple } from "three";

import { playSound } from "@/audio/sound";
import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

import { insertCoin as lightUpButtons, type VendingId } from "./vendingMachineState";

export type CoinKind = "can" | "cup";

/**
 * floor — 바닥에 놓여 있음 · hand — 들고 있음 · spent — 제대로 넣어져 사라짐(잠시 뒤 처음 자리에 다시 생긴다)
 * returned:<자판기> — 잘못 넣어 그 자판기 반환구로 나옴
 */
type CoinLocation = "floor" | "hand" | "spent" | `returned:${VendingId}`;

type InsertResult = "accepted" | "returned";

interface CoinInsertion {
  kind: CoinKind;
  vendingId: VendingId;
  result: InsertResult;
  /** 투입구 월드 좌표. 동전이 여기로 날아가 들어간다. */
  slot: Vector3Tuple | null;
  t0: number;
}

interface CoinState {
  location: Record<CoinKind, CoinLocation>;
  held: CoinKind | null;
  inserting: CoinInsertion | null;
  /** 내려놓은 월드 좌표. null 이면 기본 자리. */
  droppedAt: Record<CoinKind, Vector3Tuple | null>;
  /** 내려놓은 시각(ms) — 낙하·반동 연출의 시작점. */
  droppedTime: Record<CoinKind, number>;
}

// 넣은 동전이 처음 자리에 다시 생기기까지(ms)
const RESPAWN_MS = 1200;

const MATCHING_MACHINE: Record<CoinKind, VendingId> = { can: "drink", cup: "coffee" };

const state: CoinState = {
  location: { can: "floor", cup: "floor" },
  held: null,
  inserting: null,
  droppedAt: { can: null, cup: null },
  droppedTime: { can: 0, cup: 0 },
};

const signal = createChangeSignal();

export function getHeldCoin() {
  return state.held;
}
export function getCoinLocation(kind: CoinKind) {
  return state.location[kind];
}
export function getCoinInsertion() {
  return state.inserting;
}
export function getCoinDroppedAt(kind: CoinKind) {
  return state.droppedAt[kind];
}
/** 마지막으로 내려놓은 시각(ms). 0 이면 낙하 연출 없음(처음부터 바닥). */
export function getCoinDroppedTime(kind: CoinKind) {
  return state.droppedTime[kind];
}

// 잘못 넣은 동전은 그 자판기의 실제 반환구멍 앞에서 나와야 한다. 자판기가 제 자리를 등록한다.
const returnSlots: Record<VendingId, Vector3Tuple | null> = { drink: null, coffee: null };
export function registerReturnSlot(vendingId: VendingId, position: Vector3Tuple | null) {
  returnSlots[vendingId] = position;
}
export function getReturnSlotPosition(vendingId: VendingId) {
  return returnSlots[vendingId];
}
// 반환구 앞 착지점 — 구멍에서 나와 자판기보다 조금 앞 바닥에 떨어진다.
const returnLandings: Record<VendingId, Vector3Tuple | null> = { drink: null, coffee: null };
export function registerReturnLanding(vendingId: VendingId, position: Vector3Tuple | null) {
  returnLandings[vendingId] = position;
}
export function getReturnLandingPosition(vendingId: VendingId) {
  return returnLandings[vendingId];
}

/** 바닥·반환구의 동전을 줍는다. 이미 뭔가 들고 있거나 넣는 중이면 무시. */
export function pickUpCoin(kind: CoinKind) {
  if (state.held || state.inserting) return false;
  const location = state.location[kind];
  if (location === "hand" || location === "spent") return false;
  state.location[kind] = "hand";
  state.held = kind;
  playSound("lockDial", { volume: 0.7 }); // 전용 동전 소리가 없어 자물쇠 금속음을 빌린다
  signal.notify();
  return true;
}

/** 든 동전을 내려놓는다(투입구 아닌 곳). 자리가 없으면 원래 자리로. */
export function dropCoin(position: Vector3Tuple | null = null) {
  if (!state.held || state.inserting) return false;
  const kind = state.held;
  state.location[kind] = "floor";
  state.droppedAt[kind] = position ? [position[0], position[1], position[2]] : null;
  state.droppedTime[kind] = performance.now();
  state.held = null;
  playSound("lockDial", { volume: 0.9 });
  signal.notify();
  return true;
}

/**
 * 투입구에 E. 바로 넣지 않고 투입 모션을 시작한다(held → inserting).
 * 모션이 끝나면 finishCoinInsert() 가 결과를 확정한다.
 */
export function tryInsertCoin(vendingId: VendingId, slot: Vector3Tuple | null = null) {
  const held = state.held;
  if (!held || state.inserting) return null;
  const result: InsertResult = MATCHING_MACHINE[held] === vendingId ? "accepted" : "returned";
  state.inserting = { kind: held, vendingId, result, slot, t0: 0 };
  state.held = null;
  playSound("lockDial", { volume: 0.7 });
  signal.notify();
  return result;
}

/** 투입 모션이 끝나면 부른다. */
export function finishCoinInsert() {
  const insertion = state.inserting;
  if (!insertion) return;
  if (insertion.result === "accepted") {
    state.location[insertion.kind] = "spent";
    playSound("lockOpen", { volume: 0.9 });
    lightUpButtons(insertion.vendingId);
    // 한 번 넣고 끝나면 다시 못 해 본다 — 잠시 뒤 처음 자리에 떨어지며 다시 생긴다.
    const kind = insertion.kind;
    setTimeout(() => {
      if (state.location[kind] !== "spent") return; // 그새 초기화됐으면 그대로
      state.location[kind] = "floor";
      state.droppedAt[kind] = null;
      state.droppedTime[kind] = performance.now();
      signal.notify();
    }, RESPAWN_MS);
  } else {
    state.location[insertion.kind] = `returned:${insertion.vendingId}`;
    state.droppedTime[insertion.kind] = performance.now();
    playSound("lockDial", { volume: 0.9 });
  }
  state.inserting = null;
  signal.notify();
}

/** 개발·테스트용 초기화 */
function resetCoins() {
  state.location = { can: "floor", cup: "floor" };
  state.held = null;
  state.inserting = null;
  state.droppedAt = { can: null, cup: null };
  state.droppedTime = { can: 0, cup: 0 };
  signal.notify();
}

/** 판 번호만 구독하고 상태는 그때 꺼내 쓴다. */
export const useCoins = () => useSyncExternalStore(signal.subscribe, signal.version);

exposeDevHook("coins", { state, pickUpCoin, tryInsertCoin, resetCoins });
