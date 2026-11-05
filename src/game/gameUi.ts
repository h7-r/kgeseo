import type { CSSProperties } from "react";

/** 게임 화면 위 UI 의 색·글꼴. 웹사이트(website/src/styles/tokens.ts)와 같은 값이라 같은 서비스로 읽힌다. */
export const UI = {
  surface: "#050b1a",
  surfaceRaised: "#0a1428",
  surfaceHover: "#101d38",
  glass: "rgba(5,11,26,.86)",
  border: "#1a305f",
  borderStrong: "#3a5794",
  text: "#f1f1fc",
  textMuted: "#c6cfdd",
  textSubtle: "#a4adbd",
  accent: "#86a6f0",
  navy: "#2e4889",
  success: "#4ade80",
  danger: "#f87171",
} as const;

export const UI_FONT = {
  title: '"Paperlogy", "IBM Plex Sans KR", sans-serif',
  body: '"IBM Plex Sans KR", "Apple SD Gothic Neo", system-ui, sans-serif',
  mono: '"IBM Plex Mono", "IBM Plex Sans KR", ui-monospace, monospace',
} as const;

export const NAVY_FILL = "linear-gradient(166deg, rgb(46,72,137) 0%, rgb(54,64,143) 45%, rgb(43,71,143) 100%)";
export const PANEL_SHADOW = "0 18px 48px rgba(1,4,10,.62)";
/** 위 알약 단추들(높이 42 · 위 16) 아래에서 창이 시작하는 자리 */
export const DOCK_TOP = 70;
export const DOCK_EDGE = 16;

/** 키 표시 하나. 어느 안내에서나 같은 모양이어야 같은 조작으로 읽힌다. */
export const keyCapStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 26,
  height: 26,
  padding: "0 8px",
  boxSizing: "border-box",
  borderRadius: 6,
  background: UI.surfaceHover,
  border: `1px solid ${UI.borderStrong}`,
  boxShadow: `0 2px 0 ${UI.border}`,
  color: UI.text,
  font: `600 12px/1 ${UI_FONT.mono}`,
};
