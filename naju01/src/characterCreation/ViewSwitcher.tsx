import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import type { Option } from "../avatar/sidekickOptions";
import type { PreviewView } from "./CharacterPreview";
import { COLORS, FONTS, MOTION } from "./styles";

// 이름 단계 전용인 upperBody 는 단추에 없다
const PREVIEW_VIEWS: readonly Option<PreviewView>[] = [
  ["full", "전신"],
  ["head", "머리"],
  ["hands", "손"],
  ["feet", "발"],
];

const switcherFrameStyle: CSSProperties = {
  display: "flex",
  gap: 2,
  padding: 4,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(8,9,11,0.7)",
  backdropFilter: "blur(10px)",
};
const optionButtonStyle: CSSProperties = {
  appearance: "none",
  position: "relative", // 미끄러지는 상자 위로 글자가 오게
  zIndex: 1,
  border: "none",
  borderRadius: 6,
  padding: "8px 16px",
  background: "none",
  color: COLORS.textMuted,
  font: `600 13px/1 ${FONTS.body}`,
  cursor: "pointer",
  transition: `background ${MOTION.fast}, color ${MOTION.fast}`,
};
const optionHighlightStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 4,
  bottom: 4,
  borderRadius: 6,
  background: "linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.12) 100%)",
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
  transition: "transform 280ms cubic-bezier(.2,.8,.2,1), width 280ms cubic-bezier(.2,.8,.2,1), opacity 160ms",
  pointerEvents: "none",
};

interface ViewSwitcherProps {
  selected: PreviewView;
  onSelect: (view: PreviewView) => void;
}

/**
 * 보기 전환(전신 · 머리 · 손 · 발) — 고른 칸의 반투명 상자가 누른 단추로 미끄러져 간다.
 * 상자 하나가 움직여야 어디서 어디로 옮겼는지 눈이 따라간다. 자리는 단추의 실제 크기를 재서 맞춘다.
 */
export default function ViewSwitcher({ selected, onSelect }: ViewSwitcherProps) {
  const buttonRefs = useRef<Partial<Record<PreviewView, HTMLButtonElement | null>>>({});
  const [highlight, setHighlight] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const element = buttonRefs.current[selected];
    if (!element) {
      setHighlight(null);
      return;
    }
    setHighlight({ x: element.offsetLeft, w: element.offsetWidth });
  }, [selected]);
  return (
    <div
      className="view-switcher"
      role="group"
      aria-label="보기"
      style={{ ...switcherFrameStyle, position: "relative", pointerEvents: "auto" }}
    >
      <span
        aria-hidden="true"
        style={{
          ...optionHighlightStyle,
          opacity: highlight ? 1 : 0,
          transform: `translateX(${highlight?.x ?? 0}px)`,
          width: highlight?.w ?? 0,
        }}
      />
      {PREVIEW_VIEWS.map(([view, label]) => {
        const isSelected = selected === view;
        return (
          <button
            key={view}
            ref={(element) => {
              buttonRefs.current[view] = element;
            }}
            type="button"
            className="view-switcher__option"
            aria-pressed={isSelected}
            onClick={() => onSelect(view)}
            style={{ ...optionButtonStyle, color: isSelected ? "#fff" : COLORS.textMuted }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
