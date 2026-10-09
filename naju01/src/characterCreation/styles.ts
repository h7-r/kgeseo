// 캐릭터 생성 화면의 색·글꼴·간격·모션 토큰, 화면 조각들이 같이 쓰는 스타일과 화면 CSS.
import type { CSSProperties } from "react";

import { THUMBNAIL_DIR } from "./catalog";

// 바탕 팔레트 — 화면 CSS 의 기본 모양과 개발 미리보기 도구가 쓴다.
export const BASE_COLORS = {
  text: "#F2F4F5",
  textMuted: "#AAB8C4",
  textFaint: "rgba(170,184,196,0.58)",
  // 강조는 선택·현재 상태에만
  accent: "#9AD8E8",
  accentStrong: "#5FB0C8",
  success: "#7FD6A8",
  warning: "#F0C27A",
  error: "#F2938F",
  line: "rgba(154,216,232,0.20)",
};

export const FONTS = {
  body: '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
};

export const SPACING = { s: 8, m: 12, l: 16, xl: 24 };

export const MOTION = {
  fast: "120ms cubic-bezier(.2,.7,.4,1)",
  normal: "200ms cubic-bezier(.2,.7,.4,1)",
};

// 포커스 링·슬라이더 모양·스크롤바. 전역 CSS 에 기대지 않도록 화면 안에서만 건다.
export const SCREEN_CSS = `
.character-creator { color: ${BASE_COLORS.text}; font-family: ${FONTS.body}; }
.character-creator *:focus-visible { outline: 2px solid ${BASE_COLORS.accent}; outline-offset: 3px; border-radius: 8px; }
.character-creator button:hover:not(:disabled) { color: #fff; }
.character-creator input[type="range"] { -webkit-appearance: none; appearance: none; width: 100%; height: 22px; background: none; cursor: pointer; }
/* 눈금 슬라이더 — 칸이 다섯이라 자리를 점으로 보여 준다. datalist 기본 눈금은 브라우저마다 달라
   트랙에 반복 그라디언트로 직접 찍는다. 점 간격은 칸 사이(25%)와 같다. */
.character-creator input[type="range"]::-webkit-slider-runnable-track {
  height: 3px; border-radius: 2px;
  background:
    radial-gradient(circle at center, rgba(255,255,255,0.42) 1.6px, rgba(0,0,0,0) 1.7px) 0 50% / 25% 100% repeat-x,
    rgba(255,255,255,0.16);
}
.character-creator input[type="range"] + datalist { display: none; }
.character-creator input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 15px; height: 15px; margin-top: -6px; border-radius: 50%; background: ${BASE_COLORS.accent}; box-shadow: 0 0 0 4px rgba(154,216,232,0.16); transition: box-shadow ${MOTION.fast}; }
.character-creator input[type="range"]:hover::-webkit-slider-thumb { box-shadow: 0 0 0 7px rgba(154,216,232,0.20); }
.character-creator input[type="range"]::-moz-range-track { height: 3px; border-radius: 2px; background: rgba(255,255,255,0.16); }
.character-creator input[type="range"]::-moz-range-thumb { width: 15px; height: 15px; border: none; border-radius: 50%; background: ${BASE_COLORS.accent}; }
.character-creator ::-webkit-scrollbar { width: 8px; }
.character-creator ::-webkit-scrollbar-thumb { background: rgba(154,216,232,0.22); border-radius: 4px; }
.character-creator ::-webkit-scrollbar-track { background: transparent; }
@media (prefers-reduced-motion: reduce) {
  .character-creator *, .character-creator *::before, .character-creator *::after { transition-duration: 1ms !important; animation-duration: 1ms !important; }
}
`;

// 심장박동 선의 훑는 빛. 웹사이트의 전역 CSS 는 이 앱에 없어 여기서 따로 건다.
export const HEARTBEAT_LINE_CSS = `
.heartbeat-line__glow, .heartbeat-line__glow-blur {
  stroke-dasharray: 13 87;
  animation-name: heartbeat-line-sweep;
  animation-timing-function: cubic-bezier(0.45, 0, 0.3, 1);
  animation-iteration-count: infinite;
}
.heartbeat-line__glow-blur { opacity: 0.55; }
@keyframes heartbeat-line-sweep {
  0%   { stroke-dashoffset: 100; opacity: 0; }
  6%   { opacity: 1; }
  88%  { opacity: 1; }
  100% { stroke-dashoffset: -13; opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .heartbeat-line__glow, .heartbeat-line__glow-blur { animation: none; opacity: 0; }
}
`;

