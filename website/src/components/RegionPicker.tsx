import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { REGIONS, REGION_GROUPS } from "@/data/regions";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

interface RegionPickerProps {
  value: string;
  onSelect: (region: string) => void;
  /** 상자가 닫힐 때. 폼 검사에 이 칸을 지나갔다고 알린다. */
  onBlur?: () => void;
  error?: string | boolean | null;
  isValid?: boolean;
  placeholder?: string;
  placeholderColor?: string;
  /** 밑줄 칸에 덧붙일 스타일. */
  fieldStyle?: CSSProperties;
  /** 펼쳐지는 상자를 단추의 어느 쪽 끝에 맞출지. */
  listAlign?: "left" | "right";
}

/**
 * 지역 선택 상자. datalist 는 모양을 브라우저가 정하고 아무 글자나 받아서 직접 만든다.
 * 단추(combobox)를 누르면 권역별 칩(listbox)이 펼쳐지고, 키보드로도 모두 고를 수 있다.
 */
export default function RegionPicker({
  value,
  onSelect,
  onBlur,
  error,
  isValid,
  placeholder = "본인 지역 선택",
  placeholderColor = COLOR.textDim,
  fieldStyle,
  listAlign = "right",
}: RegionPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = `region-listbox${useId()}`;

  // Esc·고르기는 초점을 단추로 돌려주고, 바깥 클릭은 돌려주지 않는다.
  const close = (returnFocus = false) => {
    setOpen(false);
    onBlur?.();
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const start = Math.max(0, REGIONS.indexOf(value));
    // 칩은 상자가 그려진 다음 프레임에야 생긴다.
    const frame = requestAnimationFrame(() => chipRefs.current[start]?.focus());

    // pointerdown 이라 누르는 순간 닫힌다(click 은 손을 뗄 때라 늦다).
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
    // close·value 는 열릴 때 한 번만 읽으면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const select = (region: string) => {
    onSelect(region);
    setOpen(false);
    // 고른 뒤 초점은 단추로. 다음 칸으로 Tab 하기 쉽다.
    triggerRef.current?.focus();
  };

  const handleChipKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const moveTo = (next: number) => {
      event.preventDefault();
      chipRefs.current[(next + REGIONS.length) % REGIONS.length]?.focus();
    };
    if (event.key === "ArrowRight" || event.key === "ArrowDown") moveTo(index + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") moveTo(index - 1);
    else if (event.key === "Home") moveTo(0);
    else if (event.key === "End") moveTo(REGIONS.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") close(false); // 막지 않고 다음 칸으로 넘어가게 둔다.
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close(true);
    }
  };

  const fieldState = error ? "field--error" : isValid ? "field--valid" : "";

  return (
    <div style={{ position: "relative", width: "100%", zIndex: open ? 30 : "auto" }}>
      <div
        className={`underline-field ${fieldState} ${open ? "region-trigger--open" : ""}`}
        style={{ ...fieldStyle, position: "relative" }}
      >
        <button
          ref={triggerRef}
          type="button"
          className="region-trigger"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={Boolean(error)}
          aria-label={`지역 선택${value ? `, 지금 ${value}` : ""}`}
          onClick={() => (open ? close(false) : setOpen(true))}
          onKeyDown={handleTriggerKeyDown}
          style={{ fontFamily: FONT.body, color: value ? "var(--color-white)" : placeholderColor }}
        >
          <span>{value || placeholder}</span>
          <svg className="region-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2.5 4.5 6 8l3.5-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {isValid && !open && (
          <span className="valid-mark" aria-hidden="true" style={{ right: "26px" }}>
            ✓
          </span>
        )}
      </div>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="지역 목록"
          className="region-listbox"
          style={{ [listAlign]: 0 }}
        >
          <div className="region-listbox__head" style={{ fontFamily: FONT.mono }}>
            <span>지역 선택</span>
            <span className="region-listbox__help">탐험을 시작할 지역 · 나중에 바꿀 수 있어요</span>
          </div>
          {REGION_GROUPS.map((group) => (
            <div key={group.name} className="region-group" role="group" aria-label={group.name}>
              <span className="region-group__name" style={{ fontFamily: FONT.mono }}>
                {group.name}
              </span>
              <div className="region-chips">
                {group.regions.map((region) => {
                  const index = REGIONS.indexOf(region);
                  const selected = region === value;
                  return (
                    <button
                      key={region}
                      ref={(element) => {
                        chipRefs.current[index] = element;
                      }}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1} // 상자 안 이동은 방향키로. Tab 은 상자를 빠져나간다.
                      className={`region-chip${selected ? " is-selected" : ""}`}
                      onClick={() => select(region)}
                      onKeyDown={(event) => handleChipKeyDown(event, index)}
                      style={{ fontFamily: FONT.body }}
                    >
                      {selected && <span aria-hidden="true">✓ </span>}
                      {region}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
