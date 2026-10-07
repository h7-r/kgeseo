import type { CSSProperties } from "react";

import TabBar from "@/components/TabBar";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

import { ACTIVE_TAB_BACKGROUND } from "./styles";

interface FilterChipsProps<T extends string> {
  options: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
}

/** 분류 칩. 탭과 같은 단추를 쓰고 글자가 곧 값이다. */
export default function FilterChips<T extends string>({ options, selected, onSelect }: FilterChipsProps<T>) {
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
