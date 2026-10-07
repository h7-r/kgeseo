// 캐릭터 생성 화면의 색·글꼴·간격·모션 토큰과 화면 CSS.
// 배경은 화면 전체에 이어지는 한 덩이라 판을 그리는 색은 거의 없고, 가장자리 명암과 작은 도구 표면만 있다.
import type { CSSProperties } from "react";

export const COLORS = {
  // 배경 — 가장자리에서 캐릭터 뒤로 갈수록 밝아진다
  edge: "#080D15",
  mid: "#142432",
  stage: "#2B4755",
  text: "#F2F4F5",
  textMuted: "#AAB8C4",
  textFaint: "rgba(170,184,196,0.58)",
  // 강조는 선택·현재 상태에만
  accent: "#9AD8E8",
  accentStrong: "#5FB0C8",
  success: "#7FD6A8",
  warning: "#F0C27A",
  error: "#F2938F",
  // 떠 있는 작은 도구 표면
  surface: "rgba(10,20,30,0.55)",
  surfaceStrong: "rgba(8,14,22,0.82)",
  line: "rgba(154,216,232,0.20)",
  lineAccent: "rgba(154,216,232,0.65)",
};

export const FONTS = {
  body: '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
};

export const SPACING = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32, xxxl: 48 };

export const TYPE_SCALE = {
  title: { font: `600 30px/1.25 ${FONTS.body}`, letterSpacing: "-0.01em", color: COLORS.text },
  sectionTitle: { font: `600 19px/1.35 ${FONTS.body}`, color: COLORS.text },
  label: { font: `500 14px/1.4 ${FONTS.body}`, color: COLORS.textMuted },
  body: { font: `400 14px/1.6 ${FONTS.body}`, color: COLORS.textMuted },
  caption: { font: `400 13px/1.6 ${FONTS.body}`, color: COLORS.textFaint },
  // 숫자 폭이 흔들리면 슬라이더를 움직일 때마다 라벨이 덜컹거린다
  number: { font: `500 13px/1 ${FONTS.mono}`, fontVariantNumeric: "tabular-nums", color: COLORS.textMuted },
  // 눈금 이름은 말이라 본문 글꼴, 지금 고른 칸이라 강조색
  tick: { font: `500 13px/1.3 ${FONTS.body}`, color: COLORS.accent },
  step: { font: `500 12px/1 ${FONTS.mono}`, letterSpacing: "0.14em", color: COLORS.textFaint },
} satisfies Record<string, CSSProperties>;

export const MOTION = {
  fast: "120ms cubic-bezier(.2,.7,.4,1)",
  normal: "200ms cubic-bezier(.2,.7,.4,1)",
  slow: "360ms cubic-bezier(.2,.7,.3,1)",
};

// 기본 단추는 테두리가 없다 — 모든 단추에 선을 두르면 화면이 상자로 가득 찬다.
export const buttonStyle: CSSProperties = {
  appearance: "none",
  border: "none",
  background: "none",
  borderRadius: 10,
  padding: "8px 12px",
  color: COLORS.textMuted,
  font: `500 13px/1.3 ${FONTS.body}`,
  cursor: "pointer",
  transition: `color ${MOTION.fast}, background ${MOTION.fast}`,
};

export const selectedButtonStyle: CSSProperties = {
  ...buttonStyle,
  color: "#FFFFFF",
  background: "rgba(154,216,232,0.16)",
};

// 포커스 링·슬라이더 모양·스크롤바. 전역 CSS 에 기대지 않도록 화면 안에서만 건다.
export const SCREEN_CSS = `
.cc-root { color: ${COLORS.text}; font-family: ${FONTS.body}; }
.cc-root *:focus-visible { outline: 2px solid ${COLORS.accent}; outline-offset: 3px; border-radius: 8px; }
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
.cc-root input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 15px; height: 15px; margin-top: -6px; border-radius: 50%; background: ${COLORS.accent}; box-shadow: 0 0 0 4px rgba(154,216,232,0.16); transition: box-shadow ${MOTION.fast}; }
.cc-root input[type="range"]:hover::-webkit-slider-thumb { box-shadow: 0 0 0 7px rgba(154,216,232,0.20); }
.cc-root input[type="range"]::-moz-range-track { height: 3px; border-radius: 2px; background: rgba(255,255,255,0.16); }
.cc-root input[type="range"]::-moz-range-thumb { width: 15px; height: 15px; border: none; border-radius: 50%; background: ${COLORS.accent}; }
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
