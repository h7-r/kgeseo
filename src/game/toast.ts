// 짧은 안내 한 줄(토스트) — 「3인칭은 로비에서만」 · 「자판기에 전원이 없다」 · 「아무 일도 일어나지 않았다」 같은, 눌러 본 결과를
// 몇 초 알려 주는 글(미르 플레이 시험 메모 11/8, 튜토피드백 검토 01회차). 한 번에 하나만 띄우고, 같은 글을 다시 부르면 쌓지 않고
// 시간만 늘린다. 시간은 게임 시계(gameSetTimeout)로 재서 모바일 멈춤 중에는 줄지 않는다.
// 힌트가 새로 들어왔다 · 밸브로 돌아가자처럼 꼭 봐야 하는 글은 크게(emphasis "hint") — 미르 11/10 「텍스트박스랑 글자가 너무 작다」.
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { gameClearTimeout, gameSetTimeout } from "@/engine/input/gameClock";
import { createChangeSignal } from "@/lib/changeSignal";

const DEFAULT_MS = 3500;

/** normal = 눌러 본 결과 · hint = 힌트가 들어왔다 · 오래 헤맬 때 길 안내(크게) */
export type ToastEmphasis = "normal" | "hint";

export interface ToastState {
  message: string;
  emphasis: ToastEmphasis;
}

// 화면이 읽는 값 — 바뀔 때만 새 객체를 만든다(useSyncExternalStore 가 같은 값을 받게)
let state: ToastState | null = null;
let timer: number | null = null;
const signal = createChangeSignal();

/** 안내 한 줄을 ms 동안 띄운다(같은 글 · 같은 꼴이 떠 있으면 시간만 늘린다) */
export function showToast(message: string, ms = DEFAULT_MS, options: { emphasis?: ToastEmphasis } = {}) {
  const emphasis = options.emphasis ?? "normal";
  gameClearTimeout(timer);
  timer = gameSetTimeout(() => {
    timer = null;
    state = null;
    signal.notify();
  }, ms);
  if (state?.message === message && state.emphasis === emphasis) return;
  state = { message, emphasis };
  signal.notify();
}

/** 이 글들 가운데 하나가 떠 있으면 거둔다 — 할 일을 했거나(밸브를 돌림) 까닭이 사라졌을 때(관창을 뽑음) 뒤늦게 남지 않게 */
export function clearToast(messages: readonly string[]) {
  if (!state || !messages.includes(state.message)) return;
  gameClearTimeout(timer);
  timer = null;
  state = null;
  signal.notify();
}

/** 지금 무슨 글이든 떠 있다 — 나중에 띄워도 되는 안내는 이때 미룬다 */
export const isToastShowing = () => state !== null;

export const useToast = () => useSyncExternalStore(signal.subscribe, () => state);

exposeDevHook("toast", {
  show: showToast,
  get: () => state?.message ?? null,
  emphasis: () => state?.emphasis ?? null,
});
