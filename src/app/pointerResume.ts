/**
 * 게임 화면으로 돌아가기(마우스 다시 잠그기) — ESC 두 단계의 뒷일(미르 11/9, 튜토피드백 12회차).
 *
 * 크롬은 ESC 가 눌린 뒤 약 1.25초 안의 잠금 요청을 거절한다 — 잠금이 이미 풀려 있던 때의 ESC 여도 그렇다(미르 화면 기록:
 * 「Pointer lock cannot be acquired immediately after the user has exited the lock」). 그래서 자물쇠 · 창을 ESC 로 닫자마자
 * 다시 잠그면 거절돼 커서가 밖으로 나와 버렸다. 이제는 그 시간이 지난 뒤에 잠근다. 그동안은 커서를 숨기고 키 조작은 그대로
 * 받는다 — 화면은 이미 게임으로 돌아와 있고, 걸으면 걷는다. 페이지가 스스로 푼 잠금이라 몸짓 없이 다시 잠근다.
 * 그래도 거절되면(다른 브라우저) 다음 키 · 클릭(몸짓)에 잠근다 — 그동안 「클릭하거나 아무 키나 누르면 이어서」.
 * 그 사이 ESC 를 한 번 더 누르면 「밖으로」 — 기다림을 거두고 커서를 돌려준다(useGameKeys).
 * 터치(가상 잠금)는 기다릴 일이 없어 바로 잠근다. 나주 pointerHold(81b1484)와 같은 원리를 본편 쪽에 둔 것.
 */
import { useSyncExternalStore } from "react";
import type { PointerLockControls } from "three-stdlib";

import { exposeDevHook } from "@/debug/devHooks";
import { isTouchMode } from "@/engine/input";
import { requestGameLock } from "@/engine/input/lookGuard";
import { isTypingTarget } from "@/game/overlayLayer";
import { createChangeSignal } from "@/lib/changeSignal";

