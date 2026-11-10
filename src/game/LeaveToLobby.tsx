/**
 * 「로비로 나가기」 — 게임(케이스) 중에 멈추고 로비(합동수사본부)로 나간다(미르 11/10). 설정 창과 터치 멈춤 화면이 같이 쓴다.
 * 한 번 더 묻고(실수로 나가지 않게), 저장되는지 알린 뒤 나간다. 저장하지 못하면 붙잡지 않고 「그래도 나가기」를 함께 내민다.
 * 실제로 나가는 일(저장 · 페이지 이동)은 부르는 쪽이 정한다(leave).
 */
import { useEffect, useState, type CSSProperties } from "react";

import { NAVY_FILL, UI, UI_FONT } from "./gameUi";

export type LeaveResult = "left" | "saveFailed";

export interface LeaveToLobbyAction {
  /** 나가기 전 한 줄 — 진행이 저장되는지 */
  note: string;
  /** 나간다. force 면 저장이 안 돼도 나간다. 저장하지 못했으면 "saveFailed" */
  leave: (force?: boolean) => Promise<LeaveResult>;
  /** 묻다가 그만뒀다 */
  cancel?: () => void;
}

type Phase = "idle" | "asking" | "leaving" | "failed";

export default function LeaveToLobby({ action, tone }: { action: LeaveToLobbyAction; tone: "panel" | "cover" }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const isCover = tone === "cover";
  // 브라우저 「뒤로」로 이 페이지가 캐시에서 되살아나면 「가는 중…」에 멈춰 있지 않게 처음으로
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPhase("idle");
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  const leave = async (force = false) => {
    setPhase("leaving");
    const result = await action.leave(force);
    if (result === "saveFailed") setPhase("failed");
  };
  const cancel = () => {
    setPhase("idle");
    action.cancel?.();
  };

  if (phase === "idle")
    return (
      <button
        type="button"
        style={isCover ? coverButtonStyle : panelButtonStyle}
        onClick={() => setPhase("asking")}
        data-testid="leave-to-lobby"
      >
        로비로 나가기
      </button>
    );

  return (
    <div style={isCover ? coverBoxStyle : panelBoxStyle} role="group" aria-label="로비로 나가기">
      <p style={questionStyle}>
        {phase === "failed"
          ? "저장하지 못했어요. 연결을 확인하고 다시 해 보거나, 저장 없이 나갈 수 있어요."
          : phase === "leaving"
            ? "저장하고 로비로 가는 중…"
            : "로비로 나갈까요?"}
      </p>
      {phase === "asking" && <p style={noteStyle}>{action.note}</p>}
      {phase !== "leaving" && (
        <div style={rowStyle}>
          {phase === "failed" ? (
            <>
              <button type="button" style={primaryStyle} onClick={() => void leave()}>
                다시 해 보기
              </button>
              <button type="button" style={secondaryStyle} onClick={() => void leave(true)}>
                그래도 나가기
              </button>
            </>
          ) : (
            <button type="button" style={primaryStyle} onClick={() => void leave()} data-testid="leave-confirm">
              나가기
            </button>
          )}
          <button type="button" style={secondaryStyle} onClick={cancel}>
            취소
          </button>
        </div>
      )}
    </div>
  );
}

const baseButton: CSSProperties = {
  minHeight: 44,
  padding: "0 18px",
  borderRadius: 22,
  font: `600 15px/1 ${UI_FONT.body}`,
  cursor: "pointer",
  touchAction: "manipulation",
};
const panelButtonStyle: CSSProperties = {
  ...baseButton,
  width: "100%",
  border: `1px solid ${UI.borderStrong}`,
  background: "transparent",
  color: UI.text,
};
const coverButtonStyle: CSSProperties = {
  ...baseButton,
  border: "1.5px solid rgba(242,238,228,.45)",
  background: "rgba(20,22,28,.6)",
  color: "#F2EEE4",
};
const panelBoxStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 14,
  borderRadius: 12,
  border: `1px solid ${UI.borderStrong}`,
  background: UI.surfaceRaised,
};
const coverBoxStyle: CSSProperties = {
  ...panelBoxStyle,
  gap: 6,
  padding: "10px 12px",
  maxWidth: "min(480px, calc(100vw - 32px))",
  background: "rgba(5,11,26,.92)",
  textAlign: "left",
};
const questionStyle: CSSProperties = { margin: 0, font: `600 15px/1.5 ${UI_FONT.body}`, color: UI.text };
const noteStyle: CSSProperties = { margin: 0, font: `400 13px/1.5 ${UI_FONT.body}`, color: UI.textMuted };
const rowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 };
const primaryStyle: CSSProperties = {
  ...baseButton,
  flex: "1 1 120px",
  border: `1px solid ${UI.borderStrong}`,
  background: NAVY_FILL,
  color: UI.text,
};
const secondaryStyle: CSSProperties = {
  ...baseButton,
  flex: "1 1 96px",
  border: `1px solid ${UI.border}`,
  background: "transparent",
  color: UI.textMuted,
};
