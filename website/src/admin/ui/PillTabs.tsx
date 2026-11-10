import { useRef, type KeyboardEvent } from "react";

interface PillTabsProps<T extends string> {
  label: string;
  items: readonly { id: T; label: string }[];
  activeId: T;
  onSelect: (id: T) => void;
}

/** 알약 모양 탭. 왼쪽 · 오른쪽 화살표로 옮겨 다닌다(WAI-ARIA tablist). */
export default function PillTabs<T extends string>({ label, items, activeId, onSelect }: PillTabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = items.findIndex((item) => item.id === activeId);
    const next = items[(index + step + items.length) % items.length];
    onSelect(next.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <div ref={listRef} role="tablist" aria-label={label} className="adm-tabs" onKeyDown={handleKeyDown}>
      {items.map((item) => {
        const isActive = item.id === activeId;
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
