/**
 * [H] 힌트함 — 본부실의 힌트함(src/game/HintPanel)과 같은 치수 · 색 · 짜임새. 읽은 쪽지를 적어 두고 다시 펼쳐 본다.
 * 저장은 본부실과 같은 함(@/game/hintBox)을 쓰고, 여기서는 버리기([E])가 없다 — 능선의 종이는 궤에 그대로 있어 언제든 다시 읽는다.
 */
import { useState, type CSSProperties } from "react";

import { useKeyLabels } from "@/engine/input";
import { useHintBox } from "@/game/hintBox";
import {
  backdropStyle,
  bodyStyle,
  categoryStyle,
  detailNameStyle,
  dividerStyle,
  footerStyle,
  gridStyle,
  headerMetaStyle,
  headerStyle,
  hintStyle,
  panelStyle,
  sectionCountStyle,
  sectionTitleStyle,
  selectedSlotStyle,
  slotNameStyle,
  slotStyle,
  titleStyle,
} from "./hintBoxStyles";
import { setHintBoxOpen, useHintBoxOpen } from "./hintBoxView";

export default function HintBoxHud() {
  const labels = useKeyLabels();
  const open = useHintBoxOpen();
  const hints = useHintBox();
  const latestId = () => (hints.length ? hints[hints.length - 1].id : null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  // 열 때는 맨 마지막에 넣은 것을 펴 준다 — 방금 넣은 걸 보려고 여는 일이 많다
  if (open !== wasOpen) {
    setWasOpen(open);
    setSelectedId(open ? latestId() : null);
  }
  if (!open) return null;
  const selected = selectedId ? hints.find((hint) => hint.id === selectedId) : null;

  return (
    <div style={backdropStyle} onClick={() => setHintBoxOpen(false)}>
      <div
        role="dialog"
        aria-label="힌트함"
        style={labels.isTouch ? { ...panelStyle, ...touchPanelStyle } : panelStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={
            labels.isTouch
              ? { ...headerStyle, alignItems: "center", justifyContent: "flex-start", gap: 12, marginBottom: 8 }
              : headerStyle
          }
        >
          <span style={titleStyle}>힌트함</span>
          <span style={headerMetaStyle}>모은 것 {hints.length}</span>
          {/* 휴대폰 — 바깥 누르기만으로는 닫는 길이 안 보인다. 닫기 44px(14회차) */}
          {labels.isTouch && (
            <button type="button" aria-label="닫기" style={touchCloseStyle} onClick={() => setHintBoxOpen(false)}>
              ×
            </button>
          )}
        </div>

        <div style={bodyStyle}>
          <div style={leftColumnStyle}>
            <div style={sectionTitleStyle}>
              모은 힌트 <span style={sectionCountStyle}>{hints.length}</span>
            </div>
            {hints.length ? (
              <div style={gridStyle}>
                {hints.map((hint) => (
                  <button
                    key={hint.id}
                    style={selectedId === hint.id ? selectedSlotStyle : slotStyle}
                    onClick={() => setSelectedId(hint.id)}
                    title={hint.name}
                  >
                    {hint.image ? (
                      <img src={hint.image} alt="" style={slotImageStyle} />
                    ) : (
                      <span style={slotLetterStyle}>{hint.name?.[0] ?? "?"}</span>
                    )}
                    <span style={slotNameStyle}>{hint.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={emptyRowStyle}>
                아직 모은 힌트가 없다.
                <br />
                {labels.text("쪽지를 읽는 중에 [H] 를 누르면 여기 적힌다.")}
              </div>
            )}
          </div>

          <div style={rightColumnStyle}>
            {selected ? (
              <>
                <div style={categoryStyle}>힌트</div>
                <h3 style={detailNameStyle}>{selected.name}</h3>
                <div style={dividerStyle} />
                {selected.image && <img src={selected.image} alt="" style={detailImageStyle} />}
                <p style={descriptionStyle}>{selected.description ?? "아직 적힌 것이 없다."}</p>
              </>
            ) : (
              <div style={hintStyle}>
                {hints.length ? "왼쪽에서 하나를 고르면 여기에 펼쳐진다." : "막히는 자리마다 쪽지가 하나씩 있다."}
              </div>
            )}
          </div>
        </div>

        {!labels.isTouch && <div style={footerStyle}>[H] · [ESC] 로 닫기</div>}
      </div>
    </div>
  );
}

// 휴대폰 — 안전 영역 안, 화면 높이를 넘지 않게
const touchPanelStyle: CSSProperties = {
  width: "min(720px, calc(100% - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))",
  maxHeight: "calc(100% - 20px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
  height: "calc(100% - 20px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
  padding: "8px 8px 14px 20px",
};
const touchCloseStyle: CSSProperties = {
  marginLeft: "auto",
  width: 44,
  height: 44,
  borderRadius: 22,
  border: "1px solid #2c343e",
  background: "transparent",
  color: "#b7c0cb",
  font: "400 24px/1 sans-serif",
  cursor: "pointer",
};
const leftColumnStyle: CSSProperties = { flex: "1 1 48%", overflowY: "auto", paddingRight: 4 };
const rightColumnStyle: CSSProperties = {
  flex: "1 1 52%",
  borderLeft: "1px solid #2c343e",
  paddingLeft: 20,
  overflowY: "auto",
};
const slotImageStyle: CSSProperties = { width: 56, height: 56, objectFit: "contain", borderRadius: 4 };
const slotLetterStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 56,
  height: 56,
  borderRadius: 6,
  background: "#232a35",
  font: "600 18px sans-serif",
  color: "#8ea3bd",
};
const emptyRowStyle: CSSProperties = { color: "#5b6b80", fontSize: 13, padding: "6px 2px", lineHeight: 1.6 };
const detailImageStyle: CSSProperties = {
  width: "100%",
  maxWidth: 360,
  display: "block",
  margin: "0 auto 12px",
  borderRadius: 8,
  background: "#12161c",
};
const descriptionStyle: CSSProperties = { margin: 0, color: "#b7c0cb", fontSize: 14, whiteSpace: "pre-line" };
