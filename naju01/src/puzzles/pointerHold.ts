/**
 * 상호작용 중 ESC 두 단계(미르 11/8) — 첫 ESC 는 상호작용(창)만 닫고 하던 조작으로 돌아오고,
 * 그 상태에서 한 번 더 누르면 그때 게임 밖(커서)이다.
 *
 * 마우스가 잠긴 동안 ESC 는 브라우저가 먼저 가져가 잠금을 푼다(페이지가 막을 수 없다). 그래서 둘러볼 필요가 없는
 * 상호작용(종이 읽기 · 줄 당기기)과 창(소지품 · 설정 · 힌트함)은 시작할 때 페이지가 스스로 잠금을 풀어 둔다.
 * 그러면 ESC 가 평범한 키로 들어와 맨 위 하나만 닫고, 페이지가 푼 잠금이라 크롬은 몸짓 없이 다시 잠가 준다.
 * 상호작용 동안 커서는 CSS 로 숨긴다 — 숨길 뿐, 창 밖으로 나가는 것까지 막지는 못한다.
 *
 * 다시 잠그지 못하면(몸짓을 요구하는 브라우저) 커서를 숨긴 채 기다리다가 다음 클릭 · 키에 잠근다. 그 사이 ESC 는 「나가기」.
 * 끌기 · 수레 · 물레처럼 둘러보며 하는 상호작용은 잠금을 유지한다 — 그 중에 ESC 로 잠금이 풀리면 놓게 하고
 * (onEscapeUnlock) 같은 기다림으로 들어간다.
 * 터치(가상 잠금)에는 ESC 가 없다 — 상호작용 때 잠금을 풀지 않고, 창은 예전처럼 풀며 닫을 때 복귀는 MobileGate 가 한다.
 */
import type { PointerLockControls } from "three-stdlib";

import { exposeDevHook } from "@/debug/devHooks";
import { isTouchMode } from "@/engine/input/touchMode";
import { isPointerActive } from "@/engine/input/virtualLock";

import { isCompanionChatOpen } from "../companion/chatOpen";
import { clearNotice, showNotice } from "./interaction";

type HoldKind = "interaction" | "window";

/** 다시 잠근 뒤 이만큼 안에 안 잡히면 다음 몸짓을 기다린다(ms) */
const LOCK_CHECK_MS = 600;
const HIDDEN_CURSOR_CLASS = "naju-cursor-hidden";
export const WAITING_NOTICE = "클릭하거나 아무 키나 누르면 이어서 · [Esc] 나가기";
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

const holds = new Map<string, HoldKind>();
let getControls: () => PointerLockControls | null = () => null;
/** 처음 붙들 때 조작 중이었나 — 다 놓이면 이것을 보고 다시 잠근다 */
let resumeAfter = false;
let resumeTimer = 0;
let lockCheckTimer = 0;
/** 페이지가 스스로 푼 잠금 — 이 풀림은 ESC 가 아니다 */
let isUnlockExpected = false;
/** 다시 잠그지 못해 다음 클릭 · 키를 기다리는 중 */
let isWaiting = false;
/** 복귀하려고 잠금을 청했다 — 거절(pointerlockerror)이면 바로 기다림으로 */
let isResumeRequested = false;

type EscapeConsumer = () => boolean;
const escapeConsumers = new Set<EscapeConsumer>();

/** App 이 잠금 장치를 알려 준다(씬과 함께 늦게 생긴다) */
export function bindPointerHold(get: () => PointerLockControls | null) {
  getControls = get;
}

const hasKind = (kind: HoldKind) => [...holds.values()].includes(kind);
const isRealLockActive = () => typeof document !== "undefined" && !!document.pointerLockElement;

/** 창(소지품 · 설정 · 힌트함 · 동행 입력)이 떠 있다 — ESC 는 창이 먼저 받는다 */
export const isWindowHeld = () => hasKind("window") || isCompanionChatOpen();

/** 상호작용 때문에 페이지가 잠금을 풀어 둔 상태다(위에 창 없음) — 「잠금이 풀리면 그만둔다」는 이때 무시한다 */
export const isInteractionHeld = () => hasKind("interaction") && !isWindowHeld();

/** 붙든 것이 하나라도 있다 — [T] 로 잠그지 않는다 */
export const hasPointerHolds = () => holds.size > 0;

function syncCursor() {
  if (typeof document === "undefined") return;
  const hide = !isTouchMode() && (isWaiting || isInteractionHeld());
  document.documentElement.classList.toggle(HIDDEN_CURSOR_CLASS, hide);
}

function releaseLock() {
  if (isRealLockActive()) isUnlockExpected = true;
  getControls()?.unlock();
}

/** 진짜 잠금을 청한다 — 거절돼도 콘솔에 잡히지 않은 오류를 남기지 않게 promise 를 받는다 */
function requestLock() {
  const element = (getControls() as unknown as { domElement?: HTMLElement } | null)?.domElement;
  if (typeof element?.requestPointerLock !== "function") return;
  try {
    const result = element.requestPointerLock() as unknown;
    if (result instanceof Promise) result.catch(() => {});
  } catch {
    // 잠금이 없는 브라우저 — 기다림으로 넘어간다
  }
}

