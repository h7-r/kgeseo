import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { PointerLockControls } from "three-stdlib";

import { isPointerActive, isTouchMode } from "@/engine/input";
import { overlayLayer, useOpenLayer, type OverlayLayerName } from "@/game/overlayLayer";
import { isHintOffering } from "@/game/valveHelp";

import { cancelResume, handOverResume, isResumePending, releasePointerForGame, resumePlay } from "./pointerResume";
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

  const openWindow = useCallback((layer: OverlayLayerName) => {
    // 터치 모드의 가상 잠금도 「조작 중」으로 친다 — 닫을 때 같은 조작으로 돌아간다. 돌아가는 중(ESC 직후)이어도 조작 중이다
    wasPointerLocked.current = isPointerActive() || isResumePending();
    cancelResume();
    overlayLayer.open(layer);
    releasePointerForGame();
  }, []);

  // 닫으면 열기 전 조작으로 돌아간다. ESC 로 닫았으면 크롬이 잠시 잠금을 거절해 그 시간이 지난 뒤 잠근다 —
  // 그동안 화면은 게임이고 키 조작은 된다(pointerResume, 12회차. 예전엔 「화면을 한 번 누르면 잠긴다」 뿐이었다)
  const closeWindow = useCallback(() => {
    overlayLayer.close();
    if (!wasPointerLocked.current) return;
    resumePlay();
  }, []);

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
 * [E] 로 자물쇠를 만지는 동안의 마우스 처리 — ESC 두 단계(미르 11/9, 튜토피드백 12회차. 나주 pointerHold 81b1484 와 같은 원리).
 * 마우스가 잠긴 동안 ESC 는 브라우저가 먼저 가져가 잠금을 푼다(키는 안 온다) — 그래서 예전엔 ESC 한 번에 커서가 게임 밖으로
 * 나와 T 를 다시 눌러야 했다. PC 에서는 자물쇠를 만지기 시작할 때 페이지가 스스로 잠금을 풀어 둔다. 그러면 ESC 가 평범한
 * 키로 들어와 자물쇠만 닫고(useGameKeys) 게임 화면으로 돌아온다. 다시 잠그는 일은 pointerResume 이 한다 — 크롬은 ESC 직후
 * 약 1.25초는 잠금을 거절하므로 그 시간이 지난 뒤에, 그동안 커서는 숨기고 키 조작은 받는다. 거기서 ESC 를 한 번 더 누르면 밖으로.
 * 자물쇠 중에 연 창(H · I · P)은 닫으면 자물쇠로 돌아가고(창은 열 때 잠겨 있지 않았다), 자물쇠에서 나올 때 여기서 다시 잠근다.
 * 고개가 돌지 않게 하는 일은 App 이 시점 속도를 0 으로 해서 맡는다. 터치(가상 잠금)는 풀지 않는다.
 * 다이얼은 휠로도 돌린다 — 실물 자물쇠를 엄지로 굴리는 몸짓이다.
 */
export function useLockControlMode() {
  const lockControl = useLockControl();
  const openLayer = useOpenLayer();
  const phase = lockControl?.phase ?? null;
  /** 자물쇠 때문에 페이지가 스스로 푼 잠금 — 나올 때 다시 잠근다 */
  const isReleasedForLock = useRef(false);

  useEffect(() => {
    if (phase !== "active" || isTouchMode()) return;
    if (document.pointerLockElement) {
      isReleasedForLock.current = true;
      releasePointerForGame();
      return;
    }
    // ESC 직후 게임으로 돌아가길 기다리던 중에 자물쇠를 열었다 — 기다림을 넘겨받아 나올 때 이어 간다(Codex 리뷰 3fd1ae9)
    if (handOverResume()) isReleasedForLock.current = true;
  }, [phase]);

  // 나가기 시작하면(ESC · 정답 뒤 · 자물쇠가 사라짐) 다시 잠근다. 창이 떠 있으면 창이 닫힌 뒤에
  useEffect(() => {
    if (phase === "active" || openLayer !== null || !isReleasedForLock.current) return;
    isReleasedForLock.current = false;
    resumePlay();
  }, [phase, openLayer]);

  useEffect(() => {
    if (phase !== "leaving") return;
    // 카메라가 돌아오면 자물쇠 쪽이 endLockControl() 을 부른다. 이건 뒤늦은 안전망이다.
    const timer = setTimeout(() => endLockControl(), LOCK_LEAVE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (!lockControl || lockControl.phase !== "active") return;
    const handleWheel = (event: WheelEvent) => {
      // 창(힌트함 등)은 휠로 넘겨 읽는다 · 추가 힌트를 묻는 동안은 다이얼을 안 돌린다(12회차 Codex)
      if (overlayLayer.get() !== null || isHintOffering()) return;
      event.preventDefault();
      turnLockDigit(lockControl.id, event.deltaY < 0 ? 1 : -1);
    };
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [lockControl]);

  return lockControl;
}
