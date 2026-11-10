/**
 * 터치 모드의 시작 게이트 · 회전 안내 · 멈춤 덮개(본편 · 나주 공용). 터치 모드가 아니면 아무것도 그리지 않는다.
 *
 * 흐름: 「화면을 눌러 시작」 → 조작 → (세로 · 다른 앱 · 전체 화면 풀림 · 멈춤 단추) → 「멈춤 · 눌러서 계속」
 * 세로면 멈추고, 그림은 전역 회전 안내(LandscapeGuard)가 맡는다 — 세로 판정도 같은 곳(landscape.ts)에서 받는다.
 * 탭(click) 핸들러 안에서 소리 깨우기 · 전체 화면 · 가로 고정을 함께 부른다(passFirstTap) — 사용자 몸짓 안에서만 되는 일이라
 * 하나가 끝나길 기다리지 않는다. 전체 화면 · 가로 고정은 되는 기기만(안드로이드 · 아이패드 전체 화면). 실패해도 그냥 진행한다.
 *
 * 멈춤은 이 덮개의 탭으로만 풀린다. 창이 열린 채 멈췄다면 풀린 뒤에도 창은 그대로다(창을 닫아야 조작으로 돌아간다).
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import type { PointerLockControls } from "three-stdlib";

import { markGameStarted, pauseGame, resumeAllAudio, resumeFromGate, useGamePauseState } from "./gamePause";
import { addFullscreenExitListener, isPortraitNow, passFirstTap, useLandscapeState } from "./landscape";
import { cancelAllTouchInput } from "./touchInput";
import { useTouchMode } from "./touchMode";
import { addPointerActiveListener, installVirtualLock, isVirtuallyLocked } from "./virtualLock";

interface MobileGateProps {
  controlsRef: RefObject<PointerLockControls | null>;
  /** 게임 창이 열려 있다(소지품 · 힌트 · 설정 · 입력칸 등) */
  isWindowOpen: boolean;
  /** 멈춤 화면 아래쪽에 덧붙일 것 — 나주의 「로비로 나가기」(미르 11/10). 없으면 「눌러서 계속」만 */
  pausedExtra?: ReactNode;
}