// 이 화면만의 색 — 검정·흰색 위주. 고른 것 = 흰 테두리 + 옅은 흰 바탕, 주 단추 = 흰 바탕 검은 글. 청록은 쓰지 않는다.
export const COLORS = {
  ...BASE_COLORS,
  text: "#F5F6F7",
  textMuted: "rgba(245,246,247,0.72)",
  textFaint: "rgba(245,246,247,0.46)",
  accent: "#FFFFFF",
  accentStrong: "rgba(245,246,247,0.55)",
  line: "rgba(255,255,255,0.10)",
};

export const WHITE = "#ffffff";

export const smallTextStyle: CSSProperties = { font: `400 12.5px/1.5 ${FONTS.body}`, color: COLORS.textFaint };
export const stepNumberStyle: CSSProperties = { font: `600 12px/1 ${FONTS.mono}`, letterSpacing: "0.1em" };

export const tileStyle: CSSProperties = {
  appearance: "none",
  position: "relative",
  boxSizing: "border-box",
  // 축약형 border 를 쓰지 않는다 — 고른 칸이 borderColor 만 바꿀 때 React 가 경고하고 테가 지워진다
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(255,255,255,0.16)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.03)",
  color: COLORS.textMuted,
  font: `500 14px/1.3 ${FONTS.body}`,
  cursor: "pointer",
  transition: `border-color ${MOTION.fast}, background ${MOTION.fast}, color ${MOTION.fast}, transform ${MOTION.fast}`,
};
export const selectedTileStyle: CSSProperties = {
  borderColor: COLORS.accent,
  background: "rgba(255,255,255,0.12)",
  color: "#fff",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.25) inset",
};
export const cardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(116px, 1fr))",
  gap: SPACING.m,
};

export const textButtonStyle: CSSProperties = {
  appearance: "none",
  border: "none",
  background: "none",
  padding: "8px 10px",
  borderRadius: 6,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: COLORS.textMuted,
  font: `500 13px/1 ${FONTS.body}`,
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: `color ${MOTION.fast}, background ${MOTION.fast}`,
};

// 호버하면 위에서 아래로 빛이 번지는 그라데이션이 얹힌다(SCREEN_HOVER_CSS ::before)
export const backButtonStyle: CSSProperties = {
  appearance: "none",
  position: "relative",
  overflow: "hidden",
  isolation: "isolate",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(255,255,255,0.16)",
  borderRadius: 10,
  padding: "0 26px",
  height: 50,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  background: "linear-gradient(180deg, rgba(52,56,62,0.95) 0%, rgba(30,33,37,0.98) 100%)",
  color: COLORS.text,
  font: `700 15px/1 ${FONTS.body}`,
  letterSpacing: "0.04em",
  cursor: "pointer",
  transition: `border-color ${MOTION.normal}, box-shadow ${MOTION.normal}, transform ${MOTION.fast}`,
};
export const confirmButtonStyle: CSSProperties = {
  ...backButtonStyle,
  borderColor: "rgba(255,255,255,0.6)",
  padding: "0 32px",
  height: 52,
  background: "linear-gradient(180deg, #FFFFFF 0%, #E4E6E9 100%)",
  color: "#0A0B0D",
  font: `800 16px/1 ${FONTS.body}`,
  boxShadow: "0 8px 28px rgba(255,255,255,0.18)",
};

