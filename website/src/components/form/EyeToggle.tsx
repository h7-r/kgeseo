import type { CSSProperties } from "react";

import eyeIcon from "@/assets/images/imgEyeIcon.svg";

import type { FormVariant } from "./styles";

interface EyeToggleProps {
  variant: FormVariant;
  isRevealed: boolean;
  onToggle: () => void;
}

/** 감은 눈 그림이 없어 뜬 눈 위에 사선을 덧그어 가린 상태를 나타낸다. */
export default function EyeToggle({ variant, isRevealed, onToggle }: EyeToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={isRevealed ? "비밀번호 숨기기" : "비밀번호 보기"}
      style={{ ...buttonStyle, right: variant === "card" ? "8px" : 0 }}
    >
      <img
        loading="lazy"
        decoding="async"
        src={eyeIcon}
        alt=""
        style={{
          width: "18px",
          height: "18px",
          display: "block",
          filter: isRevealed ? "brightness(1.9)" : "brightness(1.35)",
        }}
      />
      {!isRevealed && (
        <span
          style={{ ...slashStyle, background: variant === "card" ? "rgba(241,241,252,0.75)" : "rgba(241,241,252,0.8)" }}
        />
      )}
    </button>
  );
}

const buttonStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  width: "24px",
  height: "24px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};
const slashStyle: CSSProperties = {
  position: "absolute",
  left: "2px",
  right: "2px",
  top: "50%",
  height: "1.5px",
  borderRadius: "1px",
  transform: "rotate(-45deg)",
};
