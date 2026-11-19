/** 모바일 배치 공용 값 — 글자 15~16px, 입력 16px(아이폰 자동 확대 방지), 누르는 곳 48px, 안전 영역 */
import type { CSSProperties } from "react";

import { FONT } from "@/lib/style";
import { COLOR, GRADIENT, SHADOW } from "@/styles/tokens";

export const MOBILE_HEADER_HEIGHT = 56;
export const GUTTER = 20;
/** 태블릿 세로에서 글줄이 너무 길어지지 않게 가운데 폭을 묶는다 */
export const CONTENT_MAX_WIDTH = 640;

export const safeTop = (extra = 0) => `calc(env(safe-area-inset-top, 0px) + ${extra}px)`;
export const safeBottom = (extra = 0) => `calc(env(safe-area-inset-bottom, 0px) + ${extra}px)`;

export const sectionStyle: CSSProperties = {
  width: "100%",
  maxWidth: `${CONTENT_MAX_WIDTH}px`,
  margin: "0 auto",
  padding: `0 ${GUTTER}px`,
  boxSizing: "border-box",
};

export const eyebrowStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "12px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: COLOR.accent,
  margin: 0,
};

export const headingStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontSize: "30px",
  lineHeight: 1.2,
  color: COLOR.textBright,
  margin: "8px 0 0",
  wordBreak: "keep-all",
};

export const bodyTextStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontSize: "16px",
  lineHeight: 1.6,
  color: COLOR.textMuted,
  margin: "12px 0 0",
};

export const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "48px",
  padding: "0 22px",
  borderRadius: "999px",
  backgroundImage: GRADIENT.navyButton("166deg"),
  boxShadow: SHADOW.pillGlowSoft,
  color: COLOR.white,
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "15px",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

export const secondaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  backgroundImage: "none",
  background: "transparent",
  border: `1px solid ${COLOR.border}`,
  boxShadow: "none",
  color: COLOR.textBright,
};

export const cardStyle: CSSProperties = {
  background: COLOR.glass,
  border: `1px solid ${COLOR.border}`,
  borderRadius: "16px",
  padding: "20px",
  boxSizing: "border-box",
};
