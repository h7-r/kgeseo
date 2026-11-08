import type { CSSProperties } from "react";

import { useKeyLabels } from "@/engine/input";
import { AMBER, CREAM, HUD_FONT as FONT, KEY_FONT, KEY_INK } from "./hudTheme";
import { aimedTarget, useAimedLabel, useNotice, usesWithHand } from "./interaction";
import { ITEMS, SLOT_COUNT, inventory, useHandItem, useHeldItems } from "./inventory";
import { useSpeechBoxShown } from "../scene/firstScene/npcSpeech";

/**
 * 겨눈 물건의 [E] 안내와 짧은 알림. 손에 든 것이 있으면 [E] 는 받는 곳의 안내(「제상에 올리기」) 아니면 「소지품에 넣기」(칸이 차면 「내려놓기」).
 * 빈손이면 겨눈 곳이 받는 물건이 소지품에 있을 때 그 안내(「뜬 돌 끼우기」), 아니면 겨눈 물건의 안내만. Canvas 밖 DOM 층
 */
export default function InteractionHud() {
  const aimedLabel = useAimedLabel();
  const hand = useHandItem();
  useHeldItems(); // 소지품이 바뀌면 안내도 다시 고른다
  const notice = useNotice();
  // 터치 모드면 키 표기를 화면 단추 그림으로(✋ · 💡 · 🎒)
  const labels = useKeyLabels();
  // 터치 화면에서 인물 대사 상자가 떠 있으면 알림은 상자 안에 뜬다(NpcSpeechHud)
  const isSpeechShown = useSpeechBoxShown();
  const isNoticeInBox = labels.isTouch && isSpeechShown;
  const target = aimedTarget();
  // 손에 든 채 허공 E 는 소지품으로(칸이 차면 내려놓기) — WorldItems 손 처리기와 같은 조건
  const putAway = inventory.held().length < SLOT_COUNT ? "소지품에 넣기" : "내려놓기";
  const label = hand
    ? (target?.handLabel?.(hand.kind) ?? (usesWithHand(target) ? aimedLabel : `${ITEMS[hand.kind].name} ${putAway}`))
    : (target?.handLabel && inventory.findUsable(target.handLabel)?.label) || aimedLabel;
  return (
    <>
      {/* 가운데 점 — 본편과 같은 조준점 */}
      <div style={crosshairStyle} />
      {label && (
        <div style={promptStyle}>
          <span style={keyStyle}>{labels.key("E")}</span>
          {label}
        </div>
      )}
      {notice && !isNoticeInBox && (
        <div key={notice.key} className="naju-notice" style={noticeStyle} data-hud="알림">
          {labels.text(notice.text)}
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
  // 낮은 가로 화면에서 인물 대사 상자가 떠 있으면 그 위로 올라선다(Codex 06회차)
  top: "min(calc(50% + 34px), calc(100% - var(--npc-speech-top, 0px) - 44px))",
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
  // 긴 물건 이름 · 사용 안내가 좁은 휴대폰 가로에서 화면 밖으로 나가지 않게(14회차)
  maxWidth: "calc(100% - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px))",
  overflow: "hidden",
  textOverflow: "ellipsis",
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
  // 아래 빠른 칸(소지품 한 줄) 위 — 인물 대사 상자가 떠 있으면 그 위로 비켜 선다(NpcSpeechHud 가 윗변 높이를 알린다)
  bottom: "max(110px, calc(var(--npc-speech-top, 0px) + 12px))",
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
