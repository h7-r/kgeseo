import type { CSSProperties } from "react";

import { fieldLabelStyle } from "@/components/form/formStyles";
import type { FieldProps } from "@/hooks/useForm";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

const CODE_LENGTH = 6;

const codeBoxBaseStyle: CSSProperties = {
  flex: "1 0 0",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "10px",
  boxSizing: "border-box",
};

const codeDigitStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 600,
  fontSize: "24px",
  color: COLOR.textBright,
};

type CodeBoxesProps = Pick<FieldProps, "value" | "onChange" | "error">;

/** 인증코드 여섯 칸. 투명한 입력칸 하나를 위에 덮어 한 번에 받는다. */
export default function CodeBoxes({ value, onChange, error }: CodeBoxesProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "9px", width: "100%" }}>
      <div style={{ ...fieldLabelStyle, width: "100%" }}>인증코드</div>
      <div style={{ display: "flex", gap: "8px", width: "100%", position: "relative" }}>
        {Array.from({ length: CODE_LENGTH }, (_, i) => (
          <div key={i} style={{ ...emptyBoxStyle, ...(error ? { borderColor: "rgba(248,113,113,0.55)" } : {}) }}>
            {value[i] ? (
              <span style={codeDigitStyle}>{value[i]}</span>
            ) : (
              <div style={{ width: "24px", height: "2px", borderRadius: "1px", background: "rgba(50,82,150,0.3)" }} />
            )}
          </div>
        ))}
        <input
          className="text-input"
          inputMode="numeric"
          maxLength={CODE_LENGTH}
          value={value}
          onChange={(e) => onChange({ target: { value: e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH) } })}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "text" }}
          aria-label="인증코드"
        />
        {error && <span className="form-error">{error}</span>}
      </div>
    </div>
  );
}

const emptyBoxStyle: CSSProperties = {
  ...codeBoxBaseStyle,
  height: "64px",
  background: COLOR.surface,
  border: "1px solid rgba(50,82,150,0.18)",
};

/** 인증이 끝난 코드. 초록 테두리에 숫자가 박혀 있고 전체가 흐리다. */
export function VerifiedCode({ code = "------" }: { code?: string }) {
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
