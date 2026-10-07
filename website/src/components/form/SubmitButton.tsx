import type { CSSProperties } from "react";

import { glossStyle } from "./styles";

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
      className="btn"
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
