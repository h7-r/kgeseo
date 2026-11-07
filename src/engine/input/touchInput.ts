/**
 * 터치 입력 상자 — 화면 스틱·시점 드래그·버튼이 여기에 쓰고, 이동 훅·시점 조작기가 읽는다.
 *
 * 연속 입력(이동·시점)은 값으로 직접 넘긴다. 키 이벤트로 흉내 내면 「살짝 밀면 천천히」를 담을 수 없다.
 * 단발 입력(쓰기·점프·창)은 「제한된 가상 키」로 기존 키 처리에 잇는다 — 퍼즐마다 흩어진 E 처리를 고치지 않으려고.
 *   · 누름 한 번 = keydown 한 번(자동 반복 없음), repeat:false, 조합키 없음, code 와 key 를 둘 다 채운다
 *   · 입력칸에 쓰는 중이면 보내지 않는다(window 로 보낸 이벤트는 event.target 검사를 비켜 가므로 여기서 본다)
 *   · 취소는 놓기와 다르다 — 취소 훅(길게 누르기 정리)을 먼저 부르고 나서 keyup 을 보낸다
 * 합성 키 이벤트는 「사용자 몸짓」으로 쳐 주지 않는다 — 소리·전체 화면은 실제 탭 핸들러에서 부른다.
 */

/** 스틱 값 — x 오른쪽 +, y 앞 +. 길이 0~1 */
const move = { x: 0, y: 0 };

/**
 * 스틱 반응 곡선(코덱스 구현 07회차 — Sky 의 「작게 끌면 걷기 · 크게 끌면 달리기」, Unity 무감 영역 재배분 참고. 수치는 시험값).
 *   0~0.1 정지 · 0.1~0.6 걷기 속도까지 연속 증가 · 0.6~0.92 걷기 유지 · 0.92~1 달리기 속도까지 부드럽게
 * 달리기 판정은 보정 전 세기로 한다(보정 후 값이면 60% 만 밀어도 달린다). 들어갈 때 0.92, 풀릴 때 0.86 — 경계에서 떨지 않게.
 */
const DEAD_ZONE = 0.1;
const FULL_WALK_AT = 0.6;
export const RUN_THRESHOLD = 0.92;
const RUN_RELEASE = 0.86;
let isRunLatched = false;

let lookX = 0;
let lookY = 0;

export function setTouchMove(x: number, y: number) {
  const length = Math.hypot(x, y);
  const scale = length > 1 ? 1 / length : 1;
  move.x = x * scale;
  move.y = y * scale;
}

export interface TouchMove {
  x: number;
  y: number;
  /** 보정 전 세기 0~1 */
  magnitude: number;
  /** 걷기 속도 대비 0~1(곡선 적용) */
  walk: number;
  /** 걷기 → 달리기 섞는 정도 0~1 — 속도 = 걷기 × lerp(1, 달리기 배율, run) */
  run: number;
  /** 달리기 중(모션 · 소리 · 튜토리얼) — 0.92 에서 켜지고 0.86 아래로 내려가야 꺼진다 */
  isRunning: boolean;
}

/** 스틱 값 — 이동 훅이 매 프레임 읽는다 */
export function getTouchMove(): TouchMove {
  const magnitude = Math.hypot(move.x, move.y);
  if (magnitude >= RUN_THRESHOLD) isRunLatched = true;
  else if (magnitude < RUN_RELEASE) isRunLatched = false;
  const walk = magnitude <= DEAD_ZONE ? 0 : Math.min(1, (magnitude - DEAD_ZONE) / (FULL_WALK_AT - DEAD_ZONE));
  const run = Math.max(0, Math.min(1, (magnitude - RUN_THRESHOLD) / (1 - RUN_THRESHOLD)));
  return { x: move.x, y: move.y, magnitude, walk, run, isRunning: isRunLatched };
}

