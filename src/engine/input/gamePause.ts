/**
 * 터치 모드의 「전부 멈춤」(11/7 미르 결정 5) — 3D 렌더 루프 · 소리 · 영상 · 시간으로 재는 판정을 세운다.
 *
 * 멈추는 까닭은 두 가지이고 서로 따로 둔다(코덱스 01회차):
 *   · 멈춤 표시(paused) — 세로로 돌림 · 다른 앱으로 나감 · 멈춤 단추. **「눌러서 계속」 탭으로만** 풀린다.
 *     창 닫기 콜백이 lock() 을 불러도 풀리지 않는다. 그 탭이 소리를 다시 깨우는 사용자 몸짓이기도 하다.
 *   · 조작 중이 아님(가상 잠금이 풀림) — 창(소지품 · 설정 · 입력칸)이 열림. 창을 닫으면 잠금이 돌아와 저절로 풀린다.
 * 둘 중 하나라도 있으면 얼린다(frozen). 시작 전(첫 탭 전)은 얼리지 않는다 — 장면은 뒤에서 그려 두고 입력만 막는다
 * (나주는 첫 프레임이 그려져야 덮개를 걷으므로, 시작 전에 루프를 세우면 서로 기다린다).
 * PC(터치 모드가 아님)는 지금과 똑같다.
 */
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

import { cancelAllTouchInput } from "./touchInput";
import { isTouchMode, subscribeTouchMode } from "./touchMode";
import { addPointerActiveListener, isVirtuallyLocked } from "./virtualLock";

const signal = createChangeSignal();

let hasStarted = false;
let isPausedFlag = false;
let isFrozen = false;
let frozenAt = 0;

function computeFrozen(): boolean {
  return isTouchMode() && hasStarted && (isPausedFlag || !isVirtuallyLocked());
}

// ── 얼릴 때 · 풀 때 부를 것 ──

const freezeHooks = new Set<() => void>();
const thawHooks = new Set<(frozenMs: number) => void>();

/** 얼리는 순간(길게 누르기 취소 등) */
export function onGameFreeze(hook: () => void): () => void {
  freezeHooks.add(hook);
  return () => freezeHooks.delete(hook);
}

/** 풀리는 순간 — 얼어 있던 시간(ms)을 받는다(시간으로 재는 판정을 그만큼 미룬다) */
export function onGameThaw(hook: (frozenMs: number) => void): () => void {
  thawHooks.add(hook);
  return () => thawHooks.delete(hook);
}

// ── 소리 · 영상 ──

const audioContexts = new Set<AudioContext>();
const detachedMedia = new Set<HTMLMediaElement>();
const suspendedContexts = new Set<AudioContext>();
const pausedMedia = new Set<HTMLMediaElement>();

/** AudioContext 를 만든 곳이 등록한다 — 얼면 suspend, 풀리면 resume */
export function trackAudioContext(context: AudioContext) {
  audioContexts.add(context);
  if (isFrozen && context.state === "running") {
    suspendedContexts.add(context);
    void context.suspend().catch(() => {});
  }
}

/** 문서에 붙지 않은 new Audio() 를 등록한다(문서 안의 video · audio 는 알아서 찾는다) */
export function trackMedia(media: HTMLMediaElement): () => void {
  detachedMedia.add(media);
  return () => detachedMedia.delete(media);
}

/** 얼어 있는 동안은 소리를 깨우지 않는다 — 효과음 · 환경음 쪽이 resume() 전에 묻는다 */
export function isGameFrozen(): boolean {
  return isFrozen;
}

/**
 * 시작 탭 · 계속 탭에서 부른다 — iOS 는 사용자 몸짓 안에서만 소리를 깨운다.
 * 상태를 다 바꾼 뒤에 부르고, 그래도 얼어 있으면(창이 열린 채 멈췄다 돌아옴) 깨우지 않는다 — 창을 닫는 탭에서 풀린다.
 */
export function resumeAllAudio() {
  if (isFrozen) return;
  for (const context of audioContexts) {
    if (context.state !== "running") void context.resume().catch(() => {});
  }
}

