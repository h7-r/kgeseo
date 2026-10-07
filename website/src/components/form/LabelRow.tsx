import type { CSSProperties } from "react";

import { FONT } from "@/lib/style";
import type { FieldName } from "@/lib/validation";

import { fieldLabelStyle } from "./styles";

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
export default function LabelRow({ label, name, error, typo, onFixTypo }: LabelRowProps) {
  return (
    <div style={labelRowStyle}>
      <div style={{ ...fieldLabelStyle, flexShrink: 0 }}>{label}</div>
      {error ? (
        <span id={`error-${name}`} className="field-error" role="alert" title={error}>
          {error}
        </span>
      ) : typo ? (
        <button
          type="button"
          className="typo-suggestion"
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
