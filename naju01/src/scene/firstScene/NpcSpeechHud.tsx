/**
 * 장면 인물 자막 — 동행 자막 띠와 같은 자리 · 같은 모양(화면 아래 36 px, 알림 bottom 110 아래)에 이름표를 달아 띄운다.
 * 말하는 동안 동행 자막은 비켜 준다(CompanionHud). 여러 줄이면 위로 자란다 — 좁은 화면은 글자를 줄여 두 줄 안팎에 담는다(자르지 않는다).
 */
import type { CSSProperties } from "react";

import { useKeyLabels } from "@/engine/input";

import { AMBER, CREAM, HUD_FONT as FONT, KEY_FONT } from "../../puzzles/hudTheme";
import { useNpcSpeech } from "./npcSpeech";

export default function NpcSpeechHud() {
  const speech = useNpcSpeech();
  const labels = useKeyLabels();
  if (!speech) return null;
  return (
    <div style={bandStyle} data-hud="인물 자막">
      <div key={speech.key} className="companion-line">
        <div style={nameStyle}>
          {speech.speaker}
          {speech.canAdvance && (
            <span style={advanceStyle}>{labels.isTouch ? "✋" : `[${labels.key("E")}]`} 겨누면 다음</span>
          )}
        </div>
        <span style={textStyle}>{speech.text}</span>
      </div>
    </div>
  );
}

const bandStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 36,
  transform: "translateX(-50%)",
  width: "min(720px, calc(100% - 32px))",
  zIndex: 26,
  textAlign: "center",
  pointerEvents: "none",
  font: `500 clamp(14px, calc(1.1vw + 9px), 17px)/1.5 ${FONT}`,
  color: CREAM,
};

const textStyle: CSSProperties = {
  padding: "3px 10px",
  borderRadius: 6,
  background: "rgba(14,18,26,.62)",
  boxDecorationBreak: "clone",
  WebkitBoxDecorationBreak: "clone",
  textShadow: "0 1px 2px rgba(0,0,0,.55)",
};

const nameStyle: CSSProperties = {
  font: `700 12px/1 ${FONT}`,
  color: AMBER,
  marginBottom: 6,
  letterSpacing: "0.04em",
};

const advanceStyle: CSSProperties = {
  marginLeft: 10,
  font: `11px/1 ${KEY_FONT}`,
  color: "rgba(242,238,228,.6)",
  letterSpacing: 0,
};
