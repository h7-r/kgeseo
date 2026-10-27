// NPC 대화 키 — 순수 판정(dialogKeyAction)과 창 리스너 붙이기(attachDialogKeys).
// F: 대화 시작 · 다음 대사 / Enter: 대화 중 다음 대사 / Esc: 대화 끝(보조 — 포인터 잠금 중 Esc 는 브라우저가 잠금 풀기에 먼저 쓴다).
// G: 도움 제안 거절(대화 밖에서만 — 훅이 도움 안내가 떠 있을 때만 받는다). 게임 · 편집기 · 공용 엔진 어디서도 쓰지 않는 키다(9단계 확인).
// KeyE 는 게임의 편집 모드 토글이라 쓰지 않는다. 게임 키를 가로채지 않는다(preventDefault · stopPropagation 없음).
// 무시: 키 반복 · Ctrl/Alt/⌘ 조합 · IME 조합 중 · 입력창에 포커스. Shift 는 달리기 키라 막지 않는다(달리며 F).
// 게임처럼 e.code 를 쓴다 — 한글 자판에서도 같은 물리 키다.

export const DIALOG_KEYS = {
  talk: "KeyF",
  advance: ["KeyF", "Enter", "NumpadEnter"] as readonly string[],
  close: "Escape",
  decline: "KeyG",
};

export type DialogKeyAction = "talk" | "advance" | "close" | "decline";

export interface DialogKeyEvent {
  code: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  target?: EventTarget | null;
}

/** 입력창 · 편집 가능한 요소에 포커스가 있는지 */
export function isTypingTarget(target: EventTarget | null | undefined): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? "");
}

/** 이 키로 할 일. 대화 키가 아니거나 무시할 입력이면 null */
export function dialogKeyAction(event: DialogKeyEvent, dialogOpen: boolean): DialogKeyAction | null {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.isComposing || event.keyCode === 229) return null;
  if (isTypingTarget(event.target)) return null;
  if (dialogOpen) {
    if (DIALOG_KEYS.advance.includes(event.code)) return "advance";
    if (event.code === DIALOG_KEYS.close) return "close";
    return null;
  }
  if (event.code === DIALOG_KEYS.talk) return "talk";
  if (event.code === DIALOG_KEYS.decline) return "decline";
  return null;
}

export interface DialogKeyHandlers {
  isOpen(): boolean;
  onAction(action: DialogKeyAction): void;
}

/** target(기본 window)에 keydown 리스너를 하나 붙인다. 돌려준 함수로 뗀다 */
export function attachDialogKeys(target: EventTarget, handlers: DialogKeyHandlers): () => void {
  const listener = (event: Event) => {
    const action = dialogKeyAction(event as KeyboardEvent, handlers.isOpen());
    if (action) handlers.onAction(action);
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}
