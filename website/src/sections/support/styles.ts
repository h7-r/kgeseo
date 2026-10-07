import type { CSSProperties } from "react";

import { FONT, type CSSVars } from "@/lib/style";
import { COLOR, GRADIENT } from "@/styles/tokens";

export const ACTIVE_TAB_BACKGROUND = GRADIENT.navyButton("133.605deg");

export const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "24px",
  padding: "32px 0",
  borderRadius: "16px",
  background: COLOR.lightPanel,
  border: `1px solid ${COLOR.lightDivider}`,
  boxShadow: "0px 8px 32px 0px rgba(20,30,60,0.06)",
  width: "100%",
  overflow: "hidden",
  boxSizing: "border-box",
};

export const rowCardStyle: CSSProperties = {
  display: "flex",
  gap: "20px",
  alignItems: "center",
  padding: "20px",
  borderRadius: "12px",
  background: COLOR.white,
  border: `1px solid ${COLOR.lightDivider}`,
  boxSizing: "border-box",
};

export const emptyStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "16px",
  color: COLOR.lightTextMuted,
  padding: "12px 0",
};

export const labelStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 400,
  fontSize: "16px",
  color: "#4a5263",
  textTransform: "uppercase",
};

export const fieldTextStyle: CSSVars = {
  fontFamily: FONT.body,
  fontSize: "16px",
  "--hint-color": "rgba(26,26,31,0.5)",
};
