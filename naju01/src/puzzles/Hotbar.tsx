/**
 * 빠른 칸 — 화면 왼쪽 위, 세로 넷. 아래쪽은 대사 자리라 비워 둔다.
 * 숫자키 [1]~[8] 로 바로 손에 들고, 같은 키를 다시 누르면 도로 넣는다. 휠로는 바꾸지 않는다 — 트랙패드를 스치기만
 * 해도 물건이 손에 들려 나왔다. 넷이 넘으면 맨 아래에 「+n · [I]」 — 나머지는 소지품 창에서. Canvas 밖 DOM 층
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

import { tapKey, useGameFrozen, useTouchMode } from "@/engine/input";

import { AMBER, CREAM, HUD_FONT as FONT, KEY_FONT, KEY_INK } from "./hudTheme";
import { ITEMS, inventory, useHandItem, useHeldItems } from "./inventory";
import { ITEM_ICONS } from "./itemIcons";

/** 빠른 칸에 보이는 수 */
const SHOWN = 4;

/** n 번째 칸 — 손에 든 것이면 넣고, 아니면 꺼낸다(숫자키 · 터치 탭 공용). 칸이 없으면 false */
function pickSlot(index: number): boolean {
  const current = inventory.hand();
  const list = current ? [...inventory.held(), current] : inventory.held();
  const item = list[index];
  if (!item) return false;
  if (current?.uid === item.uid) inventory.stow();
  else inventory.takeOut(item.uid);
  return true;
}

export default function Hotbar() {
  const held = useHeldItems();
  const hand = useHandItem();
  // 손에 든 것까지 한 줄에 — 든 것은 제 자리에 남겨 두고 밝게 표시한다
  const row = hand ? [...held, hand] : held;

  const isTouch = useTouchMode();
  // 터치 — 창 · 멈춤 · 동행 입력 중(얼어 있음)에는 숨긴다. 칸이 창 위로 떠 눌리면 멈춘 채로 물건이 오간다
  const isFrozen = useGameFrozen();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const match = /^Digit([1-8])$/.exec(event.code);
      if (!match) return;
      if (pickSlot(Number(match[1]) - 1)) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!row.length || (isTouch && isFrozen)) return null;
  if (isTouch) return <TouchHotbar row={row} handUid={hand?.uid ?? null} />;
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
            <span style={{ ...nameStyle, ...(isHand ? handNameStyle : null) }}>
              {isHand ? `${ITEMS[item.kind].name} · 손에 듦` : ITEMS[item.kind].name}
            </span>
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

/**
 * 터치 빠른 소지품 — 하단 가운데 가로 줄(마인크래프트 모바일 하단 소지품 · Roblox 「아래 양쪽 조작 영역을 피한다」 참고,
 * 코덱스 구현 07회차). 왼쪽 40% 이동 스틱 자리와 오른쪽 ✋ · 점프 묶음(오른쪽 24 + 폭 170, engine/input/TouchHud) 사이에 둔다.
 * 칸 48px + 간격 8px — 들어가는 만큼만 보이고, 넘치면 마지막 칸이 「+n」(누르면 소지품 창).
 */
const TOUCH_SLOT = 48;
const TOUCH_GAP = 8;
const ACTION_CLUSTER_WIDTH = 24 + 170;
const STICK_AREA = 0.4;

/**
 * 칸 수는 줄 상자의 실제 폭으로 센다 — 상자 좌우는 CSS(40vw · 안전 영역 · 동작 묶음)가 정하므로 같은 값을 JS 로 다시
 * 계산하면 노치 쪽 inset 이 빠진다(코덱스 구현 08회차: 932 · inset 59 · 6개면 23px 넘침). 회전 · 주소창 변화도 따라간다
 */
