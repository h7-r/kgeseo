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
.cc-root { color: ${BASE_COLORS.text}; font-family: ${FONTS.body}; }
.cc-root *:focus-visible { outline: 2px solid ${BASE_COLORS.accent}; outline-offset: 3px; border-radius: 8px; }
.cc-root button:hover:not(:disabled) { color: #fff; }
.cc-root .cc-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 14px 34px rgba(111,192,214,0.3); }
.cc-root .cc-primary:active:not(:disabled) { transform: translateY(0); }
.cc-root input[type="range"] { -webkit-appearance: none; appearance: none; width: 100%; height: 22px; background: none; cursor: pointer; }
/* 눈금 슬라이더 — 칸이 다섯이라 자리를 점으로 보여 준다. datalist 기본 눈금은 브라우저마다 달라
   트랙에 반복 그라디언트로 직접 찍는다. 점 간격은 칸 사이(25%)와 같다. */
.cc-root input[type="range"]::-webkit-slider-runnable-track {
  height: 3px; border-radius: 2px;
  background:
    radial-gradient(circle at center, rgba(255,255,255,0.42) 1.6px, rgba(0,0,0,0) 1.7px) 0 50% / 25% 100% repeat-x,
    rgba(255,255,255,0.16);
}
.cc-root input[type="range"] + datalist { display: none; }
.cc-root input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 15px; height: 15px; margin-top: -6px; border-radius: 50%; background: ${BASE_COLORS.accent}; box-shadow: 0 0 0 4px rgba(154,216,232,0.16); transition: box-shadow ${MOTION.fast}; }
.cc-root input[type="range"]:hover::-webkit-slider-thumb { box-shadow: 0 0 0 7px rgba(154,216,232,0.20); }
.cc-root input[type="range"]::-moz-range-track { height: 3px; border-radius: 2px; background: rgba(255,255,255,0.16); }
.cc-root input[type="range"]::-moz-range-thumb { width: 15px; height: 15px; border: none; border-radius: 50%; background: ${BASE_COLORS.accent}; }
.cc-root ::-webkit-scrollbar { width: 8px; }
.cc-root ::-webkit-scrollbar-thumb { background: rgba(154,216,232,0.22); border-radius: 4px; }
.cc-root ::-webkit-scrollbar-track { background: transparent; }
@media (prefers-reduced-motion: reduce) {
  .cc-root *, .cc-root *::before, .cc-root *::after { transition-duration: 1ms !important; animation-duration: 1ms !important; }
}
`;

// 심장박동 선의 훑는 빛. 웹사이트 CSS(.pulse-light)는 이 앱에 없어 여기서 따로 건다.
export const HEARTBEAT_LINE_CSS = `
.cc-pulse-light, .cc-pulse-blur {
  stroke-dasharray: 13 87;
  animation-name: cc-pulse-flow;
  animation-timing-function: cubic-bezier(0.45, 0, 0.3, 1);
  animation-iteration-count: infinite;
}
.cc-pulse-blur { opacity: 0.55; }
@keyframes cc-pulse-flow {
  0%   { stroke-dashoffset: 100; opacity: 0; }
  6%   { opacity: 1; }
  88%  { opacity: 1; }
  100% { stroke-dashoffset: -13; opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .cc-pulse-light, .cc-pulse-blur { animation: none; opacity: 0; }
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
.cc-root .cc-tile:hover:not(:disabled):not([aria-pressed="true"]) { border-color: rgba(255,255,255,0.38); background: rgba(255,255,255,0.06); color: #fff; }
.cc-root .cc-tile:active:not(:disabled) { transform: translateY(1px); }
.cc-root .cc-tile:disabled { opacity: 0.5; cursor: progress; }
.cc-root .cc-swatch:hover { transform: translateY(-1px); }
.cc-root .cc-segment:hover:not([aria-pressed="true"]) { color: #fff; }
.cc-root .cc-text-button:hover:not(:disabled) { color: #fff; background: rgba(255,255,255,0.06); }
.cc-root .cc-text-button:disabled { opacity: 0.35; cursor: default; }
.cc-root .cc-back::before, .cc-root .cc-confirm::before, .cc-root .cc-tile::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; z-index: -1;
  opacity: 0; transition: opacity 220ms ease; pointer-events: none;
}
.cc-root .cc-back::before { background: linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0) 100%); }
.cc-root .cc-confirm::before { background: linear-gradient(135deg, #FFFFFF 0%, #CDD3DA 100%); }
.cc-root .cc-tile::before { background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 70%); }
.cc-root .cc-back:hover::before, .cc-root .cc-confirm:hover:not(:disabled)::before, .cc-root .cc-tile:hover:not(:disabled)::before { opacity: 1; }
.cc-root .cc-back:hover { border-color: rgba(255,255,255,0.4); }
.cc-root .cc-confirm:hover:not(:disabled) { box-shadow: 0 10px 34px rgba(255,255,255,0.28); }
.cc-root .cc-back:active, .cc-root .cc-confirm:active:not(:disabled) { transform: translateY(1px); }
.cc-root .cc-tile { isolation: isolate; overflow: hidden; }
.cc-root .cc-confirm:disabled { cursor: progress; filter: saturate(0.6); }
.cc-root input[type="text"]:focus, .cc-root input:not([type]):focus { border-color: ${COLORS.accent}; box-shadow: 0 0 0 3px rgba(255,255,255,0.14); outline: none; }
.cc-root .cc-slider-row .cc-fine { opacity: 0.45; transition: opacity 160ms; }
.cc-root *:focus-visible { outline-color: #FFFFFF; }
.cc-root input[type="range"]::-webkit-slider-thumb { background: #FFFFFF; box-shadow: 0 0 0 4px rgba(255,255,255,0.14); }
.cc-root input[type="range"]:hover::-webkit-slider-thumb { box-shadow: 0 0 0 7px rgba(255,255,255,0.16); }
.cc-root input[type="range"]::-moz-range-thumb { background: #FFFFFF; }
.cc-root .cc-slider-row:hover .cc-fine, .cc-root .cc-slider-row:focus-within .cc-fine { opacity: 1; }
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