// 이 화면 전용 호버 반응 — 인라인 스타일로는 :hover 를 못 건다.
// 그라데이션은 부드럽게 안 넘어가서 가상 요소를 깔고 투명도만 바꾼다.
export const SCREEN_HOVER_CSS = `
.character-creator .character-creator__tile:hover:not(:disabled):not([aria-pressed="true"]) { border-color: rgba(255,255,255,0.38); background: rgba(255,255,255,0.06); color: #fff; }
.character-creator .character-creator__tile:active:not(:disabled) { transform: translateY(1px); }
.character-creator .character-creator__tile:disabled { opacity: 0.5; cursor: progress; }
.character-creator .color-picker__swatch:hover { transform: translateY(-1px); }
.character-creator .view-switcher__option:hover:not([aria-pressed="true"]) { color: #fff; }
.character-creator .character-creator__text-button:hover:not(:disabled) { color: #fff; background: rgba(255,255,255,0.06); }
.character-creator .character-creator__text-button:disabled { opacity: 0.35; cursor: default; }
.character-creator .character-creator__back-button::before, .character-creator .character-creator__confirm-button::before, .character-creator .character-creator__tile::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; z-index: -1;
  opacity: 0; transition: opacity 220ms ease; pointer-events: none;
}
.character-creator .character-creator__back-button::before { background: linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0) 100%); }
.character-creator .character-creator__confirm-button::before { background: linear-gradient(135deg, #FFFFFF 0%, #CDD3DA 100%); }
.character-creator .character-creator__tile::before { background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 70%); }
.character-creator .character-creator__back-button:hover::before, .character-creator .character-creator__confirm-button:hover:not(:disabled)::before, .character-creator .character-creator__tile:hover:not(:disabled)::before { opacity: 1; }
.character-creator .character-creator__back-button:hover { border-color: rgba(255,255,255,0.4); }
.character-creator .character-creator__confirm-button:hover:not(:disabled) { box-shadow: 0 10px 34px rgba(255,255,255,0.28); }
.character-creator .character-creator__back-button:active, .character-creator .character-creator__confirm-button:active:not(:disabled) { transform: translateY(1px); }
.character-creator .character-creator__tile { isolation: isolate; overflow: hidden; }
.character-creator .character-creator__confirm-button:disabled { cursor: progress; filter: saturate(0.6); }
.character-creator input[type="text"]:focus, .character-creator input:not([type]):focus { border-color: ${COLORS.accent}; box-shadow: 0 0 0 3px rgba(255,255,255,0.14); outline: none; }
.character-creator .tick-slider .tick-slider__step-buttons { opacity: 0.45; transition: opacity 160ms; }
.character-creator *:focus-visible { outline-color: #FFFFFF; }
.character-creator input[type="range"]::-webkit-slider-thumb { background: #FFFFFF; box-shadow: 0 0 0 4px rgba(255,255,255,0.14); }
.character-creator input[type="range"]:hover::-webkit-slider-thumb { box-shadow: 0 0 0 7px rgba(255,255,255,0.16); }
.character-creator input[type="range"]::-moz-range-thumb { background: #FFFFFF; }
.character-creator .tick-slider:hover .tick-slider__step-buttons, .character-creator .tick-slider:focus-within .tick-slider__step-buttons { opacity: 1; }
`;

// 화면 틀(배경 · 패널 · 무대)
// 웹사이트 「게임 영상」 카드의 수사 책상. 공용 public 에 두어 본편·naju01 어디서 떠도 같은 주소로 읽힌다.
const BACKGROUND_IMAGE = `${THUMBNAIL_DIR}/bg-investigation.webp`;

export const rootStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
  background: "#05080D",
};

// 크게 흐리고 어둡게. 가장자리가 흐림에 씻겨 하얗게 뜨지 않게 조금 키운다
export const backgroundImageStyle: CSSProperties = {
  position: "absolute",
  inset: -24,
  background: `url("${BACKGROUND_IMAGE}") center / cover no-repeat`,
  filter: "blur(7px) brightness(0.62) saturate(0.95)",
  transform: "scale(1.04)",
};
// 패널 둘레를 더 어둡게 눌러 창이 떠 보이게
export const backgroundShadeStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: [
    "radial-gradient(80% 70% at 50% 50%, rgba(5,9,15,0) 0%, rgba(5,9,15,0.55) 100%)",
    "linear-gradient(180deg, rgba(5,9,15,0.4) 0%, rgba(5,9,15,0) 22%, rgba(5,9,15,0) 78%, rgba(5,9,15,0.45) 100%)",
  ].join(","),
};

export const panelStyle: CSSProperties = {
  position: "absolute",
  background: "linear-gradient(180deg, rgba(16,18,21,0.84) 0%, rgba(10,11,13,0.9) 100%)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: 6,
  boxShadow: "0 40px 120px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
};

export const stageStyle: CSSProperties = {
  position: "absolute",
  borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.14)",
  background:
    "radial-gradient(70% 60% at 50% 42%, rgba(70,76,84,0.38) 0%, rgba(24,27,31,0.18) 70%, rgba(8,14,22,0) 100%)",
  overflow: "hidden",
};
export const stageFloorGlowStyle: CSSProperties = {
  position: "absolute",
  left: "18%",
  right: "18%",
  bottom: 70,
  height: 46,
  borderRadius: "50%",
  background: "radial-gradient(50% 50% at 50% 50%, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 100%)",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.12)",
};

export const stageTagStyle: CSSProperties = {
  font: `600 11px/1 ${FONTS.mono}`,
  letterSpacing: "0.22em",
  color: COLORS.accentStrong,
};
