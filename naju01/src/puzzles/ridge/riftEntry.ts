/**
 * 틈에 들어선 순간 — 화면이 그을리고 뒤틀리며 느려지다 캄캄해진 뒤 다음 자리(바위 위)에서 걷힌다.
 * GateRift 가 시작하고 매 프레임 시간을 올리며 건너가는 때를 정하고, RiftEntryHud 가 화면을 그린다. 시각은 초.
 * 벽시계가 아니라 프레임 시간을 쌓는다 — 건너간 자리를 처음 그리느라 멈춰도 걷히는 연출이 통째로 지나가지 않게.
 */
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";

/** 뒤틀리며 빨려 드는 시간 · 캄캄한 시간 · 새 자리에서 걷히는 시간 */
export const RIFT_ENTRY = { warpIn: 2.6, dark: 0.5, warpOut: 1.7 };
export const RIFT_ENTRY_TOTAL = RIFT_ENTRY.warpIn + RIFT_ENTRY.dark + RIFT_ENTRY.warpOut;

const signal = createChangeSignal();
/** 시작한 뒤 쌓인 프레임 시간(초). 안 돌면 −1 */
let elapsed = -1;

/** 시작한다 — 이미 돌고 있으면 false */
export function startRiftEntry() {
  if (elapsed >= 0) return false;
  elapsed = 0;
  signal.notify();
  return true;
}

export function finishRiftEntry() {
  if (elapsed < 0) return;
  elapsed = -1;
  signal.notify();
}

/** 매 프레임 — 멈췄다 돌아온 프레임은 1/30 초로만 친다 */
export function tickRiftEntry(dt: number) {
  if (elapsed >= 0) elapsed += Math.min(dt, 1 / 30);
}

/** 시작한 지 몇 초 — 안 돌면 −1 */
export const riftEntrySince = () => elapsed;

export const useRiftEntryStarted = () => useSyncExternalStore(signal.subscribe, () => elapsed >= 0);

/** 그 순간의 화면 — 뒤틀림(0~1) · 어둠(0~1). 빨려 들 때는 점점 세게, 건너간 뒤에는 남은 뒤틀림이 풀린다 */
export function riftEntryLook(since: number) {
  const { warpIn, dark, warpOut } = RIFT_ENTRY;
  if (since < warpIn) {
    const t = since / warpIn;
    return { warp: t * t * (3 - 2 * t), dark: Math.max(0, (t - 0.72) / 0.28) ** 2 };
  }
  if (since < warpIn + dark) return { warp: 1, dark: 1 };
  const t = Math.min(1, (since - warpIn - dark) / warpOut);
  const ease = 1 - t * t * (3 - 2 * t);
  return { warp: 0.65 * ease, dark: ease };
}
