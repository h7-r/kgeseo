/**
 * 빠른 칸 — 화면 왼쪽 위, 세로 넷. 아래쪽은 대사 자리라 비워 둔다.
 * 숫자키 [1]~[8] 로 바로 손에 들고, 같은 키를 다시 누르면 도로 넣는다. 마우스 휠로도 든 것을 바꾼다(끝까지 가면 빈손).
 * 넷이 넘으면 맨 아래에 「+n · [I]」 — 나머지는 소지품 창에서. Canvas 밖 DOM 층
 */
import { useEffect, type CSSProperties } from "react";

import { ITEMS, inventory, useHandItem, useHeldItems } from "./inventory";
import { ITEM_ICONS } from "./itemIcons";

/** 빠른 칸에 보이는 수 */
const SHOWN = 4;

export default function Hotbar() {
  const held = useHeldItems();
  const hand = useHandItem();
  // 손에 든 것까지 한 줄에 — 든 것은 제 자리에 남겨 두고 밝게 표시한다
  const row = hand ? [...held, hand] : held;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const match = /^Digit([1-8])$/.exec(event.code);
      if (!match) return;
      const index = Number(match[1]) - 1;
      const current = inventory.hand();
      const list = current ? [...inventory.held(), current] : inventory.held();
      const item = list[index];
      if (!item) return;
      event.preventDefault();
      if (current?.uid === item.uid) inventory.stow();
      else inventory.takeOut(item.uid);
    };
    const onWheel = (event: WheelEvent) => {
      if (!document.pointerLockElement) return;
      const current = inventory.hand();
      const list = current ? [...inventory.held(), current] : inventory.held();
      if (!list.length) return;
      const sorted = [...list].sort((a, b) => a.uid - b.uid);
      const at = current ? sorted.findIndex((item) => item.uid === current.uid) : -1;
      const next = at + (event.deltaY > 0 ? 1 : -1);
      if (next < 0 || next >= sorted.length) inventory.stow();
      else inventory.takeOut(sorted[next].uid);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

  if (!row.length) return null;
  const rest = row.length - SHOWN;
  return (
    <div style={columnStyle}>
      {row.slice(0, SHOWN).map((item, index) => {
        const isHand = hand?.uid === item.uid;
        return (
          <div key={item.uid} style={{ ...rowStyle, ...(isHand ? handRowStyle : null) }}>
            <div style={{ ...slotStyle, ...(isHand ? handSlotStyle : null) }}>
              <span style={{ ...keyStyle, ...(isHand ? handKeyStyle : null) }}>{index + 1}</span>
              <span style={iconStyle}>{ITEM_ICONS[item.kind]}</span>
            </div>
            <span style={{ ...nameStyle, ...(isHand ? handNameStyle : null) }}>{isHand ? `${ITEMS[item.kind].name} · 손에 듦` : ITEMS[item.kind].name}</span>
          </div>
        );
      })}
      {rest > 0 && (
        <div style={moreStyle}>
          +{rest} <span style={moreKeyStyle}>I</span>
        </div>
      )}
    </div>
  );
}

const FONT = '"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif';
const CREAM = "#F2EEE4";
const AMBER = "#F2C89A";

const columnStyle: CSSProperties = {
  position: "absolute",
  left: 14,
  top: 54,
  zIndex: 24,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  pointerEvents: "none",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: 4,
  paddingRight: 12,
  borderRadius: 12,
  background: "linear-gradient(90deg, rgba(12,16,22,.72), rgba(12,16,22,.28) 75%, rgba(12,16,22,0))",
  transition: "background 160ms ease",
};

const handRowStyle: CSSProperties = {
  background: "linear-gradient(90deg, rgba(64,48,30,.78), rgba(40,30,20,.34) 75%, rgba(40,30,20,0))",
};

const slotStyle: CSSProperties = {
  position: "relative",
  width: 46,
  height: 46,
  flex: "none",
  borderRadius: 10,
  display: "grid",
  placeItems: "center",
  background: "radial-gradient(circle at 50% 35%, rgba(242,238,228,.12), rgba(242,238,228,.03) 70%)",
  boxShadow: "inset 0 0 0 1px rgba(242,238,228,.14), inset 0 -8px 14px rgba(0,0,0,.25)",
  transition: "box-shadow 160ms ease, transform 160ms ease",
};

const handSlotStyle: CSSProperties = {
  boxShadow: `inset 0 0 0 1.5px ${AMBER}, 0 0 14px rgba(242,200,154,.35), inset 0 -8px 14px rgba(0,0,0,.2)`,
  transform: "scale(1.04)",
};

const iconStyle: CSSProperties = { display: "grid", placeItems: "center", transform: "scale(.92)" };

const keyStyle: CSSProperties = {
  position: "absolute",
  top: -5,
  left: -5,
  width: 17,
  height: 17,
  borderRadius: 5,
  display: "grid",
  placeItems: "center",
  background: "#1A2028",
  boxShadow: "0 0 0 1px rgba(242,238,228,.22)",
  color: "#C9C2B2",
  font: "700 10px/1 ui-monospace, Menlo, monospace",
};

const handKeyStyle: CSSProperties = { background: AMBER, color: "#2A2018", boxShadow: "none" };

const nameStyle: CSSProperties = {
  color: "rgba(242,238,228,.72)",
  font: `500 12px/1 ${FONT}`,
  whiteSpace: "nowrap",
  textShadow: "0 1px 2px rgba(0,0,0,.6)",
};

const handNameStyle: CSSProperties = { color: CREAM, font: `700 12px/1 ${FONT}` };

const moreStyle: CSSProperties = {
  alignSelf: "flex-start",
  marginLeft: 4,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 8px",
  borderRadius: 8,
  background: "rgba(12,16,22,.6)",
  color: "rgba(242,238,228,.75)",
  font: `600 11px/1 ${FONT}`,
};

const moreKeyStyle: CSSProperties = {
  padding: "2px 5px",
  borderRadius: 4,
  boxShadow: "0 0 0 1px rgba(242,238,228,.3)",
  font: "700 10px/1 ui-monospace, Menlo, monospace",
};
