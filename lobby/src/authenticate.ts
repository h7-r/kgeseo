// 매칭 인증(static onAuth) — 설계 v0.19 3절 표의 순서 그대로.
//   1) 출처 확인(첫 줄) → 2) 같은 HTTP 요청의 재시도면 저장한 결과(만료만 다시 확인)
//   → 3) 티켓 검증 → 4) usedJti 확인·등록(사이에 await 없음) → 5) 인증 정보 객체를 키로 WeakMap 에 보관
// 같은 요청인지는 SDK 가 넘긴 인증 정보 객체가 같은지로만 판단한다. 클라이언트가 보낸 요청 ID·헤더는 믿지 않는다.
// Core 0.18.10: joinOrCreate 는 좌석 충돌(SeatReservationError) 때 같은 authContext 로 최대 5번 다시 부른다.
import { authError, REJECT } from "./errors.js";
import type { TicketVerifier, VerifiedTicket } from "./ticket.js";
import type { UsedJtiRegistry } from "./usedJti.js";

/** Colyseus 가 onAuth 셋째 인자로 넘기는 인증 정보(필요한 부분만) */
export interface AuthContextLike {
  token?: string | null;
  readonly headers: { get(name: string): string | null };
}

export interface AuthenticatorOptions {
  allowedOrigins: readonly string[];
  verifyTicket: TicketVerifier;
  usedJti: UsedJtiRegistry;
  now?: () => number;
  /** 시험 장치 — 같은 요청에서 인증이 몇 번 불렸는지 남긴다(LOBBY_TEST_HOOKS 일 때만 넘긴다) */
  onAuthCall?: (context: object, event: "first" | "reused") => void;
}

export function isAllowedOrigin(origin: string | null | undefined, allowedOrigins: readonly string[]): boolean {
  return typeof origin === "string" && allowedOrigins.includes(origin);
}

export function createAuthenticator({
  allowedOrigins,
  verifyTicket,
  usedJti,
  now = () => Date.now() / 1000,
  onAuthCall,
}: AuthenticatorOptions) {
  const results = new WeakMap<object, Promise<VerifiedTicket>>();

  async function firstCall(token: unknown): Promise<VerifiedTicket> {
    const check = await verifyTicket(token);
    if (!check.ok) throw authError(check.reason);
    const { ticket } = check;
    // 여기부터 등록까지 await 이 없다 — 같은 티켓을 동시에 낸 다른 요청은 한쪽만 통과한다.
    if (!usedJti.claim(ticket.jti, ticket.exp)) throw authError(REJECT.TICKET_USED);
    return ticket;
  }

  return function authenticate(token: unknown, _options: unknown, context: AuthContextLike | undefined) {
    // 1) 출처 — CORS 헤더는 브라우저가 응답을 못 읽게 할 뿐 서버의 매칭 실행은 막지 않는다
    if (!context || !isAllowedOrigin(context.headers.get("origin"), allowedOrigins)) {
      return Promise.reject(authError(REJECT.ORIGIN_NOT_ALLOWED));
    }
    // 2) 같은 요청의 내부 재시도
    const previous = results.get(context);
    if (previous) {
      onAuthCall?.(context, "reused");
      return previous.then((ticket) => {
        if (now() >= ticket.exp) throw authError(REJECT.TICKET_EXPIRED);
        return ticket;
      });
    }
    onAuthCall?.(context, "first");
    const pending = firstCall(token);
    results.set(context, pending);
    return pending;
  };
}

export type Authenticator = ReturnType<typeof createAuthenticator>;
