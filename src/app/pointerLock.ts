import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { PointerLockControls } from "three-stdlib";

import { addPointerActiveListener, isPointerActive, isTouchMode } from "@/engine/input";
import { overlayLayer, useOpenLayer, type OverlayLayerName } from "@/game/overlayLayer";
import { endLockControl, leaveLockControl, turnLockDigit, useLockControl } from "@/props/combinationLockState";

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
  /** PC — 창을 닫으며 다시 잠그려 했는데 브라우저가 거절했을 수 있다. 다음 클릭 한 번이 잠근다(아래 effect) */
  const isRelockPending = useRef(false);

  const openWindow = useCallback(
    (layer: OverlayLayerName) => {
      // 터치 모드의 가상 잠금도 「조작 중」으로 친다 — 닫을 때 같은 조작으로 돌아간다
      wasPointerLocked.current = isPointerActive();
      isRelockPending.current = false;
      overlayLayer.open(layer);
      controlsRef.current?.unlock();
    },
    [controlsRef],
  );

  // 닫는 클릭 · I · P · H 키 안에서 바로 다시 잠근다(브라우저가 사용자 동작 안의 요청만 받는다).
  // Esc 로 닫으면 브라우저는 다시 잠그지 않는다 — 그때는 화면을 한 번 누르면 잠긴다(11/8 해랑 검토 · 첫 물건 자동 열림)
  const closeWindow = useCallback(() => {
    overlayLayer.close();
    if (!wasPointerLocked.current) return;
    controlsRef.current?.lock();
    if (!isTouchMode()) isRelockPending.current = true;
  }, [controlsRef]);

  // PC 다시 잠그기 안전망 — 잠금이 잡히면 끝. 아니면 게임 화면(3D 캔버스)을 처음 누르는 클릭이 잠근다
  useEffect(() => {
    const handleLockChange = () => {
      if (document.pointerLockElement) isRelockPending.current = false;
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (!isRelockPending.current || event.button !== 0 || isTouchMode() || document.pointerLockElement) return;
      if (overlayLayer.get() !== null) return;
      // 게임 화면(3D 캔버스)을 누른 클릭만 — 긴급 호출 카드(alertdialog) · 창 · 단추 · 입력칸 클릭은 건드리지 않는다(코덱스 18회차)
      const target = event.target as Element | null;
      if (!(target instanceof HTMLCanvasElement)) return;
      isRelockPending.current = false;
      controlsRef.current?.lock();
    };
    document.addEventListener("pointerlockchange", handleLockChange);
    window.addEventListener("mousedown", handleMouseDown, true);
    return () => {
      document.removeEventListener("pointerlockchange", handleLockChange);
      window.removeEventListener("mousedown", handleMouseDown, true);
    };
  }, [controlsRef]);

  // 다른 길(개발 훅 · 시험 도구 등)로 창이 열려도 조작 잠금을 풀어 둔다 — 터치 단추가 창 위에 남지 않게(14회차).
  // openWindow 로 열었으면 이미 풀려 있어 아무 일도 하지 않는다
  useEffect(() => {
    if (openLayer === null || !isPointerActive()) return;
    wasPointerLocked.current = true;
    controlsRef.current?.unlock();
  }, [openLayer, controlsRef]);

  return { openLayer, openWindow, closeWindow };
}

/**
 * [E] 로 자물쇠를 만지는 동안의 마우스 처리. 마우스 잠금은 풀지 않는다 — 풀면 커서가 튀어나오고,
 * 브라우저가 다시 잠그는 것을 거절할 수 있다. 고개가 돌지 않게 하는 일은 App 이 시점 속도를 0 으로 해서 맡는다.
 * 다이얼은 휠로도 돌린다 — 실물 자물쇠를 엄지로 굴리는 몸짓이다.
 */
export function useLockControlMode() {
  const lockControl = useLockControl();

  useEffect(() => {
    if (!lockControl) return;
    if (lockControl.phase === "active") {
      // 잠금 중 ESC 는 브라우저가 먼저 가져가 키 입력이 오지 않는다. 잠금이 풀리면 자물쇠에서도 나간다.
      const handleLockChange = () => {
        if (!isPointerActive()) leaveLockControl();
      };
      return addPointerActiveListener(handleLockChange);
    }
    // 카메라가 돌아오면 자물쇠 쪽이 endLockControl() 을 부른다. 이건 뒤늦은 안전망이다.
    const timer = setTimeout(() => endLockControl(), LOCK_LEAVE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [lockControl]);

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
