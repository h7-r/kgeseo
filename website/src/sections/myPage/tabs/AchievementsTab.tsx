import type { CSSProperties } from "react";

import { MY_PAGE_CONTENT } from "@/data/myPage";
import { darkCardStyle, labelTextStyle, valueTextStyle } from "@/sections/myPage/styles";

import StatsBox from "./StatsBox";

export default function AchievementsTab() {
  const { stats, badges } = MY_PAGE_CONTENT.achievements;
  return (
    <>
      <StatsBox stats={stats} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
        {badges.map(([name, condition, progress], i) => (
          <div key={i} style={badgeCardStyle}>
            <div
              style={{ width: "40px", height: "40px", borderRadius: "20px", background: "#1b2135", flexShrink: 0 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 0 0" }}>
              <span style={valueTextStyle}>{name}</span>
              <span style={labelTextStyle}>{condition}</span>
            </div>
            <span style={labelTextStyle}>{progress}</span>
          </div>
        ))}
      </div>
    </>
  );
}

const badgeCardStyle: CSSProperties = {
  ...darkCardStyle,
  flexDirection: "row",
  alignItems: "center",
  gap: "16px",
  height: "90px",
  width: "calc(50% - 8px)",
  padding: "16px",
};
