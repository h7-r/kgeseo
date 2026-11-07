import { useRef, type CSSProperties } from "react";

import { useActiveTabInView } from "./useActiveTabInView";

interface TabBarItem<T extends string> {
  readonly id: T;
  readonly label: string;
}

interface TabBarProps<T extends string> {
  items: readonly TabBarItem<T>[];
  activeId: T;
  onSelect: (id: T) => void;
  /** 탭 줄을 감싸는 칸. */
  style?: CSSProperties;
  activeTabStyle: CSSProperties;
  inactiveTabStyle: CSSProperties;
}

/** 알약 모양 탭 한 줄. 화면마다 색·간격이 달라 모양은 스타일로 받는다. */
export default function TabBar<T extends string>({
  items,
  activeId,
  onSelect,
  style,
  activeTabStyle,
  inactiveTabStyle,
}: TabBarProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  useActiveTabInView(listRef, activeId);

  return (
    <div ref={listRef} role="tablist" style={style}>
      {items.map(({ id, label }) => {
        const isActive = id === activeId;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={isActive ? "tab-button is-active" : "tab-button"}
            style={isActive ? activeTabStyle : inactiveTabStyle}
            onClick={() => onSelect(id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
