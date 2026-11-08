/**
 * 장면 인물 대사 상자 — 화면 아래 가운데의 반투명 상자에 이름표 · 큰 글씨로 띄운다(미르 11/9 「글씨가 작아 안 보인다」).
 *  - 말하는 동안 동행 자막은 비켜 준다(CompanionHud). 동행 입력칸이 같은 자리에 뜨면 내려 둔다(대사도 멈춘다).
 *  - 상자 윗변 높이를 `--npc-speech-top` 으로 알린다 — 알림 · 겨냥 안내(InteractionHud)가 상자 위로 비켜 선다.
 *  - 터치 화면은 오른쪽 아래 동작 단추 묶음을 피하고(왼쪽 스틱 자리는 눌림이 그대로 지나간다), 말하는 동안은 아래 빠른 칸이
 *    숨어 상자가 맨 아래로 내려온다. 알림은 상자 안 맨 위 한 줄로 — 키 작은 휴대폰에서 위로 띄우면 좌상단 퍼즐 안내판과 겹쳤다(UI 전수 검사).
 *  - 「다음」 안내는 이름표 줄 오른쪽에 — 상자를 한 줄 낮춘다.
 *  - 여러 줄이면 위로 자란다. 한국어는 낱말 단위로 줄을 바꾼다(keep-all).
 */
import { useLayoutEffect, useRef, type CSSProperties } from "react";

import { TOUCH_HUD, useKeyLabels } from "@/engine/input";

import { AMBER, CREAM, HUD_FONT as FONT, KEY_FONT } from "../../puzzles/hudTheme";
import { useNotice } from "../../puzzles/interaction";
import { useCompanionChatOpen } from "../../companion/chatOpen";
import { setSpeechBoxShown, useNpcSpeech } from "./npcSpeech";

/** 겨냥 알림이 읽는 값 — 무대 아래끝에서 상자 윗변까지(px) */
export const NPC_SPEECH_TOP_VAR = "--npc-speech-top";

/** 터치 화면에서 상자 아래(말하는 동안 빠른 칸은 숨는다) */
const TOUCH_BOTTOM = 16;

export default function NpcSpeechHud() {
  const speech = useNpcSpeech();
  const labels = useKeyLabels();
  const isChatOpen = useCompanionChatOpen();
  const boxRef = useRef<HTMLDivElement>(null);
  const isShown = !!speech && !isChatOpen;
  const notice = useNotice();

  useLayoutEffect(() => {
    setSpeechBoxShown(isShown);
    return () => setSpeechBoxShown(false);
  }, [isShown]);

  // 상자 윗변 높이를 알린다(줄 수 · 화면 크기에 따라 바뀐다)
  useLayoutEffect(() => {
    const root = document.documentElement;
    const box = boxRef.current;
    if (!isShown || !box) {
      root.style.removeProperty(NPC_SPEECH_TOP_VAR);
      return;
    }
    const update = () => {
      const stage = box.offsetParent?.getBoundingClientRect();
      const rect = box.getBoundingClientRect();
      const bottom = stage ? stage.bottom : window.innerHeight;
      root.style.setProperty(NPC_SPEECH_TOP_VAR, `${Math.ceil(bottom - rect.top)}px`);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(box);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty(NPC_SPEECH_TOP_VAR);
    };
  }, [isShown, speech?.key]);

  if (!speech || !isShown) return null;
  return (
    <div ref={boxRef} style={labels.isTouch ? touchBoxStyle : boxStyle} data-hud="인물 자막">
      {labels.isTouch && notice && (
        <div key={`notice-${notice.key}`} className="naju-notice" style={noticeStyle} data-hud="알림">
          {labels.text(notice.text)}
        </div>
      )}
      <div key={speech.key} className="companion-line">
        <div style={headStyle}>
          <span style={nameStyle}>{speech.speaker}</span>
          {speech.canAdvance && (
            <span style={advanceStyle}>
              {labels.isTouch ? "✋" : `[${labels.key("E")}]`} 겨누면 다음 <span className="companion-dots">▸</span>
            </span>
          )}
        </div>
        <p style={labels.isTouch ? touchTextStyle : textStyle}>{speech.text}</p>
      </div>
    </div>
  );
}

const boxStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
  transform: "translateX(-50%)",
  width: "min(880px, calc(100% - 48px))",
  boxSizing: "border-box",
  zIndex: 26,
  padding: "16px 26px 14px",
  borderRadius: 14,
  // 「불투명도가 있는 상자」 — 뒤 풍경이 아주 살짝만 비치게(Codex 06 은 완전 불투명을 권했다 — 미르 말은 반투명으로 읽었다)
  background: "rgba(12,15,22,.9)",
  border: "1px solid rgba(242,238,228,.16)",
  boxShadow: "0 10px 30px rgba(0,0,0,.35)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  textAlign: "left",
  pointerEvents: "none",
  color: CREAM,
};

const touchBoxStyle: CSSProperties = {
  ...boxStyle,
  left: "calc(env(safe-area-inset-left, 0px) + 12px)",
  right: `calc(env(safe-area-inset-right, 0px) + ${TOUCH_HUD.actionRight + TOUCH_HUD.actionWidth + 12}px)`,
  bottom: `calc(env(safe-area-inset-bottom, 0px) + ${TOUCH_BOTTOM}px)`,
  transform: "none",
  width: "auto",
  maxWidth: 880,
  margin: "0 auto",
  padding: "10px 16px 9px",
  borderRadius: 12,
};

const headStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 8,
};

const nameStyle: CSSProperties = {
  font: `700 15px/1 ${FONT}`,
  color: AMBER,
  letterSpacing: "0.06em",
};

/** 터치 — 상자 안 맨 위 알림 한 줄(겨냥 알림 대신) */
const noticeStyle: CSSProperties = {
  marginBottom: 8,
  paddingBottom: 7,
  borderBottom: "1px solid rgba(242,238,228,.14)",
  font: `500 14px/1.45 ${FONT}`,
  color: "rgba(242,238,228,.85)",
  wordBreak: "keep-all",
};

const textStyle: CSSProperties = {
  margin: 0,
  font: `500 clamp(17px, calc(0.9vw + 10px), 22px)/1.65 ${FONT}`,
  wordBreak: "keep-all",
  overflowWrap: "break-word",
  textShadow: "0 1px 2px rgba(0,0,0,.5)",
};

const touchTextStyle: CSSProperties = {
  ...textStyle,
  font: `500 clamp(17px, calc(1.2vw + 10px), 19px)/1.55 ${FONT}`,
};

const advanceStyle: CSSProperties = {
  flexShrink: 0,
  font: `13px/1 ${KEY_FONT}`,
  color: "rgba(242,238,228,.6)",
};
