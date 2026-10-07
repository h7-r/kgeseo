import type { CSSProperties } from "react";

import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

import { codeBoxBaseStyle, codeDigitStyle } from "./codeBoxStyles";

/** 인증이 끝난 코드. 초록 테두리에 숫자가 박혀 있고 전체가 흐리다. */
export default function VerifiedCode({ code = "------" }: { code?: string }) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "9px", width: "100%", opacity: 0.6, overflow: "hidden" }}
    >
      <div style={{ display: "flex", gap: "8px", width: "100%", fontSize: "16px" }}>
        <span style={{ flex: "1 0 0", fontFamily: FONT.mono, color: COLOR.textMuted }}>인증코드</span>
        <span style={{ flex: "1 0 0", fontFamily: FONT.mono, fontWeight: 700, color: "#33d98c" }}>✓ 인증완료</span>
      </div>
      <div style={{ display: "flex", gap: "10px", width: "100%" }}>
        {code.split("").map((digit, i) => (
          <div key={i} style={filledBoxStyle}>
            <span style={codeDigitStyle}>{digit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const filledBoxStyle: CSSProperties = {
  ...codeBoxBaseStyle,
  padding: "16px 0",
  background: "#091126",
  border: "1px solid rgba(51,166,115,0.4)",
};
