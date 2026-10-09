import { memo, type CSSProperties } from "react";

import { HEADER_HEIGHT } from "@/lib/layout";
import { FONT } from "@/lib/style";
import { SUB_NAV_HEIGHT } from "@/navigation/subMenus";

interface SubNavItem {
  id: string;
  label: string;
}

interface SubNavProps {
  items: readonly SubNavItem[];
  activeId: string | null | undefined;
  onSelect: (id: string) => void;
}

/**
 * 머리띠 아래 한 줄. 지금 페이지의 구간·탭으로 바로 간다. 보일지·무엇을 할지는 HeaderLayer 가 정한다.
 * 머리 메뉴(19px)보다 작은 15px 로 두어 한 단계 아래로 읽힌다.
 */
function SubNav({ items, activeId, onSelect }: SubNavProps) {
  return (
    <nav aria-label="이 페이지 바로가기" style={barStyle}>
      {items.map(({ id, label }) => {
        const isActive = id === activeId;
        return (
          <button
            key={id}
            type="button"
            aria-current={isActive ? "true" : undefined}
            onClick={() => onSelect(id)}
            style={{
              ...buttonStyle,
              color: isActive ? "#7d97d6" : "rgba(241,241,252,0.78)",
              textShadow: isActive ? "0 0 8px rgba(46,72,137,0.7)" : undefined,
              borderBottomColor: isActive ? "#395ca7" : "transparent",
            }}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}

export default memo(SubNav);

const barStyle: CSSProperties = {
  // 머리띠가 absolute 로 맨 위를 덮고 있어 그 바로 아래에 놓는다.
  position: "absolute",
  left: 0,
  top: `${HEADER_HEIGHT}px`,
  width: "1920px",
  height: `${SUB_NAV_HEIGHT}px`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "40px",
  // 머리띠와 같은 까닭으로 뒤 흐림 없이 짙게 칠한다.
  background: "rgba(1, 4, 10, 0.9)",
  borderTop: "1px solid rgba(111, 134, 191, 0.18)",
  borderBottom: "1px solid rgba(111, 134, 191, 0.18)",
};

const buttonStyle: CSSProperties = {
  height: "100%",
  padding: "0 4px",
  borderBottom: "2px solid transparent",
  fontFamily: FONT.mono,
  fontSize: "15px",
  letterSpacing: "1px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  cursor: "pointer",
  transition: "color .18s ease, border-color .18s ease",
};
