import type { CSSProperties } from "react";

import TabBar from "@/components/TabBar";
import { BADGE_BACKGROUNDS, BADGE_TEXT_COLORS, type FaqCategory, type NoticeCategory } from "@/data/support";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

import { ACTIVE_TAB_BACKGROUND } from "./styles";

// 고객센터 탭 내용(공지·FAQ·문의)이 함께 쓰는 머리·분류 칩·분류 배지.

interface PanelHeadingProps {
  title: string;
  description: string;
}

export function PanelHeading({ title, description }: PanelHeadingProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
      <div style={{ fontFamily: FONT.display, fontSize: "44px", color: COLOR.lightText, whiteSpace: "nowrap" }}>
        {title}
      </div>
      <div style={{ fontFamily: FONT.mono, fontWeight: 400, fontSize: "18px", color: COLOR.lightTextMuted }}>
        {description}
      </div>
    </div>
  );
}

interface FilterChipsProps<T extends string> {
  options: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
}

/** 분류 칩. 탭과 같은 단추를 쓰고 글자가 곧 값이다. */
export function FilterChips<T extends string>({ options, selected, onSelect }: FilterChipsProps<T>) {
  return (
    <TabBar
      items={options.map((option) => ({ id: option, label: option }))}
      activeId={selected}
      onSelect={onSelect}
      style={chipRowStyle}
      activeTabStyle={activeFilterStyle}
      inactiveTabStyle={inactiveFilterStyle}
    />
  );
}

const chipRowStyle: CSSProperties = { display: "flex", gap: "20px" };

const filterBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "10px 18px",
  borderRadius: "999px",
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  whiteSpace: "nowrap",
  cursor: "pointer",
  boxSizing: "border-box",
};
const activeFilterStyle: CSSProperties = {
  ...filterBaseStyle,
  backgroundImage: ACTIVE_TAB_BACKGROUND,
  color: COLOR.white,
};
const inactiveFilterStyle: CSSProperties = {
  ...filterBaseStyle,
  background: COLOR.lightSurface,
  border: `1px solid ${COLOR.lightBorder}`,
  color: COLOR.lightTextMuted,
};

interface CategoryBadgeProps {
  category: NoticeCategory | FaqCategory;
}

export function CategoryBadge({ category }: CategoryBadgeProps) {
  return (
    <div style={{ ...badgeStyle, background: BADGE_BACKGROUNDS[category], color: BADGE_TEXT_COLORS[category] }}>
      {category}
    </div>
  );
}

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 14px",
  borderRadius: "6px",
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  whiteSpace: "nowrap",
};
