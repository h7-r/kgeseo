import type { CSSProperties } from "react";

import { FONT } from "@/lib/style";
import { computePasswordStrength, type FieldName } from "@/lib/validation";
import { COLOR } from "@/styles/tokens";

import InputLine, { type InputLineProps } from "./InputLine";
import { fieldLabelStyle } from "./formStyles";

interface TextFieldProps extends InputLineProps {
  label: string;
  /** 가로로 나란히 놓인 칸. 남은 폭을 나눠 갖는다. */
  grow?: boolean;
  dimmed?: boolean;
  onFixTypo?: () => void;
}

/** 라벨 줄 + 입력칸. */
export default function TextField({ label, grow, dimmed, onFixTypo, ...inputProps }: TextFieldProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "9px",
        width: "100%",
        ...(grow ? { flex: "1 0 0", minWidth: 0, alignSelf: "stretch" } : {}),
        ...(dimmed ? { opacity: 0.5 } : {}),
      }}
    >
      <LabelRow
        label={label}
        name={inputProps.name}
        error={inputProps.error}
        typo={inputProps.typo}
        onFixTypo={onFixTypo}
      />
      <InputLine {...inputProps} />
    </div>
  );
}

interface LabelRowProps {
  label: string;
  name: FieldName;
  error?: string;
  typo?: string;
  onFixTypo?: () => void;
}

/**
 * 「라벨 ······ 오류 한 줄」. 칸 아래에 띄우면 좁은 틈 때문에 다음 칸 라벨을 덮고,
 * 흐름 안에 넣으면 오류가 뜰 때마다 아래 칸이 밀린다. 라벨 오른쪽은 원래 빈 자리다.
 */
export function LabelRow({ label, name, error, typo, onFixTypo }: LabelRowProps) {
  return (
    <div style={labelRowStyle}>
      <div style={{ ...fieldLabelStyle, flexShrink: 0 }}>{label}</div>
      {error ? (
        <span id={`error-${name}`} className="label-row__error" role="alert" title={error}>
          {error}
        </span>
      ) : typo ? (
        <button
          type="button"
          className="label-row__typo-fix"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onFixTypo}
          style={{ fontFamily: FONT.mono }}
        >
          {typo} <u>고치기</u>
        </button>
      ) : null}
    </div>
  );
}

const labelRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "12px",
  width: "100%",
  minWidth: 0,
};

const BAR_COLORS = ["#304d91", "#314d8f", COLOR.blue];

interface PasswordStrengthProps {
  password: string | undefined;
  style?: CSSProperties;
}

/** 비밀번호 세기 막대 세 칸. */
export function PasswordStrength({ password, style }: PasswordStrengthProps) {
  const strength = computePasswordStrength(password);
  return (
    <div style={{ display: "flex", gap: "4px", width: "100%", ...style }}>
      {BAR_COLORS.map((color, i) => (
        <div
          key={i}
          style={{
            flex: "1 0 0",
            height: "2px",
            borderRadius: "2px",
            background: i < strength ? color : "rgba(255,255,255,0.07)",
            transition: "background .2s ease",
          }}
        />
      ))}
    </div>
  );
}