function suspendMedia() {
  for (const context of audioContexts) {
    if (context.state === "running") {
      suspendedContexts.add(context);
      void context.suspend().catch(() => {});
    }
  }
  const media = [...document.querySelectorAll<HTMLMediaElement>("video, audio"), ...detachedMedia];
  for (const element of media) {
    if (!element.paused && !element.ended) {
      pausedMedia.add(element);
      element.pause();
    }
  }
}

function resumeMedia() {
  for (const context of suspendedContexts) void context.resume().catch(() => {});
  suspendedContexts.clear();
  for (const element of pausedMedia) void element.play().catch(() => {});
  pausedMedia.clear();
}

// ── 상태 ──

function update() {
  const next = computeFrozen();
  if (next !== isFrozen) {
    isFrozen = next;
    if (next) {
      frozenAt = performance.now();
      cancelAllTouchInput();
      for (const hook of freezeHooks) hook();
      suspendMedia();
      document.documentElement.classList.add("game-frozen");
    } else {
      const frozenMs = performance.now() - frozenAt;
      for (const hook of thawHooks) hook(frozenMs);
      resumeMedia();
      document.documentElement.classList.remove("game-frozen");
    }
  }
  // CSS 애니메이션은 「멈춤」(눌러서 계속) 동안만 세운다(index.css 의 html.game-paused).
  // 창 때문에 얼었을 때까지 세우면 막 뜬 창의 등장 애니메이션이 첫 장면(투명)에 멈춰 창이 안 보인다(11/9 기차 목적지 창).
  // 얼어 있는 채로 멈춤만 풀릴 수 있어(창을 연 채 멈췄다 돌아옴) 바뀔 때마다 맞춘다.
  document.documentElement.classList.toggle("game-paused", isFrozen && isPausedFlag);
  signal.notify();
}

/** 시작 게이트를 지났다(첫 탭) */
export function markGameStarted() {
  if (hasStarted) return;
  hasStarted = true;
  update();
}

/** 멈춤 — 세로 회전 · 숨김 · 멈춤 단추 */
export function pauseGame() {
  if (!isTouchMode() || !hasStarted || isPausedFlag) return;
  isPausedFlag = true;
  update();
}

/** 「눌러서 계속」 탭에서만 부른다 */
export function resumeFromGate() {
  if (!isPausedFlag) return;
  isPausedFlag = false;
  update();
}

export function isGamePausedFlag(): boolean {
  return isPausedFlag;
}

interface PauseSnapshot {
  hasStarted: boolean;
  isPaused: boolean;
  isFrozen: boolean;
}

/** 화면이 읽는 상태 — 바뀔 때마다 다시 그린다 */
export function useGamePauseState(): PauseSnapshot {
  useSyncExternalStore(signal.subscribe, signal.version, () => 0);
  return { hasStarted, isPaused: isPausedFlag, isFrozen };
}

export function useGameFrozen(): boolean {
  useSyncExternalStore(signal.subscribe, signal.version, () => 0);
  return isFrozen;
}

// 시험 · 원인 격리용 — window.__game.gamePause 로 지금 상태를 읽는다
exposeDevHook("gamePause", {
  get state() {
    return { touchMode: isTouchMode(), hasStarted, isPausedFlag, isFrozen, isVirtuallyLocked: isVirtuallyLocked() };
  },
});

if (typeof document !== "undefined") {
  addPointerActiveListener(update);
  subscribeTouchMode(update);
  // 시작 전에도 창을 벗어나면 누르던 손가락은 버린다
  window.addEventListener("blur", cancelAllTouchInput);
  // 게임 소리의 표준 범주 — 무음 스위치를 따르고 다른 앱 소리와 섞인다(iOS 17+, 결정 4 · 코덱스 01회차).
  // 첫 재생 전에 정해야 해서 모듈을 읽을 때 건다. 없는 브라우저는 그냥 지나간다.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) {
    try {
      session.type = "ambient";
    } catch {
      // 모르는 값이면 기본 그대로
    }
  }
}
