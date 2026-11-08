// 짧은 안내 한 줄(토스트) — 「3인칭은 로비에서만」 · 「자판기에 전원이 없다」 · 「아무 일도 일어나지 않았다」 같은, 눌러 본 결과를
// 몇 초 알려 주는 글(미르 플레이 시험 메모 11/8, 튜토피드백 검토 01회차). 한 번에 하나만 띄우고, 같은 글을 다시 부르면 쌓지 않고
// 시간만 늘린다. 시간은 게임 시계(gameSetTimeout)로 재서 모바일 멈춤 중에는 줄지 않는다.
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { gameClearTimeout, gameSetTimeout } from "@/engine/input/gameClock";
import { createChangeSignal } from "@/lib/changeSignal";

const DEFAULT_MS = 3500;

let text: string | null = null;
let timer: number | null = null;
const signal = createChangeSignal();

/** 안내 한 줄을 ms 동안 띄운다(같은 글이 떠 있으면 시간만 늘린다) */
export function showToast(message: string, ms = DEFAULT_MS) {
  gameClearTimeout(timer);
  timer = gameSetTimeout(() => {
    timer = null;
    text = null;
    signal.notify();
  }, ms);
  if (text === message) return;
  text = message;
  signal.notify();
}

export const useToast = () => useSyncExternalStore(signal.subscribe, () => text);

exposeDevHook("toast", { show: showToast, get: () => text });