/** 키보드 · 터치를 합친 속도 배율(걷기 1 기준) — 이동 훅 공용. 키를 누르고 있으면 키가 먼저다 */
export function touchSpeedMultiplier(touch: TouchMove, runMultiplier: number): number {
  return touch.walk * (1 + (runMultiplier - 1) * touch.run);
}

/** 시점 드래그(화면 px). 프레임마다 시점 조작기가 꺼내 쓴다 */
export function addTouchLook(dx: number, dy: number) {
  lookX += dx;
  lookY += dy;
}

export function consumeTouchLook(): { dx: number; dy: number } {
  const delta = { dx: lookX, dy: lookY };
  lookX = 0;
  lookY = 0;
  return delta;
}

// ── 가상 키 ──

const KEY_OF: Record<string, string> = {
  KeyE: "e",
  KeyC: "c",
  KeyI: "i",
  KeyH: "h",
  KeyP: "p",
  KeyV: "v",
  KeyF: "f",
  KeyG: "g",
  Space: " ",
  Enter: "Enter",
  Escape: "Escape",
};

function keyOf(code: string): string {
  const digit = /^Digit([0-9])$/.exec(code);
  return digit ? digit[1] : (KEY_OF[code] ?? code);
}

function isTyping(): boolean {
  const element = document.activeElement as HTMLElement | null;
  if (!element) return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable;
}

/** 누르고 있는 가상 키 */
const held = new Set<string>();
/** 취소 때 먼저 부를 정리 함수들(onInputCancel) */
const cancelHooks = new Set<() => void>();

function send(type: "keydown" | "keyup", code: string) {
  // body 에서 보내야 window · document · body 어디에 붙은 리스너든(캡처 포함) 다 받는다
  const target = document.body ?? document;
  target.dispatchEvent(
    new KeyboardEvent(type, { code, key: keyOf(code), bubbles: true, cancelable: true, repeat: false }),
  );
}

/** 버튼을 눌렀다 — 이미 누르고 있으면 다시 보내지 않는다 */
export function pressKey(code: string) {
  if (held.has(code) || isTyping()) return;
  held.add(code);
  send("keydown", code);
}

/** 버튼에서 정상으로 손을 뗐다 */
export function releaseKey(code: string) {
  if (!held.delete(code)) return;
  send("keyup", code);
}

/** 버튼 하나의 손가락이 취소됐다(pointercancel) — 정리 훅을 먼저 부르고 그 키만 뗀다. 다른 손의 스틱은 그대로 */
export function cancelKey(code: string) {
  if (!held.has(code)) return;
  for (const hook of cancelHooks) hook();
  releaseKey(code);
}

/** 한 번 누르고 바로 떼는 버튼(창 열기 등) */
export function tapKey(code: string) {
  pressKey(code);
  releaseKey(code);
}

// ── 취소 ──

/** 취소 때 먼저 부를 정리 함수 — 길게 누르기처럼 keyup 이 「짧게 눌렀다」로 읽히는 곳이 건다 */
export function onInputCancel(hook: () => void): () => void {
  cancelHooks.add(hook);
  return () => cancelHooks.delete(hook);
}

const cancelListeners = new Set<() => void>();

/** 화면 쪽(스틱·버튼)이 손가락 상태를 버리라는 신호를 듣는다 */
export function addCancelListener(listener: () => void): () => void {
  cancelListeners.add(listener);
  return () => cancelListeners.delete(listener);
}

/**
 * 누르던 모든 것을 취소한다 — 회전·숨김·창 벗어남·멈춤·pointercancel 에서.
 * 취소 훅 → 남은 가상 키 keyup → 스틱·시점 비우기 → 화면 쪽 손가락 버리기 순서.
 */
export function cancelAllTouchInput() {
  for (const hook of cancelHooks) hook();
  for (const code of [...held]) releaseKey(code);
  move.x = 0;
  move.y = 0;
  isRunLatched = false;
  lookX = 0;
  lookY = 0;
  for (const listener of cancelListeners) listener();
}
