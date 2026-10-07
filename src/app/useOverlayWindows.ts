import { useCallback, useRef } from "react";

import { overlayLayer, useOpenLayer, type Layer } from "@/game/overlayLayer";

import type { PointerLockRef } from "./controls";

/**
 * 화면 창(소지품·힌트·설정). 창을 열면 커서가 있어야 칸을 고르므로 마우스 잠금을 푼다.
 * 닫을 때는 열기 직전 상태로만 되돌린다 — 무조건 잠그면 T 를 누른 적 없는 사람이 소지품만 봤다가 1인칭에 갇힌다.
 */
export function useOverlayWindows(controlsRef: PointerLockRef) {
  const openLayer = useOpenLayer();
  const wasPointerLocked = useRef(false);

  const openWindow = useCallback(
    (layer: Layer) => {
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
