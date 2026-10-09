import type { CSSProperties } from "react";

import { glossStyle } from "./formStyles";

interface SubmitButtonProps {
  label: string;
  isBusy: boolean;
  onClick: () => void;
  style: CSSProperties;
  labelStyle: CSSProperties;
}

/** 폼 제출 단추. 시안이 div 라 role·키보드를 직접 붙인다. */
export default function SubmitButton({ label, isBusy, onClick, style, labelStyle }: SubmitButtonProps) {
  return (
    <div
      className="button"
      role="button"
      tabIndex={0}
      aria-busy={isBusy}
      style={{ ...style, cursor: "pointer", ...(isBusy ? { opacity: 0.65, cursor: "progress" } : {}) }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div style={glossStyle} />
      <span style={{ position: "relative", ...labelStyle }}>{label}</span>
    </div>
  );
}

interface HoneypotProps {
  value: string;
  onChange: (value: string) => void;
}

/** 사람 눈엔 안 보이는 칸. 폼을 통째로 채우는 봇만 채운다. */
export function Honeypot({ value, onChange }: HoneypotProps) {
  return (
    <input
      type="text"
      name="website"
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={honeypotStyle}
    />
  );
}

// display:none 이면 똑똑한 봇은 건너뛰므로 화면 밖으로만 치운다.
const honeypotStyle: CSSProperties = { position: "absolute", left: "-9999px", width: "1px", height: "1px", opacity: 0 };
