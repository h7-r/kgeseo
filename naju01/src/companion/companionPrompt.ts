/**
 * 동행에게 쓰는 [E] — 짧게 누르면 말 걸기, 힌트 제안이 있을 때 길게 누르면 그 힌트를 연다.
 * 길게 누르게 한 까닭: 정식 힌트는 처음 열 때 잔액이 줄어든다(실수로 쓰지 않게). 정답(level 2)은 더 길게.
 * [E] 알약 문구와 길게 누르는 진행 상태를 여기 한 곳에서 만든다(CompanionNpc · CompanionHud 가 같이 본다).
 */
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";

import type { DialogState, HintOffer } from "./companionDialog.ts";
import { COMPANION_NAME, companionDialog } from "./companionRuntime.ts";

export const COMPANION_TARGET_ID = "companion-npc";

export const HOLD_MS = { 1: 500, 2: 900 } as const;

export function holdMsFor(offer: HintOffer) {
  return HOLD_MS[offer.level];
}

/** 알약에 띄울 말. 제안이 있으면 길게 눌러 여는 힌트를 함께 적는다 */
export function companionPromptLabel(state: DialogState): string {
  const talk = `${COMPANION_NAME}에게 말 걸기`;
  const { offer } = state;
  if (!offer) return talk;
  const balance = state.hintBalance === null ? "" : ` · 남은 힌트 ${state.hintBalance}`;
  if (companionDialog.isReviewOffer(offer)) return `${talk} · 길게: 힌트 다시 보기`;
  if (offer.level === 1) return `${talk} · 길게: 힌트 1/2 열기${balance}`;
  return `${talk} · 길게: 힌트 2/2 열기(정답)${balance}`;
}

// ── 길게 누르기 ──

interface HoldState {
  startedAt: number;
  durationMs: number;
}

let hold: HoldState | null = null;
let holdTimer = 0;
let releaseListener: ((event: KeyboardEvent) => void) | null = null;
const holdSignal = createChangeSignal();

function endHold() {
  window.clearTimeout(holdTimer);
  if (releaseListener) window.removeEventListener("keyup", releaseListener, true);
  releaseListener = null;
  hold = null;
  holdSignal.notify();
}

/**
 * 동행을 겨눈 채 [E] 를 누른 순간(keydown). 제안이 없으면 바로 말을 건다.
 * 제안이 있으면 떼는 시점으로 가른다 — 짧으면 말 걸기, 끝까지 누르고 있으면 힌트 열기.
 * isStillAimed 가 false 가 되면(시선을 뗌) 열지 않는다.
 */
export function pressCompanion(isStillAimed: () => boolean) {
  const state = companionDialog.getState();
  if (state.waiting || hold) return;
  const { offer } = state;
  if (!offer) {
    void companionDialog.talk();
    return;
  }
  const durationMs = holdMsFor(offer);
  hold = { startedAt: performance.now(), durationMs };
  holdSignal.notify();
  releaseListener = (event: KeyboardEvent) => {
    if (event.code !== "KeyE") return;
    endHold();
    void companionDialog.talk();
  };
  window.addEventListener("keyup", releaseListener, true);
  holdTimer = window.setTimeout(() => {
    endHold();
    if (isStillAimed()) void companionDialog.acceptOffer();
  }, durationMs);
}

/** 창이 열리거나 잠금이 풀리면 누르던 것을 버린다 */
export function cancelCompanionHold() {
  if (hold) endHold();
}

export const useCompanionHold = () => useSyncExternalStore(holdSignal.subscribe, () => hold);
