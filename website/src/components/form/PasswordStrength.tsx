import type { CSSProperties } from "react";

import { passwordStrength } from "@/lib/validation";
import { COLOR } from "@/styles/tokens";

const BAR_COLORS = ["#304d91", "#314d8f", COLOR.blue];

interface PasswordStrengthProps {
  password: string | undefined;
  style?: CSSProperties;
}

/** 비밀번호 세기 막대 세 칸. */
export default function PasswordStrength({ password, style }: PasswordStrengthProps) {
  const strength = passwordStrength(password);
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
