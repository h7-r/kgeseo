import { useState, type CSSProperties, type SyntheticEvent } from "react";

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

type CodeBoxesProps = Pick<FieldProps, "value" | "onChange" | "error"> & {
  /** 서버가 이 코드를 틀렸다고 했다. 글은 아래 알림에 있으니 칸만 빨갛게 한다 */
  isRejected?: boolean;
};

/**
 * 인증코드 여섯 칸. 투명한 입력칸 하나를 위에 덮어 한 번에 받는다.
 * 누르고 있으면 다음 숫자가 들어갈 칸 아래에 초록 밑줄(이메일 칸 밑줄과 같은 색), 여섯 자리를 다 채우면 칸 테두리가 초록.
 * 초록은 「여섯 자리가 찼다」는 뜻이고, 맞는 코드인지는 「인증 완료」를 눌러 서버가 정한다 — 틀리면 빨강이 이긴다.
 */
export default function CodeBoxes({ value, onChange, error, isRejected = false }: CodeBoxesProps) {
  const [isFocused, setIsFocused] = useState(false);
  const isComplete = value.length === CODE_LENGTH;
  // 치는 중(칸을 누른 채 아직 덜 참)에는 「6자리」 오류를 잠시 거둔다 — 칸을 벗어나거나 「인증 완료」를 누르면 다시 보인다
  const shownError = isFocused && !isComplete ? "" : error;
  const isRed = Boolean(shownError) || isRejected;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "9px", width: "100%" }}>
      <div style={{ ...fieldLabelStyle, width: "100%" }}>인증코드</div>
      <div style={{ display: "flex", gap: "8px", width: "100%", position: "relative" }}>
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const isNext = isFocused && !isComplete && i === value.length;
          const boxState = isRed ? errorBoxStyle : isComplete ? completeBoxStyle : undefined;
          return (
            <div key={i} style={{ ...emptyBoxStyle, ...boxState }}>
              {value[i] ? (
                <span style={codeDigitStyle}>{value[i]}</span>
              ) : (
                <div style={{ width: "24px", height: "2px", borderRadius: "1px", background: "rgba(50,82,150,0.3)" }} />
              )}
              {isNext && !isRed && <span aria-hidden="true" style={nextUnderlineStyle} />}
            </div>
          );
        })}
        <input
          className="text-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          value={value}
          onChange={(e) => onChange({ target: { value: e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH) } })}
          onFocus={(e) => {
            setIsFocused(true);
            keepCaretAtEnd(e);
          }}
          onSelect={keepCaretAtEnd}
          onBlur={() => setIsFocused(false)}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "text" }}
          aria-label="인증코드"
        />
        {shownError && <span className="form-error">{shownError}</span>}
      </div>
    </div>
  );
}

/**
 * 입력칸이 투명해서 누른 자리에 커서가 놓이면, 첫 칸을 누르고 친 숫자가 앞에 끼어든다.
 * 커서는 늘 끝에 둔다 — 칸은 차례대로만 채우고 지운다.
 */
function keepCaretAtEnd(event: SyntheticEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  const end = input.value.length;
  if (input.selectionStart !== end || input.selectionEnd !== end) input.setSelectionRange(end, end);
}

const emptyBoxStyle: CSSProperties = {
  ...codeBoxBaseStyle,
  position: "relative",
  height: "64px",
  background: COLOR.surface,
  borderWidth: "1px",
  borderStyle: "solid",
  ...borderSides("rgba(50,82,150,0.18)"),
  transition: "border-color 0.18s ease, box-shadow 0.18s ease",
};

// 초록 · 빨강 값은 입력칸 밑줄(forms.css .form-field.is-valid / is-error)과 같다
const GREEN = "rgba(74,222,128,0.6)";
// 둥근 모서리(10px)를 피해 칸 아래 테두리 위에 곧은 선으로 얹는다
const nextUnderlineStyle: CSSProperties = {
  position: "absolute",
  left: "14px",
  right: "14px",
  bottom: "-1px",
  height: "2px",
  borderRadius: "1px",
  background: GREEN,
  boxShadow: "0 1px 0 0 rgba(74,222,128,0.22)",
};
const completeBoxStyle: CSSProperties = borderSides(GREEN);
const errorBoxStyle: CSSProperties = borderSides("rgba(248,113,113,0.55)");

/** 네 변 색을 따로 준다. border 줄임 속성과 borderBottomColor 를 섞으면 React 가 다시 그릴 때 경고한다. */
function borderSides(color: string): CSSProperties {
  return { borderTopColor: color, borderRightColor: color, borderBottomColor: color, borderLeftColor: color };
}

/** 인증이 끝난 코드. 초록 테두리에 숫자가 박혀 있고 전체가 흐리다. */
export function VerifiedCode({ code = "••••••" }: { code?: string }) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "9px", width: "100%", opacity: 0.6, overflow: "hidden" }}
    >
      <div style={{ display: "flex", gap: "8px", width: "100%", fontSize: "16px" }}>
        <span style={{ flex: "1 0 0", fontFamily: FONT.mono, color: COLOR.textMuted }}>인증코드</span>
        <span style={{ flex: "1 0 0", fontFamily: FONT.mono, fontWeight: 700, color: "#33d98c" }}>✓ 인증 완료</span>
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
