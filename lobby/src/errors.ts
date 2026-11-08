// 로비가 클라이언트에 내려보내는 거절 사유. 화면은 사유 문자열(message)로 갈라 처리한다(설계 3.2·4절).
// Colyseus 는 매칭 오류 code 를 그대로 HTTP 상태로 쓴다(520번대) — 인증 거절은 기본 AUTH_FAILED(525),
// 방 상한은 따로 529 를 쓴다.
import { ErrorCode, ServerError } from "@colyseus/core";

export const LOBBY_FULL_CODE = 529;

export const REJECT = {
  /** 허용하지 않은 출처(또는 출처 없음) — 재시도하지 않는다 */
  ORIGIN_NOT_ALLOWED: "ORIGIN_NOT_ALLOWED",
  /** 서명·알고리즘·대상·필수 필드가 틀림 */
  TICKET_INVALID: "TICKET_INVALID",
  /** 만료(매칭 때 또는 입장 때) */
  TICKET_EXPIRED: "TICKET_EXPIRED",
  /** 다른 HTTP 요청에서 이미 쓴 티켓 — 새 티켓으로 다시 시도 */
  TICKET_USED: "TICKET_USED",
  /** 로비가 다시 시작하기 전에 발급된 티켓(같은 초 포함) — 새 티켓으로 다시 시도 */
  TICKET_STALE: "TICKET_STALE",
  /** 입장 인증 정보가 없다 */
  AUTH_MISSING: "AUTH_MISSING",
  /** 방 수 상한 */
  LOBBY_FULL: "LOBBY_FULL",
} as const;

export type RejectReason = (typeof REJECT)[keyof typeof REJECT];

export function authError(reason: RejectReason): ServerError {
  return new ServerError(ErrorCode.AUTH_FAILED, reason);
}

export function lobbyFullError(): ServerError {
  return new ServerError(LOBBY_FULL_CODE, REJECT.LOBBY_FULL);
}
