import type { CSSProperties } from "react";

/** 여러 화면이 함께 쓰는 색·그라디언트·그림자. 한두 곳에서만 쓰는 값은 그 자리에 둔다. */
export const COLOR = {
  bg: "#01040a",
  white: "#ffffff",
  black: "#000000",

  textBright: "#f1f1fc",
  textMuted: "#96a3b6",
  textSubtle: "#8b93a3",
  textDim: "#6f7a8c",
  accent: "#6f86bf",

  navy: "#2e4889",
  navyDeep: "#2f3e70",
  navyMuted: "#3a5794",
  blue: "#3b5ea2",
  blueMid: "#325296",
  border: "#1a305f",
  surface: "#050b1a",
  glass: "rgba(9,15,32,0.75)",
  arc: "#92979f",

  danger: "#f87171",
  success: "#4ade80",
  warning: "#fbbf24",

  // 흰 면(게임 소개·고객센터)
  lightText: "#1a1a1f",
  lightTextMuted: "#5f6878",
  lightBorder: "#d9dee5",
  lightDivider: "#e3e7ee",
  lightSurface: "#f2f5f7",
  lightPanel: "#f7f9fc",
} as const;

/** 단추마다 각도만 다르게 쓰는 그라디언트는 각도를 받는다. */
export const GRADIENT = {
  pillButton: (angle: string) => `linear-gradient(${angle}, rgb(47,66,123) 0%, rgb(47,62,112) 50%, rgb(44,56,99) 100%)`,
  navyButton: (angle: string) =>
    `linear-gradient(${angle}, rgb(46,72,137) 0%, rgb(54,64,143) 45%, rgb(43,71,143) 100%)`,
  navyFill: "linear-gradient(135deg, rgb(46,72,137) 0%, rgb(54,64,143) 100%)",
  cardDark: "linear-gradient(180deg, #081228 0%, #01040a 100%)",

  titleBlue: "linear-gradient(90deg, #325296 0%, #3b5ea2 50%, #2e4889 100%)",
  titleNavy: "linear-gradient(90deg, #3b5ea2 0%, #2e4889 50%, #2f3e70 100%)",
  titleFrost: "linear-gradient(90deg, #e1ebf8 0%, #325296 55%, #2e4889 100%)",
  titleFade: "linear-gradient(180deg, #ffffff 0%, #3b5ea2 100%)",
} as const;

export const SHADOW = {
  pillGlow: "0px 0px 48px 0px rgba(50,82,150,0.25), 0px 4px 20px 0px rgba(46,72,137,0.45)",
  pillGlowWide: "0px 0px 48px 8px rgba(50,82,150,0.25), 0px 4px 20px 0px rgba(46,72,137,0.45)",
  pillGlowSoft: "0px 0px 24px 0px rgba(50,82,150,0.13), 0px 4px 16px 0px rgba(46,72,137,0.31)",
} as const;

/** 남색 테두리를 두른 어두운 판. 카드·배지가 같이 쓴다. */
export const surfaceFillStyle: CSSProperties = { background: COLOR.surface, border: `1px solid ${COLOR.border}` };

/** 구간 머리의 알약 배지. 간격과 여백은 쓰는 쪽이 정한다. */
export const badgePillStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  borderRadius: "20px",
  ...surfaceFillStyle,
};
