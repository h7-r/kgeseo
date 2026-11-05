/**
 * [I] 로 여는 소지품 창 (S7-028 · 029 · 034).
 * 열쇠와 기록을 줄을 나눠 보여 줘야 막혔을 때 「쓸 것」과 「읽을 것」이 구분된다.
 * 칸 수 제한 없음(S7-034), 써도 사라지지 않아(GRD-01) 버리기 버튼이 없다.
 */
import { useState } from "react";

import { SatchelIcon } from "./gameIcons";
import GamePanel from "./GamePanel";
import { UI } from "./gameUi";
import { useInventory, type InventoryItem } from "./inventory";
import {
  categoryStyle,
  descriptionStyle,
  detailColumnStyle,
  detailImageStyle,
  detailNameStyle,
  emptyRowStyle,
  emptyStyle,
  gridStyle,
  listColumnStyle,
  sectionCountStyle,
  sectionStyle,
  sectionTitleStyle,
  slotImageStyle,
  slotLetterStyle,
  slotNameStyle,
  slotStyle,
} from "./panelStyles";

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
      type="button"
      key={item.id}
      className="game-slot"
      aria-pressed={selectedId === item.id}
      style={slotStyle}
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
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>
        {title} <span style={sectionCountStyle}>{list.length}</span>
      </div>
      {list.length ? <div style={gridStyle}>{list.map(renderSlot)}</div> : <div style={emptyRowStyle}>{emptyText}</div>}
    </section>
  );

  return (
    <GamePanel title="소지품" meta={`지닌 것 ${items.length}`} closeKey="I" onClose={onClose}>
      <div className="game-panel-scroll" style={listColumnStyle}>
        {renderSection("열쇠", keys, "아직 없다")}
        {renderSection("기록", records, "아직 없다")}
      </div>

      <aside className="game-panel-scroll" style={detailColumnStyle}>
        {selected ? (
          <>
            <div style={categoryStyle}>{selected.category ?? "기록"}</div>
            <h3 style={detailNameStyle}>{selected.name}</h3>
            {selected.image && <img src={selected.image} alt="" style={detailImageStyle} />}
            <p style={descriptionStyle}>{selected.description ?? "아직 적힌 것이 없다."}</p>
          </>
        ) : (
          <div style={emptyStyle}>
            <span style={{ color: UI.accent }}>
              <SatchelIcon size={30} />
            </span>
            {items.length ? "왼쪽에서 하나를 고르면 여기에 자세히 나온다." : "아직 아무것도 지니지 않았다."}
          </div>
        )}
      </aside>
    </GamePanel>
  );
}