/** ESC 뒤 이만큼 기다렸다 잠근다(크롬 1250ms + 여유) */
const ESC_COOLDOWN_MS = 1300;
/** 잠금을 청한 뒤 이만큼 안에 안 잡히면 거절로 본다 */
const LOCK_CHECK_MS = 600;
/** 기다리는 동안 눌러도 잠그지 않는 키 — 창을 여는 키 · 수식키(창은 커서가 필요하다) */
const NON_RESUME_KEYS = new Set([
  "Escape",
  "KeyI",
  "KeyP",
  "KeyH",
  "Tab",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

export type PointerResumeState = "idle" | "pending" | "waiting";

let getControls: () => PointerLockControls | null = () => null;
/** 마지막으로 ESC 가 눌렸거나 사용자가 잠금을 푼 때 — 그 뒤 ESC_COOLDOWN_MS 동안은 잠그지 않는다 */
let lastEscapeAt = -Infinity;
/** 페이지가 스스로 푸는 중 — 그 풀림은 사용자의 ESC 가 아니다 */
let isUnlockExpected = false;
let state: PointerResumeState = "idle";
let attemptTimer = 0;
let checkTimer = 0;
/** 잠금을 청해 놓고 아직 답이 없다 */
let isRequestInFlight = false;
/** 청해 놓은 잠금을 거뒀다 — 늦게 잡히면 바로 놓는다(브라우저 요청은 되돌릴 수 없다, Codex 리뷰 3fd1ae9) */
let isAcquireCanceled = false;
const signal = createChangeSignal();

/** App 이 잠금 장치를 알려 준다 */
export function bindPointerResume(get: () => PointerLockControls | null) {
  getControls = get;
}

const isLocked = () => typeof document !== "undefined" && !!document.pointerLockElement;

function setState(next: PointerResumeState) {
  if (state === next) return;
  state = next;
  signal.notify();
}

function clearTimers() {
  window.clearTimeout(attemptTimer);
  window.clearTimeout(checkTimer);
  attemptTimer = 0;
  checkTimer = 0;
}

function attempt() {
  window.clearTimeout(attemptTimer);
  attemptTimer = 0;
  if (state === "idle") return;
  if (isLocked()) {
    clearTimers();
    setState("idle");
    return;
  }
  const wait = lastEscapeAt + ESC_COOLDOWN_MS - performance.now();
  if (wait > 0) {
    attemptTimer = window.setTimeout(attempt, wait);
    return;
  }
  isRequestInFlight = true;
  isAcquireCanceled = false;
  requestLock(getControls());
  window.clearTimeout(checkTimer);
  checkTimer = window.setTimeout(() => {
    isRequestInFlight = false;
    if (state !== "idle" && !isLocked()) setState("waiting");
  }, LOCK_CHECK_MS);
}

/**
 * 잠금을 청한다 — controls.lock() 과 같은 요청이되 거절(몸짓 없이 · ESC 직후)을 받아 둔다. 원래 lock() 은 약속을 버려 「잡히지 않은
 * 거절」이 되고 index.html 의 에러 수집기가 탭 제목에 「ERR: REJ …」를 찍었다(멈춤 메뉴 ESC 로 돌아가기, 미르 11/11).
 * 거절은 위 확인 타이머가 「기다림」으로 넘긴다
 */
function requestLock(controls: PointerLockControls | null) {
  const element = controls?.domElement as (HTMLElement & { requestPointerLock(): unknown }) | undefined;
  if (typeof element?.requestPointerLock !== "function") return;
  requestGameLock(element);
}

/** 게임 화면으로 돌아간다 — 지금 잠글 수 없으면(ESC 직후) 잠글 수 있게 되는 대로 */
export function resumePlay() {
  const controls = getControls();
  if (isTouchMode()) {
    controls?.lock();
    return;
  }
  if (isLocked()) return;
  isAcquireCanceled = false;
  if (state === "idle") setState("pending");
  attempt();
}

/** 「밖으로」 — 돌아가려던 것을 거둔다. 거뒀으면 true */
export function cancelResume() {
  if (state === "idle") return false;
  if (isRequestInFlight) isAcquireCanceled = true;
  clearTimers();
  setState("idle");
  return true;
}

/**
 * 자물쇠 조작으로 넘겨준다 — ESC 직후 기다리던 사이에 자물쇠를 열면 그 잠금이 자물쇠 안에서 걸려 ESC 가 다시 브라우저로 갔다.
 * 기다리던 것을 거두고 true(자물쇠에서 나올 때 resumePlay 로 이어 간다, Codex 리뷰 3fd1ae9)
 */
export function handOverResume() {
  return cancelResume();
}

/** 페이지가 스스로 잠금을 푼다(창 · 자물쇠) — 이 풀림은 ESC 가 아니라 잠그는 데 기다릴 일이 없다 */
export function releasePointerForGame() {
  const controls = getControls();
  if (!isTouchMode() && isLocked()) isUnlockExpected = true;
  controls?.unlock();
}

export const getPointerResumeState = () => state;
export const isResumePending = () => state !== "idle";
export const usePointerResumeState = () =>
  useSyncExternalStore(signal.subscribe, getPointerResumeState, () => "idle" as const);

if (typeof window !== "undefined") {
  document.addEventListener("pointerlockchange", () => {
    if (isLocked()) {
      isRequestInFlight = false;
      if (isAcquireCanceled) {
        // 거둔 뒤에 늦게 잡혔다 — 「밖으로」를 고른 뜻대로 놓는다
        isAcquireCanceled = false;
        isUnlockExpected = true;
        document.exitPointerLock();
        return;
      }
      isUnlockExpected = false;
      clearTimers();
      setState("idle");
      return;
    }
    // 페이지가 푼 것이 아니면 사용자가 ESC 로 푼 것이다 — 그 키는 페이지에 오지 않으니 여기서 시각을 적는다
    if (!isUnlockExpected) lastEscapeAt = performance.now();
    isUnlockExpected = false;
  });
  document.addEventListener("pointerlockerror", () => {
    isRequestInFlight = false;
    isAcquireCanceled = false;
    if (state === "idle") return;
    window.clearTimeout(checkTimer);
    setState("waiting");
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.code === "Escape") {
        lastEscapeAt = performance.now();
        return;
      }
      if (state === "idle" || isLocked() || event.repeat || event.ctrlKey || event.metaKey) return;
      // 입력칸(Leva 숫자칸 · 채팅)에 쓰는 글자는 몸짓으로 치지 않는다
      if (NON_RESUME_KEYS.has(event.code) || isTypingTarget(event.target)) return;
      // 키는 그대로 게임에도 간다(W 면 바로 걷는다) — 이 키가 몸짓이라 잠그기도 된다
      attempt();
    },
    { capture: true },
  );
  window.addEventListener(
    "mousedown",
    (event) => {
      if (state === "idle" || isLocked() || event.button !== 0) return;
      // 게임 화면(3D 캔버스)을 누른 클릭만 — 창 · 단추 · 입력칸 클릭은 그쪽이 받는다
      if (!(event.target instanceof HTMLCanvasElement)) return;
      attempt();
    },
    { capture: true },
  );
}

exposeDevHook("pointerResume", {
  state: () => ({ state, lastEscapeAgoMs: Math.round(performance.now() - lastEscapeAt), isUnlockExpected }),
});
