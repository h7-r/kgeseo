/**
 * [I] 로 여는 소지품 창 (S7-028 · 029 · 034).
 * 열쇠와 기록을 줄을 나눠 보여 줘야 막혔을 때 「쓸 것」과 「읽을 것」이 구분된다.
 * 칸 수 제한 없음(S7-034), 써도 사라지지 않아(GRD-01) 버리기 버튼이 없다.
 */
import { useState, type CSSProperties } from "react";

import { useInventory, type InventoryItem } from "./inventory";

interface InventoryPanelProps {
  /** 지금 이 창이 열려 있나(화면층이 정한다) */
  open: boolean;
  onClose: () => void;
}

export default function InventoryPanel({ open, onClose }: InventoryPanelProps) {
  const items = useInventory();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);

  // 닫을 때 고른 것도 지운다 — 다음에 열었을 때 엉뚱한 게 펼쳐져 있으면 헷갈린다
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setSelectedId(null);
  }

  if (!open) return null;

  const keys = items.filter((item) => item.category === "열쇠");
  const records = items.filter((item) => item.category !== "열쇠");
  const selected = selectedId ? items.find((item) => item.id === selectedId) : null;

  const renderSlot = (item: InventoryItem) => (
    <button
      key={item.id}
      style={selectedId === item.id ? selectedSlotStyle : slotStyle}
      onClick={() => setSelectedId(item.id)}
      title={item.name}
    >
      {item.image ? (
        <img src={item.image} alt="" style={slotImageStyle} />
      ) : (
        // 그림이 아직 없어도 무엇인지는 읽혀야 한다 → 이름 첫 글자로 대신한다
        <span style={slotLetterStyle}>{item.name?.[0] ?? "?"}</span>
      )}
      <span style={slotNameStyle}>{item.name}</span>
    </button>
  );

  const renderSection = (title: string, list: InventoryItem[], emptyText: string) => (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>
        {title} <span style={sectionCountStyle}>{list.length}</span>
      </div>
      {list.length ? <div style={gridStyle}>{list.map(renderSlot)}</div> : <div style={emptyRowStyle}>{emptyText}</div>}
    </div>
  );

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <span style={titleStyle}>소지품</span>
          <span style={headerMetaStyle}>지닌 것 {items.length}</span>
        </div>

        <div style={bodyStyle}>
          <div style={leftColumnStyle}>
            {renderSection("열쇠", keys, "아직 없다")}
            {renderSection("기록", records, "아직 없다")}
          </div>

          <div style={rightColumnStyle}>
            {selected ? (
              <>
                <div style={categoryStyle}>{selected.category ?? "기록"}</div>
                <h3 style={detailNameStyle}>{selected.name}</h3>
                <div style={dividerStyle} />
                {selected.image && <img src={selected.image} alt="" style={detailImageStyle} />}
                <p style={descriptionStyle}>{selected.description ?? "아직 적힌 것이 없다."}</p>
              </>
            ) : (
              <div style={hintStyle}>
                {items.length ? "왼쪽에서 하나를 고르면 여기에 자세히 나온다." : "아직 아무것도 지니지 않았다."}
              </div>
            )}
          </div>
        </div>

        <div style={footerStyle}>[I] · [ESC] 로 닫기</div>
      </div>
    </div>
  );
}

const GOLD = "#e0a94e";
const MONO_SMALL = "12px ui-monospace,Menlo,monospace";

const backdropStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 50,
  background: "rgba(10,13,18,.72)",
  display: "grid",
  placeItems: "center",
};

const panelStyle: CSSProperties = {
  width: 720,
  maxWidth: "90%",
  maxHeight: "82%",
  display: "flex",
  flexDirection: "column",
  padding: "22px 24px",
  borderRadius: 12,
  background: "#191d25",
  border: "1px solid #2c3648",
  color: "#cfe3ff",
  font: "15px/1.7 sans-serif",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  marginBottom: 16,
};
const titleStyle: CSSProperties = { font: "600 22px/1.3 sans-serif" };
const headerMetaStyle: CSSProperties = { font: MONO_SMALL, color: "#5b6b80" };
const bodyStyle: CSSProperties = { display: "flex", gap: 20, minHeight: 0, flex: 1 };
const leftColumnStyle: CSSProperties = { flex: "1 1 58%", overflowY: "auto", paddingRight: 4 };
const rightColumnStyle: CSSProperties = {
  flex: "1 1 42%",
  borderLeft: "1px solid #2c343e",
  paddingLeft: 20,
  overflowY: "auto",
};
const sectionStyle: CSSProperties = { marginBottom: 18 };
const sectionTitleStyle: CSSProperties = {
  font: MONO_SMALL,
  letterSpacing: 1,
  color: GOLD,
  marginBottom: 8,
};
const sectionCountStyle: CSSProperties = { color: "#5b6b80", marginLeft: 4 };
const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
  gap: 8,
};

const slotStyle: CSSProperties = {
  display: "grid",
  justifyItems: "center",
  gap: 4,
  padding: "10px 6px",
  borderRadius: 8,
  background: "#12161c",
  border: "1px solid #2c343e",
  color: "#cfe3ff",
  font: "12px sans-serif",
  cursor: "pointer",
};
const selectedSlotStyle: CSSProperties = { ...slotStyle, borderColor: GOLD, background: "#1d2430" };
const slotImageStyle: CSSProperties = { width: 40, height: 40, objectFit: "contain" };
const slotLetterStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 40,
  height: 40,
  borderRadius: 6,
  background: "#232a35",
  font: "600 18px sans-serif",
  color: "#8ea3bd",
};
const slotNameStyle: CSSProperties = {
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const emptyRowStyle: CSSProperties = { color: "#5b6b80", fontSize: 13, padding: "6px 2px" };

const categoryStyle: CSSProperties = { font: MONO_SMALL, letterSpacing: 1, color: GOLD };
const detailNameStyle: CSSProperties = { margin: "6px 0 0", font: "600 19px/1.3 sans-serif" };
const dividerStyle: CSSProperties = { height: 1, background: "#2c343e", margin: "14px 0" };
const detailImageStyle: CSSProperties = {
  width: "100%",
  borderRadius: 8,
  background: "#12161c",
  marginBottom: 12,
};
const descriptionStyle: CSSProperties = { margin: 0, color: "#b7c0cb", fontSize: 14 };
const hintStyle: CSSProperties = { color: "#5b6b80", fontSize: 13, paddingTop: 6 };
const footerStyle: CSSProperties = {
  marginTop: 16,
  textAlign: "right",
  color: "#5b6b80",
  font: MONO_SMALL,
};
