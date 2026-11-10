/**
 * 동행 NPC 채팅 입력 · 세션 상태 표식(Canvas 밖 DOM).
 *
 * - 동행의 말(서버 대사 · 힌트 · 알림)은 여기서 그리지 않는다 — 대화창은 한 벌(dialogue/DialogueLayer)이고,
 *   dialogue/companionBridge 가 companionDialog 의 line 을 그쪽으로 넘긴다(계약 v0.4.16 §10, #52). 자막 · 기다림 · 길게 누르기 막대는 뺐다.
 * - 세션 시작(startCompanion)은 여기서 하지 않는다 — 앱이 뜰 때 한 번(app/App.tsx). 이 화면이 없어도 진행 동기화 · 힌트가 돈다.
 * - Enter(잠금 중) · 💬(터치)로 한 줄 입력을 연다 — 11/13 베타는 끈다(IS_FREE_INPUT_ENABLED). 입력 중에는 capture 단계 차단기 하나로
 *   게임 키(T · V · H · I · P · 숫자)가 새지 않게 막고, 닫을 때 원래 잠겨 있었으면 다시 잠근다.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";

import { AMBER, CREAM, HUD_FONT as FONT, KEY_FONT } from "../puzzles/hudTheme";
import { useTouchMode } from "@/engine/input/touchMode";
import { isPointerActive } from "@/engine/input/virtualLock";
import { setCompanionChatOpen } from "./chatOpen";
import { MAX_MESSAGE_LENGTH } from "./companionDialog.ts";
import { isCompanionIntro, useCompanionIntro } from "./companionStage";
import {
  COMPANION_NAME,
  MOCK_SCENARIO,
  companionDialog,
  useCompanionDialog,
  useCompanionSession,
} from "./companionRuntime";

/**
 * 자유 입력(player_message)을 여는가. 계약 v0.4.16 §10-1: 11/13 나주 베타는 끈다(11/9 미르 재확인).
 * 코드는 지우지 않는다 — true 로 바꾸면 Enter · 💬 입력이 전처럼 열린다.
 */
export const IS_FREE_INPUT_ENABLED = false;

interface CompanionHudProps {
  controlsRef: RefObject<PointerLockControlsImpl | null>;
  isLocked: boolean;
  /** ?dev — 세션 상태 표식 */
  showStatus?: boolean;
}

