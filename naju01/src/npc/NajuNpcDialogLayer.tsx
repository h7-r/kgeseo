// NPC 대화 화면 — 게임 React 루트와 따로 도는 작은 루트. NajuScene(캔버스 안)에는 DOM 을 그릴 수 없고 App 은 고치지 않으므로,
// 훅이 `.game-stage` 안에 컨테이너를 하나 만들어 여기를 붙인다(게임의 overlayDom.ts 도 DOM 을 직접 붙인다).
// 상태는 dialogSession · 안내 저장소를 useSyncExternalStore 로 구독한다 — 게임 루트를 다시 그리지 않는다.
// 겹침: 레이어 전체가 pointer-events:none(포인터 잠금 유지 — 마우스로 누를 것이 없다). z-index 26 = 첫 안내(25) · 개발 도움말(20) 위,
// 레터박스(30) · 연출 설정 창(40) 아래. 대화 안내는 화면 가운데 아래, 대화창은 아래쪽 띠 위(bottom 14%).
import { useSyncExternalStore, type CSSProperties } from "react";

import type { DialogSession, InteractionPromptStore } from "./dialogSession";

const FONT = '"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif';

const promptStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "60%",
  transform: "translateX(-50%)",
  padding: "6px 12px",
  borderRadius: 14,
  background: "rgba(14,18,26,.72)",
  border: "1px solid rgba(170,190,220,.35)",
  color: "#E8EFFA",
  font: `600 14px/1.4 ${FONT}`,
  whiteSpace: "nowrap",
};
const dialogStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: "14%",
  transform: "translateX(-50%)",
  width: "min(560px, calc(100% - 32px))",
  boxSizing: "border-box",
  padding: "14px 18px",
  borderRadius: 10,
  background: "rgba(14,18,26,.86)",
  border: "1px solid rgba(154,124,255,.55)",
  color: "#E8EFFA",
  font: `15px/1.6 ${FONT}`,
};
const speakerStyle: CSSProperties = { color: "#C9B8FF", fontSize: 13, fontWeight: 700, marginBottom: 4 };
const hintStyle: CSSProperties = { marginTop: 8, color: "#8B94A6", fontSize: 12, textAlign: "right" };

function NpcPrompt({ prompt }: { prompt: InteractionPromptStore }) {
  const kind = useSyncExternalStore(prompt.subscribe, prompt.get);
  if (!kind) return null;
  return (
    <div style={promptStyle} data-npc-prompt={kind}>
      {kind === "help" ? "[F] 도움 · [G] 괜찮아" : "[F] 대화"}
    </div>
  );
}

function NpcDialogBox({ session }: { session: DialogSession }) {
  const s = useSyncExternalStore(session.subscribe, session.getSnapshot);
  if (s.phase === "closed") return null;
  return (
    <div style={dialogStyle} role="dialog" aria-label="NPC 대화" data-npc-dialog={s.phase}>
      <div style={speakerStyle} data-npc-dialog-speaker="">
        {s.speaker}
      </div>
      <div data-npc-dialog-text="">{s.phase === "showing" ? s.text : "…"}</div>
      <div style={hintStyle}>{s.last ? "[F]·[Enter] 끝내기 · [Esc] 닫기" : "[F]·[Enter] 다음 · [Esc] 닫기"}</div>
    </div>
  );
}

export function NajuNpcDialogLayer({ session, prompt }: { session: DialogSession; prompt: InteractionPromptStore }) {
  return (
    <>
      <NpcPrompt prompt={prompt} />
      <NpcDialogBox session={session} />
    </>
  );
}
