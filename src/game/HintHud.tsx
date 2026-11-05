/**
 * 화면 왼쪽 위에 늘 떠 있는 작은 힌트 표시. [H] 키가 있다는 걸 아무도 안 알려 줘서,
 * 구석에 아이콘 하나를 늘 띄워 「저기에 뭔가 모이고 있다」를 남긴다.
 * 아래 왼쪽은 성능 계기판, 오른쪽은 Leva, 가운데는 조준점이 쓴다.
 */
import type { CSSProperties } from "react";

import { NoteIcon } from "./gameIcons";
import { UI, UI_FONT, keyCapStyle } from "./gameUi";
import { getHintFlashTime, useHintBox } from "./hintBox";

interface HintHudProps {
  /** 힌트함 창이 열려 있다 — 숨기지 않고 더 진하게 띄운다 */
  isPanelOpen?: boolean;
}

export default function HintHud({ isPanelOpen = false }: HintHudProps) {
  const hints = useHintBox();
  // [H] 를 누를 때마다 시각이 바뀐다 — key 로 써서 요소를 다시 태어나게 해 애니메이션을 처음부터 돌린다.
  const flashKey = getHintFlashTime();

  // [H] 는 반짝임과 창 열기를 같이 한다. 창이 뜨는 순간 감추면 정작 반짝이는 걸 못 봐서 창(50) 위로 띄운다.
  const latest = hints[hints.length - 1];
  const isEmpty = hints.length === 0;

  return (
    <>
      <style>{FLASH_KEYFRAMES}</style>
      <div
        key={flashKey}
        style={{
          ...frameStyle,
          opacity: isPanelOpen ? 1 : isEmpty ? 0.72 : 0.92,
          animation: flashKey ? "hint-flash 900ms ease-out 1" : undefined,
        }}
      >
        <kbd style={keyCapStyle}>H</kbd>
        <span style={isEmpty ? emptyThumbStyle : thumbStyle}>
          {latest?.image ? (
            <img src={latest.image} alt="" style={imageStyle} />
          ) : (
            // 아직 없을 때도 「여기에 쪽지가 모인다」를 알리는 자리는 남긴다
            <NoteIcon size={16} />
          )}
        </span>
        <span style={labelStyle}>
          힌트
          <span style={countStyle}>{hints.length}</span>
        </span>
      </div>
    </>
  );
}

// 테두리까지 같이 물들어야 한 덩이가 켜졌다로 읽힌다.
const FLASH_KEYFRAMES = `
@keyframes hint-flash {
  0%   { transform: translateX(0);   border-color: #1a305f; }
  12%  { transform: translateX(2px); border-color: #86a6f0; }
  38%  { transform: translateX(0);   border-color: #3a5794; }
  56%  { transform: translateX(1px); border-color: #86a6f0; }
  100% { transform: translateX(0);   border-color: #1a305f; }
}`;

const frameStyle: CSSProperties = {
  position: "absolute",
  left: 16,
  top: 16,
  zIndex: 60, // 힌트함 창(50) 보다 위 — 창이 떠도 반짝임이 보여야 한다
  display: "flex",
  alignItems: "center",
  gap: 9,
  height: 42,
  padding: "0 14px 0 8px",
  boxSizing: "border-box",
  borderRadius: 21,
  background: UI.glass,
  border: `1px solid ${UI.border}`,
  pointerEvents: "none", // 1인칭으로 보는 중에 마우스가 걸리면 안 된다
  userSelect: "none",
  transition: "opacity 160ms ease",
};

const thumbStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 26,
  height: 26,
  borderRadius: 6,
  background: UI.surfaceHover,
  color: UI.accent,
  overflow: "hidden",
};
const emptyThumbStyle: CSSProperties = { ...thumbStyle, background: "transparent", color: UI.textSubtle };
const imageStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
const labelStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 6,
  color: UI.text,
  font: `500 13px/1 ${UI_FONT.body}`,
};
const countStyle: CSSProperties = {
  color: UI.accent,
  font: `600 13px/1 ${UI_FONT.mono}`,
  fontVariantNumeric: "tabular-nums",
};