export default function CompanionHud({ controlsRef, isLocked, showStatus = false }: CompanionHudProps) {
  const dialog = useCompanionDialog();
  const session = useCompanionSession();
  const [isTyping, setIsTyping] = useState(false);
  // 입력칸 effect 는 열릴 때 한 번만 돌아야 한다(잠금 기억 · 포커스) — 닫기 함수가 매번 바뀌면 다시 돌아 둘 다 잃는다
  const closeTyping = useCallback(() => setIsTyping(false), []);
  const isTouch = useTouchMode();
  // 첫 입장 소개 중에는 입력칸을 열지 않는다(Enter · 💬) — 소개 대사와 겹치지 않게(Codex 08)
  const isIntro = useCompanionIntro();
  // 터치 모드의 창 판정(MobileGate)이 입력칸을 창으로 보게 밖에 알린다
  useEffect(() => setCompanionChatOpen(isTyping), [isTyping]);

  // Enter — 잠금 중 · 말을 걸 수 있을 때만 입력을 연다(창이 열려 있으면 잠금이 풀려 있어 여기 오지 않는다)
  useEffect(() => {
    if (!IS_FREE_INPUT_ENABLED || !isLocked || !dialog.isEnabled || isTyping) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Enter" || event.repeat || event.isComposing || isCompanionIntro()) return;
      event.preventDefault();
      setIsTyping(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isLocked, dialog.isEnabled, isTyping]);

  // 자막 · 기다림 표시는 그리지 않는다 — 말은 대화창(DialogueLayer) 한 벌에 뜬다
  return (
    <>
      {/* 터치 — 💬 로 입력칸을 연다. 아이폰은 탭 안에서 바로 포커스해야 키보드가 뜨므로 그 탭에서 동기로 그린다(flushSync) */}
      {IS_FREE_INPUT_ENABLED && isTouch && isLocked && dialog.isEnabled && !isTyping && !isIntro && (
        <button
          type="button"
          aria-label={`${COMPANION_NAME}에게 말하기`}
          style={chatButtonStyle}
          onClick={() => flushSync(() => setIsTyping(true))}
        >
          💬
        </button>
      )}
      {isTyping && (
        <div style={isTouch ? touchTypingBandStyle : bandStyle} data-testid="companion-input-band">
          <ChatInput controlsRef={controlsRef} onClose={closeTyping} isTouch={isTouch} />
        </div>
      )}
      {showStatus && <StatusBadge session={session} contentMode={dialog.contentMode} reason={dialog.fallbackReason} />}
    </>
  );
}

/** 한 줄 입력. 차단기가 Enter · Esc · IME 를 직접 다룬다 — capture 에서 전파를 끊으면 input 의 onKeyDown 은 오지 않는다 */
function ChatInput({
  controlsRef,
  onClose,
  isTouch,
}: {
  controlsRef: RefObject<PointerLockControlsImpl | null>;
  onClose: () => void;
  isTouch: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  // 그려진 그 커밋 안에서 포커스 — 💬 탭(사용자 몸짓) 안이어야 아이폰 키보드가 뜬다
  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const wasLocked = isPointerActive();
    controlsRef.current?.unlock();
    // 바로 포커스한다 — 다음 프레임으로 미루면 Enter 뒤 곧바로 친 글자가 입력칸 밖으로 샌다
    inputRef.current?.focus();
    let isClosed = false;

    const close = (relock: boolean) => {
      if (isClosed) return;
      isClosed = true;
      onClose();
      // keydown 안(사용자 동작)에서만 다시 잠글 수 있다
      if (relock && wasLocked) {
        try {
          controlsRef.current?.lock();
        } catch {
          // 잠금이 거절돼도 T 로 다시 잡으면 된다
        }
      }
    };

    const gate = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        event.stopImmediatePropagation();
        close(true);
        return;
      }
      if (event.code === "Enter" || event.code === "NumpadEnter") {
        event.stopImmediatePropagation();
        if (event.isComposing) return;
        event.preventDefault();
        const message = (inputRef.current?.value ?? "").trim();
        if (message) void companionDialog.talk(message);
        close(true);
        return;
      }
      // 글자는 input 에 그대로 찍히게 기본 동작은 두고, 게임 단축키로만 새지 않게 한다
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", gate, { capture: true });
    const input = inputRef.current;
    const onBlur = () => close(false);
    input?.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", gate, { capture: true });
      input?.removeEventListener("blur", onBlur);
    };
  }, [controlsRef, onClose]);

  return (
    <div style={{ pointerEvents: "auto", width: "100%" }}>
      <div style={nameStyle}>
        {COMPANION_NAME}에게{isTouch ? "" : " · Enter 보내기 · Esc 취소"}
        {text.length >= 180 && <span style={counterStyle}>{`${text.length}/${MAX_MESSAGE_LENGTH}`}</span>}
      </div>
      <input
        ref={inputRef}
        value={text}
        maxLength={MAX_MESSAGE_LENGTH}
        onChange={(event) => setText(event.target.value)}
        style={inputStyle}
        aria-label={`${COMPANION_NAME}에게 할 말`}
        data-testid="companion-input"
      />
      {/* 터치 — 보내기 · 닫기. 누르는 순간 입력칸이 포커스를 잃으면 닫혀 버리므로 기본 동작(포커스 옮기기)을 막고,
          판정은 키보드와 같은 길(Enter · Escape 차단기)로 보낸다 */}
      {isTouch && (
        <div style={chatActionsStyle}>
          <button
            type="button"
            style={chatActionStyle}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => sendKey("Escape")}
          >
            닫기
          </button>
          <button
            type="button"
            style={{ ...chatActionStyle, borderColor: AMBER, color: AMBER }}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => sendKey("Enter")}
          >
            보내기
          </button>
        </div>
      )}
    </div>
  );
}

