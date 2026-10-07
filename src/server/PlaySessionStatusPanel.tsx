/** (?dev) 소화전 자물쇠 vertical slice 의 플레이 세션 상태. */
import { useEffect, type CSSProperties } from "react";

import { PLAY_CONTRACT, PLAY_PHASE_LABELS, startPlaySession, usePlaySession } from "./playSession";

export default function PlaySessionStatusPanel() {
  const status = usePlaySession();

  useEffect(() => {
    startPlaySession().catch((error: unknown) => {
      console.error("[Play Session] bootstrap 실패", error);
    });
  }, []);

  const isCompleted = status.savedState?.completed_puzzle_ids.includes(PLAY_CONTRACT.puzzleId);
  const isUnlocked = status.savedState?.flags[PLAY_CONTRACT.unlockedFlag] === true;

  return (
    <aside style={panelStyle} aria-label="개발용 Play Session 상태">
      <strong style={titleStyle}>Play Session</strong>
      <StatusRow name="상태" value={PLAY_PHASE_LABELS[status.phase]} />
      <StatusRow name="Puzzle" value={isCompleted ? "완료" : "미완료"} />
      <StatusRow name="Flag" value={isUnlocked ? "열림" : "잠김"} />
      {status.playSessionId && (
        <span style={idStyle} title={status.playSessionId}>
          {status.playSessionId.slice(0, 8)}
        </span>
      )}
      {status.error && <span style={errorStyle}>{status.error}</span>}
    </aside>
  );
}

function StatusRow({ name, value }: { name: string; value: string }) {
  return (
    <div style={rowStyle}>
      <span>{name}</span>
      <span style={valueStyle}>{value}</span>
    </div>
  );
}

const panelStyle: CSSProperties = {
  position: "fixed",
  top: 300,
  right: 12,
  zIndex: 90,
  width: 190,
  padding: "9px 10px",
  border: "1px solid rgba(225,232,242,.28)",
  borderRadius: 6,
  background: "rgba(15,19,25,.9)",
  color: "#edf2f7",
  font: "12px/1.35 system-ui, sans-serif",
  boxShadow: "0 4px 16px rgba(0,0,0,.25)",
};
const titleStyle: CSSProperties = { display: "block", marginBottom: 6, fontSize: 12 };
const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 8 };
const valueStyle: CSSProperties = { color: "#cbd5e1" };
const idStyle: CSSProperties = { display: "block", marginTop: 6, color: "#8fb9df" };
const errorStyle: CSSProperties = {
  display: "block",
  marginTop: 6,
  color: "#ef8b87",
  overflowWrap: "anywhere",
};