export function MobileGate({ controlsRef, isWindowOpen, pausedExtra }: MobileGateProps) {
  const isTouch = useTouchMode();
  const { hasStarted, isPaused } = useGamePauseState();
  const { isPortrait } = useLandscapeState();
  const [isLocked, setIsLocked] = useState(isVirtuallyLocked);
  const [hasControls, setHasControls] = useState(false);
  /** 덮개가 바뀐 시각 — 막 뜬 덮개에 앞 손가락의 클릭이 떨어지면 무시한다(멈춤 단추를 뗀 손가락 등) */
  const shownAt = useRef(0);

  // 조작기는 씬과 함께 늦게 생기기도 하고(나주), 카메라가 바뀌면 새로 생긴다 — 자주 보고 심는다
  useEffect(() => {
    if (!isTouch) return;
    const check = () => {
      const controls = controlsRef.current;
      installVirtualLock(controls);
      setHasControls(!!controls);
    };
    check();
    const timer = window.setInterval(check, 250);
    return () => window.clearInterval(timer);
  }, [isTouch, controlsRef]);

  useEffect(() => addPointerActiveListener(() => setIsLocked(isVirtuallyLocked())), []);

  // 창을 닫으면 바로 조작으로 — 나주 힌트함 · 설정처럼 닫을 때 잠금을 다시 걸지 않는 창도 있다(본편은 이미 건다, 두 번 걸어도 같다).
  // 창을 연 채 멈췄다면 멈춤이 먼저다 — 「눌러서 계속」으로만 풀린다.
  const wasWindowOpen = useRef(isWindowOpen);
  useEffect(() => {
    const closedNow = wasWindowOpen.current && !isWindowOpen;
    wasWindowOpen.current = isWindowOpen;
    if (!closedNow || !isTouch || !hasStarted || isPaused || isVirtuallyLocked()) return;
    controlsRef.current?.lock();
  }, [isWindowOpen, isTouch, hasStarted, isPaused, controlsRef]);

  // 세로로 돌리면 멈춘다. 돌아오면 「눌러서 계속」
  useEffect(() => {
    if (!isTouch || !isPortrait) return;
    cancelAllTouchInput();
    pauseGame();
  }, [isTouch, isPortrait]);

  // 다른 앱으로 나가거나 전체 화면이 풀리면(뒤로 · 알림) 멈춘다 — 「눌러서 계속」 탭이 전체 화면을 다시 건다
  useEffect(() => {
    if (!isTouch) return;
    const pause = () => {
      cancelAllTouchInput();
      pauseGame();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") pause();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    const removeFullscreenExit = addFullscreenExitListener(pause);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      removeFullscreenExit();
    };
  }, [isTouch]);

  const overlay = !isTouch
    ? "none"
    : isPortrait
      ? "rotate"
      : !hasStarted
        ? "start"
        : isPaused || (!isLocked && !isWindowOpen)
          ? "paused"
          : "none";
  useLayoutEffect(() => {
    shownAt.current = performance.now();
  }, [overlay]);

  if (!isTouch) return null;

  const handleTap = () => {
    if (performance.now() - shownAt.current < GHOST_CLICK_MS) return;
    const controls = controlsRef.current;
    if (!controls || isPortraitNow()) return;
    passFirstTap();
    installVirtualLock(controls);
    if (!hasStarted) {
      // 잠금 먼저 — 시작 표시를 먼저 하면 「시작했는데 안 잠김」 순간에 한 번 얼었다 풀린다
      controls.lock();
      markGameStarted();
    } else {
      if (!isWindowOpen) controls.lock();
      resumeFromGate();
    }
    // 상태를 다 정한 뒤 — 창 때문에 아직 얼어 있으면 소리를 깨우지 않는다(같은 탭 안이라 iOS 몸짓 조건은 그대로)
    resumeAllAudio();
  };

  // 세로 — 전역 회전 안내(LandscapeGuard)가 덮는다
  if (isPortrait) return null;
  if (!hasStarted) {
    return (
      <button type="button" style={{ ...coverStyle, ...buttonResetStyle }} onClick={handleTap}>
        <div style={titleStyle}>{hasControls ? "화면을 눌러 시작" : "불러오는 중…"}</div>
        <div style={bodyStyle}>왼손 엄지로 걷고, 오른쪽을 끌어 둘러봅니다.</div>
      </button>
    );
  }
  // 멈춤 — 또는 창도 없는데 조작이 풀린 채로 남았을 때(빠져나갈 길이 없게 두지 않는다)
  if (isPaused || (!isLocked && !isWindowOpen)) {
    return (
      <>
        {/* 아래에 덧붙인 것이 있으면 「멈춤 · 눌러서 계속」을 위로 올려 겹치지 않게 */}
        <button
          type="button"
          style={{ ...coverStyle, ...buttonResetStyle, ...(pausedExtra ? withExtraStyle : null) }}
          onClick={handleTap}
        >
          <div style={titleStyle}>멈춤</div>
          <div style={bodyStyle}>눌러서 계속</div>
        </button>
        {/* 덮개 단추 밖에 따로 둔다 — 덧붙인 단추를 누른 손가락이 「계속」이 되지 않게 */}
        {pausedExtra && <div style={pausedExtraStyle}>{pausedExtra}</div>}
      </>
    );
  }
  return null;
}

/** 덧붙인 것(최대 높이 약 150px)만큼 덮개의 가운데를 위로 */
const withExtraStyle: CSSProperties = { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 160px)" };

/** 멈춤 화면 아래쪽에 덧붙이는 자리 — 덮개(z 1000) 위 */
const pausedExtraStyle: CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  transform: "translateX(-50%)",
  zIndex: 1001,
  display: "flex",
  justifyContent: "center",
  width: "max-content",
  maxWidth: "calc(100vw - 32px)",
};

/** 덮개가 뜬 직후 이만큼은 클릭을 받지 않는다 */
const GHOST_CLICK_MS = 350;

const coverStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
  background: "rgba(8, 10, 14, 0.82)",
  color: "#F2EEE4",
  fontFamily: "sans-serif",
  textAlign: "center",
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
};

const buttonResetStyle: CSSProperties = {
  border: "none",
  width: "100%",
  height: "100%",
  cursor: "pointer",
};

const titleStyle: CSSProperties = { fontSize: 24, fontWeight: 700, letterSpacing: -0.3 };
const bodyStyle: CSSProperties = { fontSize: 15, opacity: 0.75 };
