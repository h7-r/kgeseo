/** 힌트함 창 열림 상태 — App 의 [H] 가 켜고 끄고, HintBoxHud 가 본다 */
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";

const signal = createChangeSignal();
let isOpen = false;
export const isHintBoxOpen = () => isOpen;
export function setHintBoxOpen(next: boolean) {
  if (isOpen === next) return;
  isOpen = next;
  signal.notify();
}
export const useHintBoxOpen = () => useSyncExternalStore(signal.subscribe, () => isOpen);
