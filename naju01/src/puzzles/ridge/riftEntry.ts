/**
 * 틈에 들어선 순간 — 화면이 그을리고 뒤틀리며 느려지다 캄캄해진 뒤 다음 자리에서 걷힌다.
 * 틈(진부촌 문 GateRift · 벼랑 끝 EdgeRift)이 제 이름으로 시작하고 매 프레임 시간을 올리며 건너가는 때를 정하고,
 * RiftEntryHud 가 화면을 그린다. 한 번에 한 틈만 돈다. 시각은 초.
 * 벽시계가 아니라 프레임 시간을 쌓는다 — 건너간 자리를 처음 그리느라 멈춰도 걷히는 연출이 통째로 지나가지 않게.
 */
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";

/** 뒤틀리며 빨려 드는 시간 · 캄캄한 시간 · 새 자리에서 걷히는 시간 */
export const RIFT_ENTRY = { warpIn: 2.6, dark: 0.5, warpOut: 1.7 };
export const RIFT_ENTRY_TOTAL = RIFT_ENTRY.warpIn + RIFT_ENTRY.dark + RIFT_ENTRY.warpOut;

/** 틈의 이름 — 시작한 틈만 시간을 올리고, 제 것일 때만 건너간다 */
export type RiftName = "gate" | "edge";

const signal = createChangeSignal();
/** 지금 도는 틈 · 시작한 뒤 쌓인 프레임 시간(초). 안 돌면 −1 */
let running: RiftName | null = null;
let elapsed = -1;

/** 시작한다 — 이미 돌고 있으면 false */
export function startRiftEntry(rift: RiftName) {
  if (elapsed >= 0) return false;
  running = rift;
  elapsed = 0;
  signal.notify();
  return true;
}

export function finishRiftEntry() {
  if (elapsed < 0) return;
  running = null;
  elapsed = -1;
  signal.notify();
}

/**
 * 매 프레임 — 멈췄다 돌아온 프레임은 1/30 초로만 친다. 다 지나면 여기서도 끝낸다 — 화면 효과(RiftEntryHud)가 못 그려도
 * 「건너가는 중」이 남아 다음 틈을 막지 않게(미르 11/12 「벼랑 틈에 입장이 안 되고 진행이 더 안 된다」)
 */
export function tickRiftEntry(rift: RiftName, dt: number) {
  if (running !== rift || elapsed < 0) return;
  elapsed += Math.min(dt, 1 / 30);
  if (elapsed >= RIFT_ENTRY_TOTAL + 0.5) finishRiftEntry();
}

/** 시작한 지 몇 초 — 안 돌면(이름을 주면 그 틈이 아니어도) −1 */
export const riftEntrySince = (rift?: RiftName) => (rift === undefined || rift === running ? elapsed : -1);

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