function TouchHotbar({ row, handUid }: { row: ReturnType<typeof inventory.held>; handUid: number | null }) {
  const barRef = useRef<HTMLDivElement>(null);
  const available = useElementWidth(barRef);
  const fits = Math.max(1, Math.floor((available + TOUCH_GAP) / (TOUCH_SLOT + TOUCH_GAP)));
  // 넘치면 마지막 칸은 「+n」. 한 칸밖에 안 들어가면 「+n」만 남기지 않고 손에 든 것(없으면 첫 물건)을 두고
  // 남은 수는 그 칸 모서리에 작게 — 소지품 창은 위 🎒 단추로도 연다(코덱스 구현 09회차)
  const isSingle = fits === 1 && row.length > 1;
  const shown = isSingle ? 1 : row.length > fits ? Math.max(0, fits - 1) : row.length;
  const rest = row.length - shown;
  const hand = row.find((item) => item.uid === handUid);
  // 칸이 모자라도 손에 든 것은 보인다 — 눌러서 바로 넣을 수 있게(든 것은 줄 맨 끝이라 가장 먼저 「+n」에 묻혔다)
  const visible = row.slice(0, shown);
  if (hand && shown > 0 && !visible.includes(hand)) visible[shown - 1] = hand;
  return (
    <div ref={barRef} style={touchBarStyle} data-touch-hotbar="" data-hud="빠른 소지품">
      {hand && <div style={touchHandLabelStyle}>{ITEMS[hand.kind].name} · 손에 듦</div>}
      <div style={{ display: "flex", gap: TOUCH_GAP }}>
        {visible.map((item) => {
          const isHand = item.uid === handUid;
          return (
            <button
              key={item.uid}
              type="button"
              aria-label={`${ITEMS[item.kind].name}${isHand ? " 넣기" : " 꺼내기"}${isSingle ? ` · ${rest}개 더는 소지품 창에` : ""}`}
              style={{ ...touchSlotStyle, ...(isHand ? handSlotStyle : null) }}
              onClick={() => pickSlot(row.indexOf(item))}
            >
              <span style={iconStyle}>{ITEM_ICONS[item.kind]}</span>
              {isSingle && (
                <span style={restBadgeStyle} aria-hidden="true">
                  +{rest}
                </span>
              )}
            </button>
          );
        })}
        {rest > 0 && !isSingle && (
          <button
            type="button"
            aria-label={`소지품 창 열기 · ${rest}개 더`}
            style={touchSlotStyle}
            onClick={() => tapKey("KeyI")}
          >
            <span style={{ font: `700 14px/1 ${FONT}`, color: CREAM }}>+{rest}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** 상자 안쪽 폭 — 첫 그림 전에 재고(useLayoutEffect), 크기가 바뀌면 다시 잰다. 재기 전에는 한 칸만 */
function useElementWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") {
      const update = () => setWidth(element.clientWidth);
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const touchBarStyle: CSSProperties = {
  position: "absolute",
  left: `calc(${STICK_AREA * 100}vw + 12px)`,
  right: `calc(env(safe-area-inset-right, 0px) + ${ACTION_CLUSTER_WIDTH + 12}px)`,
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  zIndex: 950,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  pointerEvents: "none",
};

const touchSlotStyle: CSSProperties = {
  position: "relative",
  width: TOUCH_SLOT,
  height: TOUCH_SLOT,
  padding: 0,
  borderRadius: 12,
  border: "1.5px solid rgba(242,238,228,.35)",
  background: "rgba(10,13,19,.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "auto",
  touchAction: "manipulation",
};

/** 한 칸만 들어갈 때 칸 모서리의 남은 수 */
const restBadgeStyle: CSSProperties = {
  position: "absolute",
  right: -4,
  top: -6,
  minWidth: 22,
  padding: "0 5px",
  borderRadius: 999,
  background: "rgba(10,13,19,.92)",
  border: "1px solid rgba(242,238,228,.35)",
  color: CREAM,
  font: `700 11px/18px ${FONT}`,
  pointerEvents: "none",
};

const touchHandLabelStyle: CSSProperties = {
  padding: "2px 10px",
  borderRadius: 999,
  background: "rgba(10,13,19,.78)",
  color: AMBER,
  font: `600 13px/1.6 ${FONT}`,
  whiteSpace: "nowrap",
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
  font: `700 10px/1 ${KEY_FONT}`,
};

const handKeyStyle: CSSProperties = { background: AMBER, color: KEY_INK, boxShadow: "none" };

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
  font: `700 10px/1 ${KEY_FONT}`,
};
