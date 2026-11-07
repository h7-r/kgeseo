/**
 * 나주 게임 한 벌의 진행 동기화 — 동행 NPC 세션(companionRuntime 의 companionSession)에 붙인다.
 * 퍼즐 · 구역 코드는 여기 najuProgress 만 부른다. 대응표는 확정 뒤 najuProgress.setIdTable(...) 로 넣는다 —
 * 그 전에는 모든 ID 가 미매핑이라 서버로 아무것도 보내지 않는다(콘솔에 진단만 남긴다).
 * 조사(읽었다) 기록은 najuInspect — 대응표를 넣은 뒤에는 najuInspect.flush() 로 기다리던 것을 보낸다.
 */
import { companionSession } from "../companion/companionRuntime";
import { createInspectRecorder } from "./inspectRecorder.ts";
import { createProgressRuntime } from "./progressRuntime.ts";

export const najuProgress = createProgressRuntime({
  session: companionSession,
  ids: null,
  onUnmapped: (report) => console.warn("[진행 동기화] 대응표에 없는 로컬 ID — 보내지 않음", report),
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
