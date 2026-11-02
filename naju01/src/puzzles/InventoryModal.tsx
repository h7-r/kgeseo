import { useEffect, useState, type CSSProperties } from "react";

import { ITEMS, SLOT_COUNT, inventory, useHandItem, useHeldItems } from "./inventory";
import { ITEM_ICONS } from "./itemIcons";

/** 한 줄 칸 수 — 위아래 화살표는 이만큼 건너뛴다 */
const COLUMNS = 4;

/**
 * 소지품 창 — [I] 로 열고 닫는다. 화면 가운데, 왼쪽에 칸 넷씩 두 줄, 오른쪽에 고른 물건을 크게 보여 준다.
 * 열면 첫 칸이 골라져 있고, 마우스나 화살표로 고른다. [Enter](또는 [손에 들기])로 꺼내면 창이 닫히고 손에 든다 — 내려놓는 것은 [E].
 * Canvas 밖 DOM 층
 */
export default function InventoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // 닫을 때 통째로 내려 고른 칸이 다음에 열 때 첫 칸으로 돌아간다
  return open ? <InventoryPanel onClose={onClose} /> : null;
}

function InventoryPanel({ onClose }: { onClose: () => void }) {
  const items = useHeldItems();
  const hand = useHandItem();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = items[selectedIndex] ?? null;

  const takeOut = (index: number) => {
    const item = items[index];
    if (!item) return;
    inventory.takeOut(item.uid);
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[event.key];
      if (step !== undefined) {
        event.preventDefault();
        setSelectedIndex((index) => {
          const next = index + step;
          return next >= 0 && next < SLOT_COUNT ? next : index;
        });
        return;
      }
      if (event.key === "Enter") {
        // 마우스로 누른 칸 단추가 Enter 를 한 번 더 받지 않게
        event.preventDefault();
        takeOut(selectedIndex);
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  });

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(event) => event.stopPropagation()}>
        <header style={headerStyle}>
          <span style={titleStyle}>소지품</span>
          <span style={countStyle}>
            {items.length} / {SLOT_COUNT}
          </span>
        </header>
        <div style={bodyStyle}>
          <div style={gridStyle}>
            {Array.from({ length: SLOT_COUNT }, (_, index) => {
              const item = items[index];
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={item?.uid ?? `empty-${index}`}
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  onDoubleClick={() => takeOut(index)}
                  style={{ ...slotStyle, ...(item ? null : emptySlotStyle), ...(isSelected ? selectedSlotStyle : null) }}
                  title={item ? ITEMS[item.kind].name : undefined}
                >
                  <span style={slotKeyStyle}>{index + 1}</span>
                  {item && <span style={slotIconStyle}>{ITEM_ICONS[item.kind]}</span>}
                </button>
              );
            })}
          </div>
          <section style={detailStyle}>
            {selected ? (
              <>
                <div style={showcaseStyle}>
                  <span style={showcaseIconStyle}>{ITEM_ICONS[selected.kind]}</span>
                </div>
                <b style={nameStyle}>{ITEMS[selected.kind].name}</b>
                <p style={descriptionStyle}>{ITEMS[selected.kind].description}</p>
                <button type="button" style={actionStyle} onClick={() => takeOut(selectedIndex)}>
                  손에 들기 <span style={actionKeyStyle}>Enter</span>
                </button>
              </>
            ) : (
              <p style={emptyTextStyle}>{items.length ? "빈 칸이다." : "아직 챙긴 물건이 없다."}</p>
            )}
          </section>
        </div>
        <footer style={footerStyle}>
          {hand ? <span>손에 든 것 · {ITEMS[hand.kind].name}</span> : <span>빈손</span>}
          <span style={hintsStyle}>
            <Key>←↑↓→</Key> 고르기 <Key>1~8</Key> 바로 들기 <Key>I</Key> 닫기
          </span>
        </footer>
      </div>
    </div>
  );
}

function Key({ children }: { children: string }) {
  return <span style={keyCapStyle}>{children}</span>;
}

const FONT = '"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif';
const CREAM = "#F2EEE4";
const AMBER = "#F2C89A";

const backdropStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 40,
  display: "grid",
  placeItems: "center",
  background: "radial-gradient(ellipse at center, rgba(8,10,14,.35), rgba(8,10,14,.72))",
  backdropFilter: "blur(2px)",
};

