import { useRef, type KeyboardEvent } from "react";

interface PillTab<T extends string> {
  id: T;
  label: string;
  /** 서버 기능이 없어 아직 못 여는 탭. 이 글을 붙여 비활성으로 그린다(눌러도 아무 일 없는 탭을 만들지 않는다). */
  pendingNote?: string;
}

interface PillTabsProps<T extends string> {
  label: string;
  items: readonly PillTab<T>[];
  activeId: T;
  onSelect: (id: T) => void;
}

/** 알약 모양 탭. 왼쪽 · 오른쪽 화살표로 열린 탭 사이를 옮겨 다닌다(WAI-ARIA tablist). */
export default function PillTabs<T extends string>({ label, items, activeId, onSelect }: PillTabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const openItems = items.filter((item) => !item.pendingNote);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step || openItems.length === 0) return;
    event.preventDefault();
    const index = openItems.findIndex((item) => item.id === activeId);
    const next = openItems[(index + step + openItems.length) % openItems.length];
    onSelect(next.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <div ref={listRef} role="tablist" aria-label={label} className="adm-tabs" onKeyDown={handleKeyDown}>
      {items.map((item) => {
        const isActive = item.id === activeId;
        if (item.pendingNote) {
          return (
            // aria-disabled: 화면 읽기 프로그램이 건너뛰지 않고 「준비 중」까지 읽는다. 누를 곳(onClick)이 없어 눌러도 바뀌지 않는다.
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={false}
              aria-disabled="true"
              tabIndex={-1}
              className="adm-tab"
            >
              {item.label}
              <span className="adm-tab__note">{item.pendingNote}</span>
            </button>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            data-tab={item.id}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={isActive ? "adm-tab is-active" : "adm-tab"}
            onClick={() => onSelect(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
