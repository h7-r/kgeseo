/**
 * 동행 한 줄 입력이 열려 있는가 — 터치 모드의 「창 열림」 판정(MobileGate · 전부 멈춤)에 넣으려고 밖으로 꺼낸다.
 * 열려 있는 동안은 잠금이 풀려 게임이 멈추고, 「멈춤」 덮개 대신 입력칸이 보여야 한다.
 */
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";

let isOpen = false;
const signal = createChangeSignal();

export function setCompanionChatOpen(next: boolean) {
  if (isOpen === next) return;
  isOpen = next;
  signal.notify();
}

export const isCompanionChatOpen = () => isOpen;

export const useCompanionChatOpen = () => useSyncExternalStore(signal.subscribe, () => isOpen);
