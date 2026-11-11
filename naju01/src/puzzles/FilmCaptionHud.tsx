import type { CSSProperties } from "react";

import { useFilmCaption } from "./filmCaption";
import { CREAM, HUD_FONT as FONT } from "./hudTheme";

/** 게임 속 영상의 자막 — 화면 아래 가운데, 상자 없이 한 줄(filmCaption). Canvas 밖 DOM 층 */
export default function FilmCaptionHud() {
  const caption = useFilmCaption();
  if (!caption) return null;
  return (
    <div style={wrapStyle} data-hud="영상 자막">
      <p key={caption.key} className="naju-film-caption" style={textStyle}>
        {caption.text}
      </p>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: "max(64px, 9vh)",
  // 알림(25) 위 · 설정창(45) · 멈춤 메뉴(60) 아래 — 멈춘 동안 창 위에 자막이 겹치지 않게(Codex 리뷰 2)
  zIndex: 26,
  display: "flex",
  justifyContent: "center",
  padding: "0 6vw",
  pointerEvents: "none",
};

const textStyle: CSSProperties = {
  margin: 0,
  maxWidth: 1000,
  color: CREAM,
  font: `500 clamp(17px, 1.9vw, 26px) / 1.5 ${FONT}`,
  textAlign: "center",
  wordBreak: "keep-all",
  // 상자 없이 어느 바탕에서도 읽히게 — 어두운 테두리 그림자를 겹친다
  textShadow: "0 0 3px #000, 0 2px 8px rgba(0, 0, 0, 0.9), 0 0 18px rgba(0, 0, 0, 0.7)",
};
