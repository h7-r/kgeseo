import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { PointerLockControls } from "three-stdlib";

import { overlayLayer, useOpenLayer, type OverlayLayerName } from "@/game/overlayLayer";
import { endLockControl, turnLockDigit, useLockControl } from "@/props/combinationLockState";

/** 마우스 잠금(1인칭 시점) 조작기. 창·자물쇠가 잠금을 풀고 되돌릴 때 쓴다. */
export type PointerLockRef = RefObject<PointerLockControls | null>;

// 나가는 동안 자물쇠가 사라지면(Leva 로 껐다든지) 아무도 endLockControl() 을 안 불러 이동이 영영 멈춘다.
const LOCK_LEAVE_TIMEOUT_MS = 1500;

/**
 * 화면 창(소지품·힌트·설정). 창을 열면 커서가 있어야 칸을 고르므로 마우스 잠금을 푼다.
 * 닫을 때는 열기 직전 상태로만 되돌린다 — 무조건 잠그면 T 를 누른 적 없는 사람이 소지품만 봤다가 1인칭에 갇힌다.
 */
export function useOverlayWindows(controlsRef: PointerLockRef) {
  const openLayer = useOpenLayer();
  const wasPointerLocked = useRef(false);

  const openWindow = useCallback(
    (layer: OverlayLayerName) => {
      wasPointerLocked.current = !!document.pointerLockElement;
      overlayLayer.open(layer);
      controlsRef.current?.unlock();
    },
    [controlsRef],
  );

  const closeWindow = useCallback(() => {
    overlayLayer.close();
    if (wasPointerLocked.current) controlsRef.current?.lock();
  }, [controlsRef]);

  return { openLayer, openWindow, closeWindow };
}

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
    const timer = setTimeout(() => endLockControl(), LOCK_LEAVE_TIMEOUT_MS);
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
