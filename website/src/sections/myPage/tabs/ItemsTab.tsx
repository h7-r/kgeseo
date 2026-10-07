import type { CSSProperties } from "react";

import { MY_PAGE_CONTENT } from "@/data/myPage";
import { FONT } from "@/lib/style";
import { darkRowStyle } from "@/sections/myPage/styles";
import { COLOR } from "@/styles/tokens";

import StatsBox from "./StatsBox";

export default function ItemsTab() {
  const { stats, items } = MY_PAGE_CONTENT.items;
  return (
    <>
      <StatsBox stats={stats} />
      {items.map((item, i) => (
        <div key={i} style={itemRowStyle}>
          <div style={{ width: "28px", height: "28px", borderRadius: "6px", background: "#1b2135", flexShrink: 0 }} />
          <span style={{ flex: "1 0 0", fontFamily: FONT.mono, fontSize: "16px", color: COLOR.textBright }}>
            {item.name}
          </span>
          <span style={{ ...tagStyle, background: item.color, padding: "3px 8px", color: COLOR.textMuted }}>
            {item.rarity}
          </span>
        </div>
      ))}
    </>
  );
}

const itemRowStyle: CSSProperties = {
  ...darkRowStyle,
  height: "52px",
  padding: "14px 16px",
  borderRadius: "8px",
  gap: "12px",
  justifyContent: "flex-start",
};

const tagStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  borderRadius: "4px",
  fontFamily: FONT.mono,
  fontSize: "16px",
  color: COLOR.textBright,
  whiteSpace: "nowrap",
};