/**
 * 붙든다 — 상호작용은 진짜 잠금일 때만 풀고(터치는 그대로), 창은 늘 푼다(터치의 가상 잠금까지 — 예전과 같다).
 * 처음 붙들 때의 조작 상태를 기억한다. 같은 키로 하나가 놓이고 다른 것이 이어 붙들면(종이 → 힌트함) 기억을 이어 쓴다
 */
export function beginHold(id: string, kind: HoldKind) {
  if (holds.get(id) === kind) return;
  if (holds.size === 0 && !resumeTimer) resumeAfter = isPointerActive() || isWaiting;
  window.clearTimeout(resumeTimer);
  resumeTimer = 0;
  holds.set(id, kind);
  if (kind === "window") stopWaiting();
  if (kind === "window" ? isPointerActive() : !isTouchMode() && isRealLockActive()) releaseLock();
  syncCursor();
}

/** 놓는다 — 다 놓였고 처음에 조작 중이었으면 한 박자 뒤에 다시 잠근다 */
export function endHold(id: string) {
  if (!holds.delete(id)) return;
  syncCursor();
  if (holds.size > 0) return;
  window.clearTimeout(resumeTimer);
  // 같은 키 안에서 다른 창이 이어 열릴 수 있다(종이를 힌트함에 넣기) — React 가 그 창을 그린 뒤에 본다
  resumeTimer = window.setTimeout(() => {
    resumeTimer = 0;
    if (holds.size > 0) return;
    const shouldResume = resumeAfter;
    resumeAfter = false;
    if (shouldResume) resumePlay();
  }, 0);
}

function resumePlay() {
  // 터치는 창을 닫으면 MobileGate 가 잠근다. 다른 창 · 탭으로 갔으면 그대로 둔다
  if (isTouchMode() || isPointerActive() || isCompanionChatOpen()) return;
  if (!document.hasFocus()) return;
  isResumeRequested = true;
  requestLock();
  window.clearTimeout(lockCheckTimer);
  lockCheckTimer = window.setTimeout(() => {
    isResumeRequested = false;
    if (!isPointerActive() && holds.size === 0) startWaiting();
  }, LOCK_CHECK_MS);
}

function startWaiting() {
  if (isWaiting || isTouchMode() || isWindowHeld() || !document.hasFocus()) return;
  isWaiting = true;
  syncCursor();
  // 멈춤 상태 안내 — 이야기(동행 자막 등) 위에도 바로(풀리면 clearNotice 로 거둔다)
  showNotice(WAITING_NOTICE, 4, { always: true });
}

function stopWaiting() {
  window.clearTimeout(lockCheckTimer);
  if (!isWaiting) return;
  isWaiting = false;
  syncCursor();
  clearNotice(WAITING_NOTICE);
}

/**
 * 잠금을 유지하는 상호작용(끌기 · 수레 · 물레)이 「ESC 로 잠금이 풀렸을 때」 할 일을 건다.
 * 그때 하던 것이 있으면 놓고 true — 그러면 커서를 숨긴 채 다음 클릭 · 키를 기다린다
 */
export function onEscapeUnlock(consumer: EscapeConsumer): () => void {
  escapeConsumers.add(consumer);
  return () => {
    escapeConsumers.delete(consumer);
  };
}

if (typeof window !== "undefined") {
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement) {
      isUnlockExpected = false;
      isResumeRequested = false;
      stopWaiting();
      return;
    }
    if (isUnlockExpected) {
      isUnlockExpected = false;
      return;
    }
    // 페이지가 푼 것이 아니다 — ESC(또는 브라우저가 창 전환으로 푼 것)
    let wasBusy = false;
    for (const consumer of escapeConsumers) if (consumer()) wasBusy = true;
    if (wasBusy) startWaiting();
  });
  document.addEventListener("pointerlockerror", () => {
    if (!isResumeRequested) return;
    isResumeRequested = false;
    window.clearTimeout(lockCheckTimer);
    if (!isPointerActive() && holds.size === 0) startWaiting();
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (!isWaiting) return;
      if (event.code === "Escape") {
        stopWaiting();
        return;
      }
      if (event.repeat || NON_RESUME_KEYS.has(event.code) || event.ctrlKey || event.metaKey) return;
      // 키는 그대로 게임에도 간다(W 면 바로 걷는다)
      requestLock();
    },
    { capture: true },
  );
  window.addEventListener(
    "mousedown",
    (event) => {
      if (!isWaiting || event.button !== 0) return;
      // 화면 단추(설정 등)는 그 단추가 받는다
      if ((event.target as Element | null)?.closest?.("button, input, textarea, select, a, [role='button']")) return;
      requestLock();
    },
    { capture: true },
  );
  window.addEventListener("blur", stopWaiting);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopWaiting();
  });
}

exposeDevHook("najuPointerHold", {
  state: () => ({ holds: [...holds.entries()], resumeAfter, isWaiting, isUnlockExpected }),
});
