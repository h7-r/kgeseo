/**
 * 나주 게임 한 벌의 진행 동기화 — 동행 NPC 세션(companionRuntime 의 companionSession)에 붙인다.
 * 퍼즐 · 구역 코드는 여기 najuProgress 만 부른다. 대응표는 확정 뒤 najuProgress.setIdTable(...) 로 넣는다 —
 * 그 전에는 모든 ID 가 미매핑이라 서버로 아무것도 보내지 않는다(콘솔에 진단만 남긴다).
 * 아직 이 파일을 부르는 퍼즐은 없다.
 */
import { companionSession } from "../companion/companionRuntime";
import { createProgressRuntime } from "./progressRuntime.ts";

export const najuProgress = createProgressRuntime({
  session: companionSession,
  ids: null,
  onUnmapped: (report) => console.warn("[진행 동기화] 대응표에 없는 로컬 ID — 보내지 않음", report),
});
