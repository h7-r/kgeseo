/**
 * 객차 안내판을 겨눴는지. 판은 Canvas 안, 키보드·클릭과 화면 안내문은 Canvas 밖이라 여기서 만난다.
 * [E] 는 문 앞이면 "내리기"에도 걸려 있어, 게임 키보드가 내리기보다 먼저 여기에 묻는다.
 */
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";

let isAimed = false;
const aimSignal = createChangeSignal();

export function setHologramAimed(next: boolean) {
  if (isAimed === next) return;
  isAimed = next;
  aimSignal.notify();
}

export const isHologramAimed = () => isAimed;

export const useIsHologramAimed = () => useSyncExternalStore(aimSignal.subscribe, isHologramAimed);
