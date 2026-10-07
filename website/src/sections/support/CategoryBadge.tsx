import type { CSSProperties } from "react";

import { BADGE_BACKGROUNDS, BADGE_TEXT_COLORS, type FaqCategory, type NoticeCategory } from "@/data/support";
import { FONT } from "@/lib/style";

interface CategoryBadgeProps {
  category: NoticeCategory | FaqCategory;
}

export default function CategoryBadge({ category }: CategoryBadgeProps) {
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
