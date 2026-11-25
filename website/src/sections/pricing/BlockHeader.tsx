import type { CSSProperties } from "react";

import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

interface BlockHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
}

/**
 * 덩이 머리 — 영문 꼬리표 · 큰 제목 · 설명이 왼쪽에 쌓인다.
 * 꼬리표를 영문으로 두어 큰 제목과 같은 말이 두 번 읽히지 않게 한다.
 */
export default function BlockHeader({ eyebrow, title, description }: BlockHeaderProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", width: "100%" }}>
      <span style={eyebrowStyle}>{eyebrow}</span>
      <span style={{ fontFamily: FONT.display, fontSize: "42px", lineHeight: 1.18, color: COLOR.textBright }}>
        {title}
      </span>
      <span style={{ fontFamily: FONT.mono, fontSize: "16px", lineHeight: 1.6, color: COLOR.textMuted }}>
        {description}
      </span>
    </div>
  );
}

const eyebrowStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  color: COLOR.accent,
  letterSpacing: "2.5px",
  textTransform: "uppercase",
};
