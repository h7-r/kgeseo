/**
 * 손에 든 음료(커피 종이컵·음료 캔)와 밸브 힌트 쪽지의 상태와 규칙.
 * 컵: 마시기 → … → 다 비면 버리기. 캔: 따기 → 마시기 → … → 버리기.
 * 쪽지: 펼쳐 보기 → 한 번 더 E 면 버리기.
 */
import { useSyncExternalStore } from "react";

import { playSound } from "@/audio/sound";
import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

type HeldDrinkKind = "cup" | "can" | "paper";
type DrinkAction = "open" | "sip" | "view";
type DrinkUseResult = DrinkAction | "discard";

const SIP_AMOUNT = 0.34; // 약 3모금이면 빈다

interface DrinkState {
  held: boolean;
  kind: HeldDrinkKind | null;
  /** 용기 색(컵 종이색 / 캔 라벨색) */
  color: string | null;
  liquidColor: string | null;
  /** 남은 양 0~1 */
  remaining: number;
  /** 캔을 땄나(컵은 늘 true). 쪽지에서는 펼쳐 봤나. */
  opened: boolean;
  /** 마시기/따기 모션 시작 시각(ms) */
  actionStartedAt: number;
  action: DrinkAction | null;
}

export interface HeldDrink {
  kind: HeldDrinkKind | null;
  color: string | null;
  liquidColor: string | null;
  remaining: number;
  opened: boolean;
}

const state: DrinkState = {
  held: false,
  kind: null,
  color: null,
  liquidColor: null,
  remaining: 1,
  opened: false,
  actionStartedAt: 0,
  action: null,
};

const signal = createChangeSignal();

/** 지금 든 음료. 안 들고 있으면 null. */
export function heldDrink(): HeldDrink | null {
  return state.held
    ? {
        kind: state.kind,
        color: state.color,
        liquidColor: state.liquidColor,
        remaining: state.remaining,
        opened: state.opened,
      }
    : null;
}
/** 지금 재생 중인 동작과 시작 시각(모션 그리기용). */
export function drinkAction() {
  return { action: state.action, startedAt: state.actionStartedAt };
}

function hold(kind: HeldDrinkKind, color: string, liquidColor: string | null, opened: boolean) {
  state.held = true;
  state.kind = kind;
  state.color = color;
  state.liquidColor = liquidColor;
  state.remaining = 1;
  state.opened = opened;
  state.action = null;
  state.actionStartedAt = 0;
  signal.notify();
}

/** 커피 종이컵을 집는다. 뚜껑이 없어 처음부터 딴 상태다. */
export function pickUpCup(color: string, liquidColor: string) {
  if (state.held) return false;
  hold("cup", color, liquidColor, true);
  return true;
}

/** 음료 캔을 집는다. 처음 E 는 따기다. */
export function pickUpCan(color: string, liquidColor: string) {
  if (state.held) return false;
  hold("can", color, liquidColor, false);
  return true;
}

/** 밸브 힌트 종이를 집는다. 마실 것이 아니라 보는 물건이다. */
export function pickUpPaper() {
  if (state.held) return false;
  hold("paper", "#f3efe2", null, false);
  return true;
}

function startAction(action: DrinkAction) {
  state.action = action;
  state.actionStartedAt = performance.now();
}

/** 든 것에 E 를 한 번 누른 결과를 처리한다. */
export function interactWithHeldDrink(): DrinkUseResult | null {
  if (!state.held) return null;
  if (state.kind === "paper") {
    if (!state.opened) {
      state.opened = true;
      startAction("view");
      signal.notify();
      return "view";
    }
    discardDrink();
    return "discard";
  }
  if (state.kind === "can" && !state.opened) {
    state.opened = true;
    startAction("open");
    signal.notify();
    return "open";
  }
  if (state.remaining > 0.001) {
    state.remaining = Math.max(0, state.remaining - SIP_AMOUNT);
    startAction("sip");
    if (state.kind === "can" || state.kind === "cup") playSound("canDrink", { volume: 0.9 });
    signal.notify();
    return "sip";
  }
  // 다 비었을 때: 캔은 같은 짧은 소리, 컵은 내려두는 소리.
  const finishedKind = state.kind;
  discardDrink();
  if (finishedKind === "can") playSound("canDrink", { volume: 0.9 });
  else if (finishedKind === "cup") playSound("cupDown", { volume: 0.9 });
  return "discard";
}

/** 버린다 — 손에서 사라진다. */
export function discardDrink() {
  if (!state.held) return false;
  state.held = false;
  state.kind = null;
  state.color = null;
  state.liquidColor = null;
  state.remaining = 1;
  state.opened = false;
  state.action = null;
  state.actionStartedAt = 0;
  signal.notify();
  return true;
}

/** 개발·테스트용 초기화 */
function resetDrink() {
  discardDrink();
}

export const useDrink = () => useSyncExternalStore(signal.subscribe, signal.version);

exposeDevHook("drink", {
  state,
  pickUpCup,
  pickUpCan,
  interactWithHeldDrink,
  discardDrink,
  resetDrink,
});
