import type { CSSProperties } from "react";

interface HoneypotProps {
  value: string;
  onChange: (value: string) => void;
}

/** 사람 눈엔 안 보이는 칸. 폼을 통째로 채우는 봇만 채운다. */
export default function Honeypot({ value, onChange }: HoneypotProps) {
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
