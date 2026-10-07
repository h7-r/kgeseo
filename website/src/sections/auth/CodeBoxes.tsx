import type { CSSProperties } from "react";

import { fieldLabelStyle } from "@/components/form/styles";
import type { FieldProps } from "@/hooks/useForm";
import { COLOR } from "@/styles/tokens";

import { codeBoxBaseStyle, codeDigitStyle } from "./codeBoxStyles";

const CODE_LENGTH = 6;

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
          className="input"
          inputMode="numeric"
          maxLength={CODE_LENGTH}
          value={value}
          onChange={(e) => onChange({ target: { value: e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH) } })}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "text" }}
          aria-label="인증코드"
        />
        {error && <span className="error-text">{error}</span>}
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
