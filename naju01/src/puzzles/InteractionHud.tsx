import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from "react";

import { useKeyLabels } from "@/engine/input";
import { AMBER, CREAM, HUD_FONT as FONT, KEY_FONT, KEY_INK } from "./hudTheme";
import { aimedTarget, useAimedLabel, useAimedTalkId, useAimedTalkLabel, useNotice, usesWithHand } from "./interaction";
import { ITEMS, SLOT_COUNT, inventory, useHandItem, useHeldItems } from "./inventory";
import { usePaperOpen } from "./ridge/oldPaper";
import { isTalkInterruptible, useSpeechBoxShown, useTalkOwner, useTalkTaken } from "../scene/firstScene/npcSpeech";

/**
 * 겨눈 물건의 [E] 안내와 짧은 알림. 손에 든 것이 있으면 [E] 는 받는 곳의 안내(「제상에 올리기」) 아니면 「소지품에 넣기」(칸이 차면 「내려놓기」).
 * 빈손이면 겨눈 곳이 받는 물건이 소지품에 있을 때 그 안내(「뜬 돌 끼우기」), 아니면 겨눈 물건의 안내만. Canvas 밖 DOM 층
 */
export default function InteractionHud() {
  const aimedLabel = useAimedLabel();
  // 겨눈 장면 인물 — [F](터치 💬)로 말을 건다. 물건 안내가 있으면 그쪽만(알약 하나), 누가 말하는 중이면(장면 인물 · 동행 대화창) 숨긴다(그때 F 는 말을 넘긴다)
  const talkLabel = useAimedTalkLabel();
  const isTalkTaken = useTalkTaken();
  // 장면 인물이 말하는 중이어도 다른 인물을 겨눴으면 [F] 가 그쪽으로 바꾼다(switchAimedTalk) — 그때는 안내를 띄운다
  const talkOwner = useTalkOwner();
  const aimedTalkId = useAimedTalkId();
  const canSwitchTalk =
    talkOwner !== null && aimedTalkId !== null && aimedTalkId !== talkOwner && isTalkInterruptible();
  const hand = useHandItem();
  useHeldItems(); // 소지품이 바뀌면 안내도 다시 고른다
  const notice = useNotice();
  // 터치 모드면 키 표기를 화면 단추 그림으로(✋ · 💡 · 🎒)
  const labels = useKeyLabels();
  // 대화창(dialogue/DialogueLayer)이 떠 있나 — 그동안 알림은 줄을 섰다가 창이 내려가면 뜬다(PC · 휴대폰 같게)
  const isSpeechShown = useSpeechBoxShown();
  // 종이를 읽는 동안 E 는 종이를 내려놓는다 — 겨눈 물건 안내는 틀린 말이 되므로 내린다(박람회 출품판 22c Codex)
  const isPaperOpen = usePaperOpen();
  const noticeRef = useRef<HTMLDivElement>(null);
  // 대화창이 뜨는 그 순간 알림을 내린다 — 알림 줄(interaction.ts)은 0.1초마다 보므로 그 틈에도 겹치지 않게. 대화 중 알림은 줄을 섰다가 뒤에 뜬다.
  // 멈춤 상태 안내(「클릭하면 계속」 · always)만은 대화창이 떠 있어도 보인다 — PC ESC 중에도 동행 말은 창에 남는다
  const isNoticeShown = !!notice && (!isSpeechShown || notice.always);
  // PC 만 — 커진 알림을 겨냥 안내가 피한다(휴대폰 배치는 11/8 해랑 검토로 따로 맞춰 두었다)
  useNoticeTop(noticeRef, isNoticeShown && !labels.isTouch ? (notice?.key ?? null) : null);
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
      {label && !isPaperOpen && (
        <div style={promptStyle}>
          <span style={keyStyle}>{labels.key("E")}</span>
          {label}
        </div>
      )}
      {!label && talkLabel && !isPaperOpen && (canSwitchTalk || (!isTalkTaken && !isSpeechShown)) && (
        <div style={promptStyle}>
          <span style={keyStyle}>{labels.isTouch ? "💬" : "F"}</span>
          {talkLabel}
        </div>
      )}
      {notice && isNoticeShown && (
        <div
          ref={noticeRef}
          key={notice.key}
          className="naju-notice"
          style={labels.isTouch ? noticeStyle : pcNoticeStyle}
          data-hud="알림"
        >
          {labels.isTouch ? labels.text(notice.text) : <p style={pcNoticeTextStyle}>{labels.text(notice.text)}</p>}
        </div>
      )}
    </>
  );
}