function keepFocus(event: { preventDefault: () => void }) {
  event.preventDefault();
}

function sendKey(code: "Enter" | "Escape") {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true }));
}

const PHASE_TEXT = {
  off: "꺼짐(케이스 · 버전 미설정)",
  starting: "세션 준비 중",
  ready: "준비됨",
  unavailable: "비활성",
} as const;

function StatusBadge({
  session,
  contentMode,
  reason,
}: {
  session: ReturnType<typeof useCompanionSession>;
  contentMode: string | null;
  reason: string | null;
}) {
  const detail =
    session.phase === "unavailable"
      ? ` · ${session.reason}`
      : session.phase === "ready"
        ? ` · ${session.caseId} v${session.contentVersion}`
        : "";
  return (
    <div style={statusStyle} data-testid="companion-status">
      동행 NPC: {PHASE_TEXT[session.phase]}
      {detail}
      {contentMode && ` · ${contentMode}`}
      {reason && ` · ${reason}`}
      {MOCK_SCENARIO !== null && ` · 모의(${MOCK_SCENARIO})`}
    </div>
  );
}

// ── 모양(hudTheme 기준) — 입력 띠는 화면 아래 36~105px, 알림(bottom 110) 아래 ──

const bandStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 36,
  transform: "translateX(-50%)",
  width: "min(720px, calc(100% - 32px))",
  zIndex: 25,
  textAlign: "center",
  pointerEvents: "none",
  font: `500 17px/1.5 ${FONT}`,
  color: CREAM,
};

const nameStyle: CSSProperties = {
  font: `700 12px/1 ${FONT}`,
  color: AMBER,
  marginBottom: 6,
  letterSpacing: "0.04em",
};
const counterStyle: CSSProperties = { marginLeft: 10, font: `11px/1 ${KEY_FONT}` };

/** 터치 — 입력칸은 위쪽에(아래는 화면 키보드가 덮는다) */
const touchTypingBandStyle: CSSProperties = {
  ...bandStyle,
  bottom: "auto",
  top: "calc(env(safe-area-inset-top, 0px) + 10px)",
  zIndex: 960,
};
const chatButtonStyle: CSSProperties = {
  position: "absolute",
  right: "calc(env(safe-area-inset-right, 0px) + 12px + 4 * 48px + 4 * 8px)",
  top: "calc(env(safe-area-inset-top, 0px) + 12px)",
  zIndex: 950,
  width: 48,
  height: 48,
  borderRadius: "50%",
  border: "1.5px solid rgba(242,238,228,0.4)",
  background: "rgba(20,22,28,0.45)",
  fontSize: 20,
  padding: 0,
  pointerEvents: "auto",
  touchAction: "manipulation",
};
const chatActionsStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 };
const chatActionStyle: CSSProperties = {
  minWidth: 80,
  height: 44,
  borderRadius: 22,
  border: "1px solid rgba(242,238,228,.4)",
  background: "rgba(14,18,26,.78)",
  color: CREAM,
  font: `600 15px/1 ${FONT}`,
};

const inputStyle: CSSProperties = {
  width: "100%",
  // 누르는 영역 44(14회차, 예전 40)
  height: 44,
  boxSizing: "border-box",
  padding: "0 14px",
  borderRadius: 8,
  border: "none",
  outline: "none",
  background: "rgba(14,18,26,.78)",
  boxShadow: "inset 0 0 0 1px rgba(242,200,154,.6)",
  color: CREAM,
  caretColor: AMBER,
  font: `17px ${FONT}`,
};

const statusStyle: CSSProperties = {
  position: "absolute",
  left: 14,
  bottom: 12,
  zIndex: 20,
  padding: "4px 8px",
  borderRadius: 6,
  background: "rgba(14,18,26,.7)",
  color: "#C8D0DC",
  font: `11px/1.4 ${KEY_FONT}`,
  pointerEvents: "none",
};
