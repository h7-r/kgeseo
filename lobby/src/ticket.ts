// 입장권(JWT) 검증. FastAPI(backend/app/services/lobby_ticket.py)가 같은 키로 HS256 서명한다(설계 3절).
// 티켓 원문은 로그에 남기지 않는다.
import { errors as joseErrors, jwtVerify } from "jose";

import { REJECT, type RejectReason } from "./errors.js";

export const TICKET_AUDIENCE = "waegok-lobby";
export const NICKNAME_MAX_LENGTH = 40;

export interface VerifiedTicket {
  /** 계정 ID — 방 상태에 넣지 않는다 */
  sub: string;
  nickname: string;
  /** 티켓 ID — 방 상태에 넣지 않는다 */
  jti: string;
  /** UTC Unix 초 */
  exp: number;
}

export type TicketCheck = { ok: true; ticket: VerifiedTicket } | { ok: false; reason: RejectReason };

export interface TicketVerifierOptions {
  secret: Uint8Array;
  /** 이 프로세스가 시작한 Unix 초. iat 가 이보다 커야 받는다(3.2절) */
  processStartSec: number;
  /** 지금(Unix 초, 소수 가능). 시험에서 바꾼다 */
  now?: () => number;
}

const isNonEmptyString = (value: unknown, max = 200): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

export function createTicketVerifier({ secret, processStartSec, now = () => Date.now() / 1000 }: TicketVerifierOptions) {
  return async function verifyTicket(token: unknown): Promise<TicketCheck> {
    if (!isNonEmptyString(token, 4096)) return { ok: false, reason: REJECT.TICKET_INVALID };
    let payload;
    try {
      ({ payload } = await jwtVerify(token, secret, {
        algorithms: ["HS256"],
        audience: TICKET_AUDIENCE,
        requiredClaims: ["sub", "jti", "iat", "exp"],
        currentDate: new Date(now() * 1000),
      }));
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) return { ok: false, reason: REJECT.TICKET_EXPIRED };
      return { ok: false, reason: REJECT.TICKET_INVALID };
    }
    const { sub, jti, iat, exp, nickname } = payload;
    if (!isNonEmptyString(sub) || !isNonEmptyString(jti) || !isNonEmptyString(nickname, NICKNAME_MAX_LENGTH)) {
      return { ok: false, reason: REJECT.TICKET_INVALID };
    }
    if (typeof iat !== "number" || typeof exp !== "number" || !Number.isInteger(iat) || !Number.isInteger(exp)) {
      return { ok: false, reason: REJECT.TICKET_INVALID };
    }
    if (exp <= iat) return { ok: false, reason: REJECT.TICKET_INVALID };
    // 재시작 이전에 발급된 티켓은 이전 프로세스의 usedJti 기록을 모른다. 같은 초도 일시적 실패로 본다.
    if (iat <= processStartSec) return { ok: false, reason: REJECT.TICKET_STALE };
    if (now() >= exp) return { ok: false, reason: REJECT.TICKET_EXPIRED };
    return { ok: true, ticket: { sub, nickname, jti, exp } };
  };
}

export type TicketVerifier = ReturnType<typeof createTicketVerifier>;
