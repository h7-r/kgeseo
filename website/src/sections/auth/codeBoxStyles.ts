import type { CSSProperties } from "react";

import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

export const codeBoxBaseStyle: CSSProperties = {
  flex: "1 0 0",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "10px",
  boxSizing: "border-box",
};

export const codeDigitStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 600,
  fontSize: "24px",
  color: COLOR.textBright,
};
