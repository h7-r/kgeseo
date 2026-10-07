import { useEffect, useRef } from "react";

import { endLockControl, turnLockDigit, useLockControl } from "@/props/combinationLock";

import type { PointerLockRef } from "./controls";

// 나가는 동안 자물쇠가 사라지면(Leva 로 껐다든지) 아무도 endLockControl() 을 안 불러 이동이 영영 멈춘다.
const LEAVE_TIMEOUT_MS = 1500;

/**
 * [E] 로 자물쇠를 만지는 동안의 마우스 처리. 잠겨 있으면 고개가 같이 돌아 자물쇠가 화면 밖으로 나가므로 잠금을 푼다.
 * 다이얼은 휠로도 돌린다 — 실물 자물쇠를 엄지로 굴리는 몸짓이다.
 */
export function useLockControlMode(controlsRef: PointerLockRef) {
  const lockControl = useLockControl();
  const wasPointerLocked = useRef(false);

  useEffect(() => {
    if (!lockControl) return;
    if (lockControl.phase === "active") {
      wasPointerLocked.current = !!document.pointerLockElement;
      controlsRef.current?.unlock();
      return;
    }
    // 카메라가 돌아오면 자물쇠 쪽이 endLockControl() 을 부른다. 이건 뒤늦은 안전망이다.
    const timer = setTimeout(() => endLockControl(), LEAVE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [lockControl, controlsRef]);

  // 완전히 끝난 뒤에 다시 잠근다. 카메라가 되돌아오는 중에 잠그면 화면이 떤다.
  const isControlling = !!lockControl;
  useEffect(() => {
    if (isControlling || !wasPointerLocked.current) return;
    wasPointerLocked.current = false;
    controlsRef.current?.lock();
  }, [isControlling, controlsRef]);

  useEffect(() => {
    if (!lockControl || lockControl.phase !== "active") return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      turnLockDigit(lockControl.id, event.deltaY < 0 ? 1 : -1);
    };
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [lockControl]);

  return lockControl;
}
