/**
 * 터치 모드 — 화면에 스틱·버튼을 띄우고, 마우스 잠금 대신 가상 잠금을 쓰는 상태.
 *
 * 켜지는 때(하나라도):
 *   · 주 입력이 손가락이다(`pointer: coarse`) — 휴대폰·태블릿
 *   · 브라우저에 마우스 잠금이 아예 없다 — 아이폰·아이패드 Safari(마우스를 붙여도 잠글 수 없다)
 *   · 손가락으로 화면을 눌렀다 — 터치 노트북(마지막으로 쓴 입력을 따른다)
 *   · 주소에 ?touch=1 — PC 에서 터치 화면을 시험할 때
 * 꺼지는 때(하나라도): 진짜 마우스 잠금이 잡혔다 · 주 입력이 마우스인 기기에서 마우스로 눌렀다(터치 노트북이 마우스로 돌아옴).
 * ?touch=0 이면 늘 꺼짐.
 *
 * 아이패드에 키보드를 붙여도 켜 둔다 — 키는 받지만 마우스 잠금은 안 되므로 시점은 손가락으로 돌려야 한다.
 */
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";

const QUERY = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
const FORCED = QUERY.get("touch");

const signal = createChangeSignal();

const canLockPointer = () => typeof Element !== "undefined" && "requestPointerLock" in Element.prototype;
const isPrimaryCoarse = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false);

function initialTouchMode(): boolean {
  if (FORCED === "1") return true;
  if (FORCED === "0" || typeof window === "undefined") return false;
  return isPrimaryCoarse() || !canLockPointer();
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
  // 마우스로 눌렀다 — 터치 노트북이 마우스로 돌아왔다. 전에는 진짜 잠금이 잡혀야만 꺼졌는데, 터치 모드의 lock() 은 가상 잠금이라
  // 진짜 잠금을 요청하지 않아 새로고침 전까지 못 빠져나왔다(11/8 해랑 검토). 이 pointerdown 에 이어지는 click 이 진짜 잠금을 건다.
  // 주 입력이 손가락인 기기(휴대폰 · 아이패드에 마우스를 붙임)와 잠금이 없는 브라우저는 그대로 둔다 — 마우스로는 시점을 못 돌린다.
  // 손가락이 만드는 호환 마우스 이벤트는 pointerType 이 "touch" 라 여기 오지 않는다
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "mouse" || !touchMode || isPrimaryCoarse() || !canLockPointer()) return;
      setTouchMode(false);
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
