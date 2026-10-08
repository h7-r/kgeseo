/**
 * [H] 로 여는 힌트함. 치수·색은 소지품 창과 같다 — 생김새가 다르면 다른 게임 화면으로 읽힌다.
 * 힌트는 그림 한 장 + 한 줄 설명이라 왼쪽에서 고르면 오른쪽에 크게 펴 준다.
 */
import { useEffect, useState, type CSSProperties } from "react";

import { restoreHintPaper, VALVE_HINT } from "@/props/hintPaperState";

import { removeHint, useHintBox } from "./hintBox";
import { isTypingTarget } from "./overlayLayer";
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
} from "./panelStyles";

interface HintPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function HintPanel({ open, onClose }: HintPanelProps) {
  const hints = useHintBox();
  // 열 때는 맨 마지막에 넣은 것을 펴 준다(방금 주운 걸 보려고 여는 일이 많다).
  // 닫을 때는 고른 것을 지운다 — 다음에 열었을 때 엉뚱한 게 펼쳐져 있으면 헷갈린다.
  const latestId = () => (hints.length ? hints[hints.length - 1].id : null);
  const [selectedId, setSelectedId] = useState<string | null>(() => (open ? latestId() : null));
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setSelectedId(open ? latestId() : null);
  }

  // [E] — 골라 둔 힌트를 버린다. 창이 열리면 마우스 잠금이 풀려 App 의 E 까지 가지 않으므로 창이 직접 듣는다.
  // 지우지 않고 실물 쪽지를 바닥에 도로 내놓는다 — 잘못 누른 사람이 걸어가 주우면 된다.
  useEffect(() => {
    if (!open || !selectedId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyE") return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      // 실물이 없는 쪽지(튜토리얼 첫 쪽지 등)는 떨어뜨릴 종이가 없어 버리지 않는다.
      const selected = hints.find((hint) => hint.id === selectedId);
      if (selected?.isPhysical === false) return;
      const remaining = hints.filter((hint) => hint.id !== selectedId);
      if (removeHint(selectedId) && selectedId === VALVE_HINT.id) restoreHintPaper();
      // 버린 자리를 비워 두지 않는다 — 옆 것을 이어서 펴 준다
      setSelectedId(remaining.length ? remaining[remaining.length - 1].id : null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, selectedId, hints]);

  if (!open) return null;
  const selected = selectedId ? hints.find((hint) => hint.id === selectedId) : null;

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <span style={titleStyle}>힌트함</span>
          <span style={headerMetaStyle}>모은 것 {hints.length}</span>
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
                쪽지를 집어 든 채 [H] 를 누르면 여기 적힌다.
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
                {selected.isPhysical === false ? (
                  <div style={discardStyle}>힌트함에 늘 남아 있는 쪽지</div>
                ) : (
                  <div style={discardStyle}>
                    <kbd style={keyStyle}>E</kbd> 버리기 — 쪽지가 바닥에 떨어진다
                  </div>
                )}
              </>
            ) : (
              <div style={hintStyle}>
                {hints.length ? "왼쪽에서 하나를 고르면 여기에 펼쳐진다." : "막히는 자리마다 쪽지가 하나씩 있다."}
              </div>
            )}
          </div>
        </div>

        <div style={footerStyle}>[H] · [ESC] 로 닫기</div>
      </div>
    </div>
  );
}

const leftColumnStyle: CSSProperties = { flex: "1 1 48%", overflowY: "auto", paddingRight: 4 };
const rightColumnStyle: CSSProperties = {
  flex: "1 1 52%",
  borderLeft: "1px solid #2c343e",
  paddingLeft: 20,
  overflowY: "auto",
};

// 쪽지는 정사각 그림이라 소지품 칸(40px)보다 크게 — 글자가 읽혀야 한다
const slotImageStyle: CSSProperties = {
  width: 56,
  height: 56,
  objectFit: "contain",
  borderRadius: 4,
  imageRendering: "auto",
};
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
const emptyRowStyle: CSSProperties = {
  color: "#5b6b80",
  fontSize: 13,
  padding: "6px 2px",
  lineHeight: 1.6,
};

const detailImageStyle: CSSProperties = {
  width: "100%",
  maxWidth: 260,
  display: "block",
  margin: "0 auto 12px",
  borderRadius: 8,
  background: "#12161c",
};
// pre-line — 설명의 \n 줄바꿈을 살린다
const descriptionStyle: CSSProperties = {
  margin: 0,
  color: "#b7c0cb",
  fontSize: 14,
  whiteSpace: "pre-line",
};
const discardStyle: CSSProperties = {
  marginTop: 14,
  paddingTop: 12,
  borderTop: "1px solid #2c343e",
  color: "#7d8a9c",
  fontSize: 13,
};
const keyStyle: CSSProperties = {
  display: "inline-block",
  minWidth: 18,
  padding: "1px 5px",
  marginRight: 6,
  borderRadius: 4,
  border: "1px solid #3c4658",
  background: "#12161c",
  color: "#cfe3ff",
  font: "600 11px ui-monospace,Menlo,monospace",
};
