import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { COLOR } from "@/styles/tokens";

import { fieldTextStyle } from "./supportStyles";

/** 디자인에 목록이 없어 공지·FAQ 분류를 그대로 쓴다. */
const INQUIRY_TYPES = ["계정", "게임플레이", "결제", "기술지원", "기타"] as const;

type InquiryType = (typeof INQUIRY_TYPES)[number];

interface InquiryTypeSelectProps {
  placeholder: string;
  value: string;
  onChange: (value: InquiryType) => void;
}

/**
 * 문의 유형 고르개. <select> 의 목록은 OS 기본 모양이라 화면과 따로 놀아 직접 그린다.
 * 그 대신 role·aria, Esc·위아래·Enter, 바깥 누르면 닫기를 손으로 챙긴다.
 */
export default function InquiryTypeSelect({ placeholder, value, onChange }: InquiryTypeSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const select = (option: InquiryType) => {
    onChange(option);
    setIsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      setIsOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isOpen && highlighted >= 0) select(INQUIRY_TYPES[highlighted]);
      else setIsOpen((wasOpen) => !wasOpen);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((i) => (i + step + INQUIRY_TYPES.length) % INQUIRY_TYPES.length);
    }
  };

  return (
    <div ref={rootRef} style={{ position: "relative", flex: "1 0 0", minWidth: 0 }}>
      <div
        role="combobox"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((wasOpen) => !wasOpen)}
        onKeyDown={handleKeyDown}
        style={{
          ...fieldTextStyle,
          cursor: "pointer",
          outline: "none",
          color: value ? COLOR.lightText : "rgba(26,26,31,0.5)",
          userSelect: "none",
        }}
      >
        {value || placeholder}
      </div>

      {isOpen && (
        <div className="inquiry-type-select__list" role="listbox" style={pickerPanelStyle}>
          {INQUIRY_TYPES.map((option, i) => (
            <div
              key={option}
              role="option"
              aria-selected={value === option}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => select(option)}
              style={{
                ...pickerOptionStyle,
                background: i === highlighted ? "rgba(46,72,137,0.08)" : "transparent",
                color: value === option ? COLOR.blue : "#3a4050",
              }}
            >
              {option}
              {value === option && <span style={{ color: COLOR.blueMid }}>✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const pickerPanelStyle: CSSProperties = {
  position: "absolute",
  left: "-16px",
  right: "-16px",
  top: "calc(100% + 14px)",
  zIndex: 30,
  padding: "6px",
  borderRadius: "12px",
  background: COLOR.white,
  border: `1px solid ${COLOR.lightBorder}`,
  boxShadow: "0 18px 40px rgba(20,30,60,0.14)",
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};

const pickerOptionStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "11px 14px",
  borderRadius: "8px",
  fontFamily: "inherit",
  fontSize: "16px",
  cursor: "pointer",
  transition: "background .14s ease, color .14s ease",
};