/**
 * 알림 아랫변 — 아래 빠른 칸 위(110px). 대화창이 떠 있으면 그 위로, PC 에서 줄 당기기 게이지가 떠 있으면 그 위로 12px 비켜 선다.
 * 대화창 · 게이지 · 숨 경고 띠는 제 윗변 높이를 --npc-speech-top · --naju-gauge-top · --naju-breath-band-top 으로 알린다.
 */
const NOTICE_BOTTOM =
  "max(110px, calc(var(--npc-speech-top, 0px) + 12px), calc(var(--naju-gauge-top, 0px) + 12px), calc(var(--naju-breath-band-top, 0px) + 12px))";

/**
 * 겨냥 안내가 읽는 값 — 무대 아래끝에서 알림 윗변까지. PC 알림이 커져 가운데 아래 겨냥 안내와 닿을 수 있다.
 * 알림의 높이만 재고 아랫변은 CSS 식 그대로 둔다 — 대사 상자 · 게이지가 뜨거나 내려가면 브라우저가 다시 푼다(박람회 출품판 22회차 Codex)
 */
const NOTICE_TOP_VAR = "--naju-notice-top";

function useNoticeTop(ref: RefObject<HTMLDivElement | null>, key: number | null) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const box = ref.current;
    if (key === null || !box) {
      root.style.removeProperty(NOTICE_TOP_VAR);
      return undefined;
    }
    const update = () =>
      root.style.setProperty(NOTICE_TOP_VAR, `calc(${NOTICE_BOTTOM} + ${Math.ceil(box.offsetHeight)}px)`);
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(box);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(NOTICE_TOP_VAR);
    };
  }, [ref, key]);
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
  // 낮은 가로 화면에서 인물 대사 상자가 떠 있으면 그 위로 올라선다(Codex 06회차). 알림이 떠 있으면 알림 위로(알림은 상자 위에 쌓인다)
  top: "min(calc(50% + 34px), calc(100% - max(var(--npc-speech-top, 0px), var(--naju-notice-top, 0px)) - 44px))",
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
  // 아래 빠른 칸(소지품 한 줄) 위 — 대화창이 떠 있으면 그 위로 비켜 선다(DialogueLayer 가 윗변 높이를 알린다)
  bottom: NOTICE_BOTTOM,
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

/**
 * PC 알림 — 인물 대사 상자(NpcSpeechHud)와 같은 결: 짙은 반투명 상자 · 옅은 테 · 흐림 · 큰 글씨(미르 11/9 「자막이 작아 안 보인다 —
 * 대사 상자와 같은 톤으로」 · 박람회 출품판 22회차). 짧은 알림은 글 폭만큼만, 긴 이야기 알림은 대사 상자 폭(880px)까지 넓어진다.
 * 휴대폰은 화면을 덜 덮게 위의 noticeStyle 그대로(11/8 해랑 검토 — 휴대폰 창 · 글씨가 가로 화면을 덮었다).
 */
const pcNoticeStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: NOTICE_BOTTOM,
  transform: "translateX(-50%)",
  zIndex: 25,
  width: "max-content",
  // 양옆 170px 는 비운다 — 왼쪽 빠른 칸(이름까지 약 160px). 1220px 보다 좁은 화면에서만 대사 상자(880px)보다 좁아진다
  maxWidth: "min(880px, calc(100% - 340px))",
  boxSizing: "border-box",
  padding: "13px 26px",
  borderRadius: 14,
  background: "rgba(12,15,22,.9)",
  border: "1px solid rgba(242,238,228,.16)",
  boxShadow: "0 10px 30px rgba(0,0,0,.35)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  color: CREAM,
  textAlign: "center",
  pointerEvents: "none",
};
const pcNoticeTextStyle: CSSProperties = {
  margin: 0,
  font: `500 clamp(17px, calc(0.9vw + 10px), 22px)/1.65 ${FONT}`,
  wordBreak: "keep-all",
  overflowWrap: "break-word",
  textShadow: "0 1px 2px rgba(0,0,0,.5)",
};
