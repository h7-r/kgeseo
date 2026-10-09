/**
 * 화면 왼쪽 위에 늘 떠 있는 작은 힌트 표시. [H] 키가 있다는 걸 아무도 안 알려 줘서,
 * 구석에 아이콘 하나를 늘 띄워 「저기에 뭔가 모이고 있다」를 남긴다.
 * 아래 왼쪽은 성능 계기판, 오른쪽은 Leva, 가운데는 조준점이 쓴다.
 */
import type { CSSProperties } from "react";

import { getHintFlashTime, useHintBox } from "./hintBox";
import { GOLD } from "./panelStyles";

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
          opacity: isPanelOpen ? 0.95 : isEmpty ? 0.34 : 0.62,
          animation: flashKey ? "hint-flash 900ms ease-out 1" : undefined,
        }}
      >
        <span style={keyStyle}>H</span>
        <span style={isEmpty ? emptyThumbStyle : thumbStyle}>
          {latest?.image ? (
            <img src={latest.image} alt="" style={imageStyle} />
          ) : (
            // 아직 없을 때도 「여기에 쪽지가 모인다」를 알리는 자리는 남긴다
            <span style={placeholderStyle} aria-hidden>
              ?
            </span>
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

// 테두리와 글자까지 같이 물들어야 한 덩이가 켜졌다로 읽힌다.
const FLASH_KEYFRAMES = `
@keyframes hint-flash {
  0%   { opacity: .62; transform: translateX(0);    box-shadow: 0 0 0 0 rgba(224,169,78,0); }
  12%  { opacity: 1;   transform: translateX(2px);  box-shadow: 0 0 0 2px rgba(224,169,78,.55); }
  38%  { opacity: .7;  transform: translateX(0);    box-shadow: 0 0 0 1px rgba(224,169,78,.2); }
  56%  { opacity: 1;   transform: translateX(1px);  box-shadow: 0 0 0 2px rgba(224,169,78,.45); }
  100% { opacity: .62; transform: translateX(0);    box-shadow: 0 0 0 0 rgba(224,169,78,0); }
}`;

const frameStyle: CSSProperties = {
  position: "absolute",
  left: 14,
  top: 14,
  zIndex: 60, // 힌트함 창(50) 보다 위 — 창이 떠도 반짝임이 보여야 한다
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px 6px 7px",
  borderRadius: 9,
  background: "rgba(16,20,28,.62)",
  border: "1px solid #2c3648",
  pointerEvents: "none", // 1인칭으로 보는 중에 마우스가 걸리면 안 된다
  userSelect: "none",
  transition: "opacity 160ms ease",
};

const keyStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  minWidth: 18,
  height: 18,
  borderRadius: 4,
  border: "1px solid #3c4658",
  background: "#12161c",
  color: "#cfe3ff",
  font: "600 11px ui-monospace,Menlo,monospace",
};

const thumbStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 22,
  height: 22,
  borderRadius: 4,
  background: "#12161c",
  border: `1px solid ${GOLD}`,
  overflow: "hidden",
};
const emptyThumbStyle: CSSProperties = { ...thumbStyle, border: "1px dashed #3c4658" };
const imageStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
const placeholderStyle: CSSProperties = { color: "#5b6b80", font: "600 12px sans-serif" };
const labelStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 5,
  color: "#cfe3ff",
  font: "12px/1 sans-serif",
  letterSpacing: 0.3,
};
const countStyle: CSSProperties = { color: GOLD, font: "600 12px ui-monospace,Menlo,monospace" };
