/**
 * 터치 모드 — 화면에 스틱·버튼을 띄우고, 마우스 잠금 대신 가상 잠금을 쓰는 상태.
 *
 * 켜지는 때(하나라도):
 *   · 주 입력이 손가락이다(`pointer: coarse`) — 휴대폰·태블릿
 *   · 브라우저에 마우스 잠금이 아예 없다 — 아이폰·아이패드 Safari(마우스를 붙여도 잠글 수 없다)
 *   · 손가락으로 화면을 한 번이라도 눌렀다 — 터치 노트북
 *   · 주소에 ?touch=1 — PC 에서 터치 화면을 시험할 때
 * 꺼지는 때: 진짜 마우스 잠금이 잡혔다(PC 처럼 쓰는 사람). ?touch=0 이면 늘 꺼짐.
 *
 * 아이패드에 키보드를 붙여도 켜 둔다 — 키는 받지만 마우스 잠금은 안 되므로 시점은 손가락으로 돌려야 한다.
 */
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";

const QUERY = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
const FORCED = QUERY.get("touch");

const signal = createChangeSignal();

function initialTouchMode(): boolean {
  if (FORCED === "1") return true;
  if (FORCED === "0" || typeof window === "undefined") return false;
  const isCoarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const canLockPointer = typeof Element !== "undefined" && "requestPointerLock" in Element.prototype;
  return isCoarse || !canLockPointer;
}

let touchMode = initialTouchMode();

function setTouchMode(next: boolean) {
  if (FORCED !== null || touchMode === next) return;
  touchMode = next;
  signal.notify();
}

if (typeof window !== "undefined" && FORCED === null) {
  // 캡처 단계 — 게임 쪽 처리보다 먼저 모드를 바꿔야 그 손가락부터 터치로 다룬다
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "touch") return;
      // 마우스로 잡아 둔 진짜 잠금이 남아 있으면 먼저 놓는다 — 손가락 조작과 섞이지 않게
      if (document.pointerLockElement) document.exitPointerLock();
      setTouchMode(true);
    },
    { capture: true, passive: true },
  );
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement) setTouchMode(false);
  });
}

export function isTouchMode(): boolean {
  return touchMode;
}

export function useTouchMode(): boolean {
  useSyncExternalStore(signal.subscribe, signal.version, () => 0);
  return touchMode;
}

export const subscribeTouchMode = signal.subscribe;
