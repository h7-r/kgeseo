/**
 * 가로 화면 · 첫 탭 · 전체 화면 — 터치 모드에서 본편 · 나주가 같이 쓴다(11/7 미르 · 코덱스 13회차).
 *
 * 세로 판정: 화면 방향(screen.orientation.type)을 먼저 본다. 창 비율은 키보드가 뜨면 줄어 오판할 수 있다.
 * 방향 값이 없는 브라우저만 창 비율(orientation 미디어 쿼리)로 보고, 입력칸에 쓰는 동안은 마지막 판정을 유지한다.
 *
 * 첫 탭: 문서마다 한 번. 그 탭(click) 안에서 영상 · 음악을 소리와 함께 틀고, 전체 화면 · 가로 고정을 건다.
 *   · 전체 화면 · 가로 고정은 되는 기기만(안드로이드 Chrome · 아이패드 전체 화면). 아이폰 Safari 는 페이지 전체 화면과
 *     가로 고정을 지원하지 않는다 — 회전 안내 덮개(LandscapeGuard)로 가로를 지킨다.
 *   · 문서를 옮기면(웹 → 게임, 본편 → 나주) 전체 화면이 풀린다. 새 문서에서 다시 첫 탭을 받는다.
 *   · 첫 탭은 게임 시작(markGameStarted)과 다르다 — 시작 전에는 장면을 계속 그려야 준비 판정이 돈다.
 *   · 첫 탭 뒤에 전체 화면이 풀리거나(뒤로 · 알림) 다른 앱으로 나가면 첫 탭을 다시 받는다 — 오프닝 · 로딩 영상이 멈추고
 *     「화면을 눌러 계속」. 게임 씬에서는 MobileGate 의 「멈춤 · 눌러서 계속」이 같은 탭을 부른다(코덱스 13b회차).
 *
 * 잡아 둠(held): 터치 모드에서 세로이거나 첫 탭 전이면 로딩 영상 · 오프닝 · 로딩 음악을 멈춰 둔다
 * (첫 1회 오프닝을 세로 덮개 뒤로 흘려보내지 않게). 내려받기 · 장면 준비는 계속한다.
 */
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";

import { resumeAllAudio } from "./gamePause";
import { isTouchMode, subscribeTouchMode } from "./touchMode";

const signal = createChangeSignal();

function isTyping(): boolean {
  const element = document.activeElement;
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

function readPortrait(previous: boolean): boolean {
  if (typeof window === "undefined") return false;
  const type = typeof screen !== "undefined" ? screen.orientation?.type : undefined;
  if (type) return type.startsWith("portrait");
  if (isTyping()) return previous;
  return window.matchMedia?.("(orientation: portrait)").matches ?? window.innerHeight > window.innerWidth;
}

let portrait = readPortrait(false);
let hasFirstTap = false;
/** 첫 탭 뒤 끊긴 적이 있다(전체 화면 풀림 · 숨김) — 다시 받는 탭은 「입장」이 아니라 「계속」 */
let wasInterrupted = false;

function interrupt() {
  if (!isTouchMode() || !hasFirstTap) return;
  hasFirstTap = false;
  wasInterrupted = true;
  signal.notify();
}

function refresh() {
  const next = readPortrait(portrait);
  if (next === portrait) return;
  portrait = next;
  signal.notify();
}

if (typeof window !== "undefined") {
  screen.orientation?.addEventListener?.("change", refresh);
  window.addEventListener("orientationchange", refresh);
  window.addEventListener("resize", refresh);
  // 방향 값이 없는 브라우저 — 키보드가 내려간 뒤 다시 본다
  document.addEventListener("focusout", () => window.setTimeout(refresh, 300));
  subscribeTouchMode(() => signal.notify());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") interrupt();
  });
  addFullscreenExitListener(interrupt);
}

// ── 전체 화면 ──

type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };

function lockLandscape() {
  try {
    void (screen.orientation as LockableOrientation | undefined)?.lock?.("landscape")?.catch(() => {});
  } catch {
    // 고정을 모르는 브라우저
  }
}

/** 이 브라우저가 페이지 전체 화면을 켤 수 있다(아이폰 Safari 는 아니다) */
export function canRequestFullscreen(): boolean {
  return (
    typeof document !== "undefined" &&
    !!document.fullscreenEnabled &&
    typeof document.documentElement.requestFullscreen === "function"
  );
}

/** 전체 화면 → 가로 고정. 이미 전체 화면이면 고정만 다시 건다. 사용자 몸짓(click) 안에서 부른다. 실패해도 그냥 진행한다. */
export function enterFullscreenLandscape() {
  if (typeof document === "undefined") return;
  if (document.fullscreenElement) {
    lockLandscape();
    return;
  }
  if (!canRequestFullscreen()) return;
  document.documentElement.requestFullscreen({ navigationUI: "hide" }).then(lockLandscape, () => {});
}

/** 전체 화면이 풀리는 순간(뒤로 · 알림 · 사용자가 내림) */
export function addFullscreenExitListener(listener: () => void): () => void {
  let wasFullscreen = !!document.fullscreenElement;
  const handleChange = () => {
    const isFullscreen = !!document.fullscreenElement;
    if (wasFullscreen && !isFullscreen) listener();
    wasFullscreen = isFullscreen;
  };
  document.addEventListener("fullscreenchange", handleChange);
  return () => document.removeEventListener("fullscreenchange", handleChange);
}

// ── 첫 탭 ──

/**
 * 첫 탭 · 계속 탭의 click 핸들러 안에서 부른다.
 * 잡아 둔 영상 · 음악은 구독자가 이 호출 안에서 바로 튼다(iOS 는 몸짓 안의 play() 만 소리를 허락한다).
 * 소리를 먼저 틀고 전체 화면을 나중에 건다 — 전체 화면 요청이 몸짓을 써 버려도 소리는 이미 났다.
 */
export function passFirstTap() {
  if (!hasFirstTap) {
    hasFirstTap = true;
    signal.notify();
  }
  resumeAllAudio();
  enterFullscreenLandscape();
}

export function hasPassedFirstTap(): boolean {
  return hasFirstTap;
}

export function isPortraitNow(): boolean {
  return portrait;
}

/** 로딩 영상 · 오프닝 · 로딩 음악을 멈춰 둔다 — 터치 모드에서 세로이거나 첫 탭 전 */
export function isMediaHeld(): boolean {
  return isTouchMode() && (portrait || !hasFirstTap);
}

/** 방향 · 첫 탭 · 터치 모드가 바뀌면 부른다(같은 호출 스택 안에서 — 첫 탭의 몸짓이 이어진다) */
export const subscribeLandscape = signal.subscribe;

interface LandscapeSnapshot {
  isTouch: boolean;
  isPortrait: boolean;
  /** 터치 모드인데 세로 — 회전 안내로 덮는다 */
  isBlocked: boolean;
  hasFirstTap: boolean;
  /** 첫 탭 뒤 끊겨서 다시 받는 중 */
  wasInterrupted: boolean;
  isMediaHeld: boolean;
}

export function useLandscapeState(): LandscapeSnapshot {
  useSyncExternalStore(signal.subscribe, signal.version, () => 0);
  const isTouch = isTouchMode();
  return {
    isTouch,
    isPortrait: portrait,
    isBlocked: isTouch && portrait,
    hasFirstTap,
    wasInterrupted,
    isMediaHeld: isMediaHeld(),
  };
}
