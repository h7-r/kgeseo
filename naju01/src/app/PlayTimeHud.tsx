/**
 * 경과 시간 — 화면 위 가운데 작은 알약 「⏱ 12:34」(미르 11/11 「경과시간 표기도 필요」, 나주입장 05회차 Codex).
 * 시간 별은 20:00 까지 ★★★, 넘으면 최대 ★★ — 넘으면 글자색만 살짝 바꾼다(빨강 경고 · 「★3까지 남은 시간」은 압박이 되고, 도움을 청한 뒤에도
 * ★3 이 남은 듯 보여 쓰지 않는다). 색만으로 알리지 않게 넘은 뒤에는 이름표(title)에도 적는다. 첫 조작 전(시작 카드)에는 숨긴다.
 */
import { useSyncExternalStore, type CSSProperties } from "react";

import { UI, UI_FONT } from "@/game/gameUi";

import { THREE_STAR_MS, formatPlayTime, playClock } from "../progress/playClock";

export default function PlayTimeHud() {
  useSyncExternalStore(playClock.subscribe, playClock.version, playClock.version);
  if (!playClock.isRunning() && !playClock.isFinal()) return null;
  const elapsed = playClock.elapsed();
  const isOver = elapsed > THREE_STAR_MS;
  const label = playClock.isFinal()
    ? `조사 완료 · ${formatPlayTime(elapsed)}`
    : isOver
      ? `조사 시간 ${formatPlayTime(elapsed)} — 20분을 넘겨 시간 평가는 최대 ★★`
      : `조사 시간 ${formatPlayTime(elapsed)} — 20분 안에 끝내면 시간 평가 ★★★`;
  return (
    <div role="timer" aria-label={label} title={label} data-hud="조사 시간" style={pillStyle}>
      <span aria-hidden style={iconStyle}>
        ⏱
      </span>
      <span style={{ ...timeStyle, color: isOver && !playClock.isFinal() ? UI.textSubtle : UI.text }}>
        {formatPlayTime(elapsed)}
      </span>
      {playClock.isFinal() && <span style={doneStyle}>완료</span>}
    </div>
  );
}

const pillStyle: CSSProperties = {
  position: "absolute",
  top: "calc(env(safe-area-inset-top, 0px) + 14px)",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 30,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 12px",
  borderRadius: 999,
  background: "rgba(5,11,26,.72)",
  border: `1px solid ${UI.border}`,
  fontFamily: UI_FONT.mono,
  pointerEvents: "none",
  userSelect: "none",
};
const iconStyle: CSSProperties = { fontSize: 13, lineHeight: 1 };
const timeStyle: CSSProperties = { fontSize: 15, fontWeight: 600, letterSpacing: ".04em", fontVariantNumeric: "tabular-nums" };
const doneStyle: CSSProperties = { fontFamily: UI_FONT.body, fontSize: 12, color: UI.accent };
