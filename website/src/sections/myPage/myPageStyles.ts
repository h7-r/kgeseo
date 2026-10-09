import type { CSSProperties } from "react";

import { BUTTON_GRADIENT, modalPrimaryStyle } from "@/components/modalButtonStyles";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

export const modalDangerStyle: CSSProperties = {
  ...modalPrimaryStyle,
  backgroundImage: "none",
  background: "#7f1d1d",
  borderColor: "#b91c1c",
};

export const profileStartStyle: CSSProperties = {
  padding: "14px 28px",
  borderRadius: "100px",
  border: "1px solid rgba(59,94,162,0.5)",
  backgroundImage: BUTTON_GRADIENT,
  boxShadow: "0 0 24px rgba(50,82,150,0.3)",
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  color: COLOR.white,
  whiteSpace: "nowrap",
  cursor: "pointer",
};

export const darkRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "18px 20px",
  borderRadius: "10px",
  background: "#121219",
  width: "100%",
  boxSizing: "border-box",
};

export const darkCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: "24px",
  borderRadius: "12px",
  background: "#121219",
  width: "100%",
  boxSizing: "border-box",
};

export const subheadingStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  color: COLOR.accent,
};
export const labelTextStyle: CSSProperties = { fontFamily: FONT.mono, fontSize: "16px", color: COLOR.textMuted };
export const valueTextStyle: CSSProperties = { fontFamily: FONT.mono, fontSize: "16px", color: COLOR.textBright };
export const strongValueTextStyle: CSSProperties = { ...valueTextStyle, fontWeight: 700 };
