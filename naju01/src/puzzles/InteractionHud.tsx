import type { CSSProperties } from "react";

import { AMBER, CREAM, HUD_FONT as FONT, KEY_FONT, KEY_INK } from "./hudTheme";
import { aimedTarget, useAimedLabel, useNotice } from "./interaction";
import { ITEMS, useHandItem, useHeldItems } from "./inventory";

/**
 * 겨눈 물건의 [E] 안내와 짧은 알림. 손에 든 것이 있으면 [E] 는 「내려놓기」,
 * 빈손이라도 겨눈 곳이 소지품 속 물건을 받으면 「바로 끼우기」다. Canvas 밖 DOM 층
 */
export default function InteractionHud() {
  const aimedLabel = useAimedLabel();
  const hand = useHandItem();
  const held = useHeldItems();
  const notice = useNotice();
  const target = aimedTarget();
  const quick = !hand && target?.handLabel ? held.map((item) => target.handLabel?.(item.kind)).find(Boolean) : null;
  const label = hand ? (target?.handLabel?.(hand.kind) ?? `${ITEMS[hand.kind].name} 내려놓기`) : (quick ?? aimedLabel);
  return (
    <>
      {/* 가운데 점 — 본편과 같은 조준점 */}
      <div style={crosshairStyle} />
      {label && (
        <div style={promptStyle}>
          <span style={keyStyle}>E</span>
          {label}
        </div>
      )}
      {notice && (
        <div key={notice.key} className="naju-notice" style={noticeStyle}>
          {notice.text}
        </div>
      )}
    </>
  );
}

const crosshairStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: 5,
  height: 5,
  marginLeft: -2.5,
  marginTop: -2.5,
  borderRadius: "50%",
  background: "rgba(240,244,250,.55)",
  zIndex: 25,
  pointerEvents: "none",
};

const promptStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "calc(50% + 34px)",
  transform: "translateX(-50%)",
  zIndex: 25,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px 6px 6px",
  borderRadius: 999,
  background: "rgba(14,18,26,.72)",
  color: CREAM,
  font: `600 14px/1 ${FONT}`,
  pointerEvents: "none",
  whiteSpace: "nowrap",
};

const keyStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 22,
  height: 22,
  borderRadius: 6,
  background: AMBER,
  color: KEY_INK,
  font: `700 12px/1 ${KEY_FONT}`,
};

const noticeStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 110, // 아래 빠른 칸(소지품 한 줄) 위에 뜬다
  transform: "translateX(-50%)",
  zIndex: 25,
  maxWidth: "min(560px, calc(100% - 32px))",
  padding: "10px 18px",
  borderRadius: 10,
  background: "rgba(14,18,26,.78)",
  color: CREAM,
  font: `500 15px/1.5 ${FONT}`,
  textAlign: "center",
  pointerEvents: "none",
};
