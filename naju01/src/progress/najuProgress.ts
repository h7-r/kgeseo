/**
 * 나주 게임 한 벌의 진행 동기화 — 동행 NPC 세션(companionRuntime 의 companionSession)에 붙인다.
 * 퍼즐 · 구역 코드는 여기 najuProgress 만 부른다. 대응표(najuIdTable)는 만들 때 넣는다 — 표에 없는 로컬 ID 는
 * 서버로 보내지 않는다(콘솔에 진단만 남긴다). 다음 판 대응표는 najuProgress.setIdTable(...) 로 바꿔 넣는다.
 * 조사(읽었다) 기록은 najuInspect — 대응표를 바꿔 넣은 뒤에는 najuInspect.flush() 로 기다리던 것을 보낸다.
 */
import { companionSession } from "../companion/companionRuntime";
import { createInspectRecorder } from "./inspectRecorder.ts";
import { NAJU_ID_TABLE_V1 } from "./najuIdTable.ts";
import { markInteractionSend, noteInteractionSent } from "./pausedSinceInteraction";
import { createProgressRuntime } from "./progressRuntime.ts";

export const najuProgress = createProgressRuntime({
  session: companionSession,
  ids: NAJU_ID_TABLE_V1,
  onUnmapped: (report) => console.warn("[진행 동기화] 대응표에 없는 로컬 ID — 보내지 않음", report),
  // 동행 auto 턴의 「마지막 상호작용 뒤 멈춘 시간」 기준점 — 처음 보낸 때 찍고, 서버가 받으면 그 표시로
  markSend: markInteractionSend,
  onSent: noteInteractionSent,
});

export const najuInspect = createInspectRecorder({
  runtime: najuProgress,
  playSessionId: () => {
    const status = companionSession.getStatus();
    return status.phase === "ready" ? status.playSessionId : null;
  },
  subscribe: companionSession.subscribe,
  onDiagnostic: (message, detail) => console.info(`[조사 기록] ${message}`, detail ?? ""),
});