const panelStyle: CSSProperties = {
  width: "min(620px, calc(100% - 32px))",
  borderRadius: 18,
  overflow: "hidden",
  background: "linear-gradient(180deg, rgba(26,30,38,.97), rgba(16,19,25,.97))",
  boxShadow: "0 24px 70px rgba(0,0,0,.55), inset 0 0 0 1px rgba(242,238,228,.08)",
  color: CREAM,
  font: `500 14px/1.5 ${FONT}`,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  padding: "18px 22px 14px",
  borderBottom: "1px solid rgba(242,238,228,.07)",
};

const titleStyle: CSSProperties = { font: `700 17px/1 ${FONT}`, letterSpacing: "0.04em" };

const countStyle: CSSProperties = { font: "600 12px/1 ui-monospace, Menlo, monospace", color: "rgba(242,238,228,.45)" };

const bodyStyle: CSSProperties = { display: "flex", gap: 22, padding: 22, flexWrap: "wrap" };

const gridStyle: CSSProperties = {
  flex: "1 1 260px",
  display: "grid",
  gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
  gap: 10,
  alignContent: "start",
};

const slotStyle: CSSProperties = {
  position: "relative",
  aspectRatio: "1",
  display: "grid",
  placeItems: "center",
  borderRadius: 12,
  border: "none",
  padding: 0,
  cursor: "pointer",
  background: "radial-gradient(circle at 50% 35%, rgba(242,238,228,.1), rgba(242,238,228,.025) 72%)",
  boxShadow: "inset 0 0 0 1px rgba(242,238,228,.12), inset 0 -10px 18px rgba(0,0,0,.28)",
  transition: "box-shadow 140ms ease, transform 140ms ease",
};

const emptySlotStyle: CSSProperties = { background: "rgba(242,238,228,.02)", cursor: "default" };

const selectedSlotStyle: CSSProperties = {
  boxShadow: `inset 0 0 0 1.5px ${AMBER}, 0 0 18px rgba(242,200,154,.3), inset 0 -10px 18px rgba(0,0,0,.2)`,
  transform: "translateY(-1px)",
};

const slotKeyStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  left: 8,
  font: "700 10px/1 ui-monospace, Menlo, monospace",
  color: "rgba(242,238,228,.35)",
};

const slotIconStyle: CSSProperties = { display: "grid", placeItems: "center", transform: "scale(1.15)" };

const detailStyle: CSSProperties = {
  flex: "1 1 200px",
  minHeight: 220,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
};

const showcaseStyle: CSSProperties = {
  alignSelf: "stretch",
  height: 108,
  marginBottom: 14,
  borderRadius: 14,
  display: "grid",
  placeItems: "center",
  background: "radial-gradient(circle at 50% 45%, rgba(242,200,154,.16), rgba(242,238,228,.02) 65%)",
  boxShadow: "inset 0 0 0 1px rgba(242,238,228,.07)",
};

const showcaseIconStyle: CSSProperties = { display: "grid", placeItems: "center", transform: "scale(2.1)" };

const nameStyle: CSSProperties = { font: `700 16px/1.3 ${FONT}`, color: CREAM };

const descriptionStyle: CSSProperties = { margin: "6px 0 16px", color: "rgba(242,238,228,.72)", font: `500 13px/1.6 ${FONT}`, flex: 1 };

const emptyTextStyle: CSSProperties = { margin: "auto", color: "rgba(242,238,228,.45)" };

const actionStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 16px",
  borderRadius: 999,
  border: "none",
  background: AMBER,
  color: "#2A2018",
  font: `700 13px/1 ${FONT}`,
  cursor: "pointer",
  boxShadow: "0 6px 18px rgba(242,200,154,.25)",
};

const actionKeyStyle: CSSProperties = {
  padding: "2px 6px",
  borderRadius: 5,
  background: "rgba(42,32,24,.14)",
  font: "700 10px/1 ui-monospace, Menlo, monospace",
};

const footerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  padding: "12px 22px",
  borderTop: "1px solid rgba(242,238,228,.07)",
  background: "rgba(0,0,0,.18)",
  color: "rgba(242,238,228,.55)",
  font: `500 12px/1 ${FONT}`,
};

const hintsStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 6 };

const keyCapStyle: CSSProperties = {
  padding: "3px 6px",
  borderRadius: 5,
  boxShadow: "inset 0 0 0 1px rgba(242,238,228,.25), inset 0 -2px 0 rgba(242,238,228,.08)",
  color: CREAM,
  font: "700 10px/1 ui-monospace, Menlo, monospace",
};
