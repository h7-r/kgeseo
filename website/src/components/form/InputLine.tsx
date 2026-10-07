import { useState, type CSSProperties, type KeyboardEvent } from "react";

import { useCapsLock, type FieldProps } from "@/hooks/useForm";
import { FONT, type CSSVars } from "@/lib/style";
import { ENGLISH_ONLY_FIELDS, ENGLISH_ONLY_HINT, FIELD_HINTS, PASSWORD_CHECKS, hasHangul } from "@/lib/validation";
import { COLOR } from "@/styles/tokens";

import EyeToggle from "./EyeToggle";
import { inputBoxStyle, type FormVariant } from "./styles";

export type FieldBinding = FieldProps & { onEnter: (event: KeyboardEvent) => void };

export interface InputLineProps extends FieldBinding {
  variant: FormVariant;
  placeholder: string;
  type?: "text" | "password";
  autoComplete?: string;
  inputMode?: "email";
  /** 홈 폼 이메일 칸만 밑 여백이 다르다. */
  paddingBottom?: number;
  /** 로그인 비밀번호처럼 규칙 목록을 보이지 않을 칸. */
  hideRules?: boolean;
  typo?: string;
}

type SideMessageKind = "" | "is-warning" | "is-checking";

/**
 * 입력칸 하나. 오류면 밑줄 빨강, 맞으면 초록 ✓, 오른쪽엔 급한 안내 하나만
 * (한글 입력 → Caps Lock → 중복 확인 중 순). 칸 안내·비밀번호 규칙은 인증 카드에만 있다.
 */
export default function InputLine({
  variant,
  name,
  placeholder,
  type = "text",
  value,
  onChange,
  onBlur,
  error,
  isValid,
  isChecking,
  maxLength,
  onEnter,
  autoComplete,
  inputMode,
  paddingBottom = 9,
  hideRules,
  typo,
}: InputLineProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const capsLock = useCapsLock();
  const isCard = variant === "card";
  const isPassword = type === "password";
  // 영문만 받는 칸에 한글을 치면 다 치기 전에 알려 준다.
  const hasHangulWarning = ENGLISH_ONLY_FIELDS.has(name) && hasHangul(value);

  const sideMessage: { text: string; kind: SideMessageKind } | null = hasHangulWarning
    ? { text: ENGLISH_ONLY_HINT, kind: "" }
    : isPassword && capsLock.isOn && isFocused
      ? { text: "Caps Lock 켜짐", kind: "is-warning" }
      : isChecking
        ? { text: "확인 중…", kind: "is-checking" }
        : null;
  const status = error || hasHangulWarning ? "field--error" : isValid ? "field--valid" : "";
  // 눈 단추가 있으면 오른쪽 안내·✓ 를 그만큼 비켜 둔다.
  const sideRight = isPassword ? (isCard ? "40px" : "28px") : "0";
  const validRight = isPassword ? (isCard ? "40px" : "30px") : "6px";

  const boxStyle: CSSProperties = isCard
    ? { ...inputBoxStyle.card, position: "relative", paddingRight: isPassword ? "40px" : "32px" }
    : { ...inputBoxStyle.home, paddingBottom: `${paddingBottom}px`, position: "relative" };
  const eye = isPassword && (
    <EyeToggle variant={variant} isRevealed={isRevealed} onToggle={() => setIsRevealed((v) => !v)} />
  );

  const hint = isCard ? FIELD_HINTS[name] : undefined;
  const showsRules = isCard && !hideRules && (name === "password" || name === "newPassword");
  // 오류가 떠 있으면 오류가 우선이다.
  const showsHint =
    isFocused &&
    !error &&
    !hasHangulWarning &&
    !typo &&
    Boolean(hint) &&
    !(showsRules && value) &&
    !(name === "password" && hideRules);

  return (
    // 홈 폼은 눈 단추를 밑줄 칸 밖에 둔다. 칸 안에 두면 밑줄 1px 만큼 반 픽셀 어긋난다.
    <div style={isCard ? cardWrapperStyle : homeWrapperStyle}>
      <div className={`underline-field ${status}`} style={boxStyle}>
        <input
          className="input"
          type={isPassword && !isRevealed ? "password" : "text"}
          name={name}
          placeholder={placeholder}
          value={value}
          maxLength={maxLength}
          onChange={onChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            setIsFocused(false);
            capsLock.reset();
            onBlur();
          }}
          onKeyDown={(e) => {
            capsLock.detect(e);
            onEnter(e);
          }}
          onKeyUp={capsLock.detect}
          // 비밀번호 관리자가 알아보게 한다.
          autoComplete={autoComplete ?? (isPassword ? "new-password" : undefined)}
          inputMode={inputMode}
          // 맞춤법 검사·첫 글자 대문자 변환이 끼어들면 이메일·비밀번호 값이 바뀐다.
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={Boolean(error || hasHangulWarning)}
          aria-describedby={error ? `error-${name}` : undefined}
          style={inputTextStyle}
        />
        {sideMessage && (
          <span className={`field-hint ${sideMessage.kind}`} style={{ right: sideRight }}>
            {sideMessage.text}
          </span>
        )}
        {!sideMessage && isValid && (
          <span className="valid-mark" aria-hidden="true" style={{ right: validRight }}>
            ✓
          </span>
        )}
        {isCard && eye}
      </div>
      {!isCard && eye}

      {/* 떠 있는 글은 다음 칸 라벨과 겹친다. 흐름 안에서 높이만큼 열어 아래 칸을 민다. */}
      {hint && (
        <div className={`hint-collapse${showsHint ? " is-open" : ""}`} aria-hidden={!showsHint}>
          <div>
            <span className="hint" style={{ fontFamily: FONT.mono }}>
              {hint}
            </span>
          </div>
        </div>
      )}

      {showsRules && (isFocused || value) && (
        <div className="password-rules" style={{ fontFamily: FONT.mono }}>
          {PASSWORD_CHECKS.map(({ label, test }) => (
            <span key={label} className={test(value) ? "is-valid" : undefined}>
              <span aria-hidden="true">{test(value) ? "✓" : "○"}</span>
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const inputTextStyle: CSSVars = {
  fontFamily: FONT.body,
  fontWeight: 400,
  fontSize: "18px",
  "--hint-color": COLOR.textDim,
};

const cardWrapperStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "10px", width: "100%" };
const homeWrapperStyle: CSSProperties = { position: "relative" };
