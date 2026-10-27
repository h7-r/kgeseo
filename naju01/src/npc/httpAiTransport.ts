// HTTP AI 전송 — aiDialogueProvider 의 AiDialogueTransport 를 같은 출처 HTTP API 로 잇는다(앞으로 FastAPI 가 줄 /api/... 경로).
// 브라우저가 외부 모델 서비스에 직접 붙지 않게 **같은 출처의 상대 경로만** 받는다. 인증은 같은 출처 쿠키(credentials: same-origin)로
// 하고, 헤더로 키 · 비밀값을 넣는 길을 두지 않는다. 시간 제한은 공급자(2.5 s)가 걸고 signal 로 fetch 를 끊는다.
//
// [요청] POST · JSON 본문 = npc_dialogue_request/0.1 그대로.
// [응답] npc_dialogue_response/0.1 봉투: { schema, session_id, turn, response_id?, text?, last?, end?, content_type?, line_id? }
//   content_type · line_id 는 13단계 선택 필드 — 콘텐츠 정책이 쓴다(없으면 정책이 막는다).
//   봉투를 검사한 뒤 { text, last, end } 만 공급자에 넘긴다(대사 검증은 공급자의 validateAiDialogueResponse).
//   - HTTP 오류 · 네트워크 실패 → transport_error
//   - JSON 이 아님 · 봉투가 틀림 · 다른 세션/차례의 응답 · 같은 response_id 반복 → invalid_response
import type { AiDialogueRequest, AiDialogueTransport } from "./aiDialogueProvider";

export const NPC_DIALOGUE_RESPONSE_SCHEMA = "npc_dialogue_response/0.1";

/** 같은 출처 기본 경로 — FastAPI 쪽 엔드포인트가 생기면 이 경로로 맞춘다(설정으로 바꿀 수 있다) */
export const DEFAULT_NPC_DIALOGUE_ENDPOINT = "/api/v1/npc/dialogue";

export interface HttpAiTransportOptions {
  /** 같은 출처 상대 경로 (예: "/api/v1/npc/dialogue"). 다른 출처 · 프로토콜 상대 주소는 거부한다 */
  endpoint?: string;
  /** 검사용 fetch 바꿔치기 (기본 window.fetch) */
  fetchImpl?: typeof fetch;
  /** 같은 출처 판정 기준 (기본 location.origin) */
  origin?: string;
}

/** 응답 봉투 문제 — 공급자가 invalid_response 로 기록한다 */
export class AiResponseRejected extends Error {
  readonly reason = "invalid_response" as const;
  constructor(message: string) {
    super(message);
    this.name = "AiResponseRejected";
  }
}

/** HTTP 상태 오류 — 공급자가 transport_error 로 기록한다 */
export class AiHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "AiHttpError";
  }
}

/** endpoint 를 같은 출처 URL 로 푼다. 다른 출처면 던진다 */
export function resolveSameOriginEndpoint(endpoint: string, origin: string): string {
  if (!endpoint.startsWith("/") || endpoint.startsWith("//"))
    throw new Error(`같은 출처 상대 경로만 받는다: ${endpoint}`);
  const url = new URL(endpoint, origin);
  if (url.origin !== new URL(origin).origin) throw new Error(`다른 출처: ${url.origin}`);
  return url.pathname + url.search;
}

export function createHttpAiTransport({
  endpoint = DEFAULT_NPC_DIALOGUE_ENDPOINT,
  fetchImpl,
  origin = typeof location !== "undefined" ? location.origin : "http://localhost",
}: HttpAiTransportOptions = {}): AiDialogueTransport {
  const path = resolveSameOriginEndpoint(endpoint, origin);
  const doFetch = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  // 세션마다 받은 response_id — 같은 응답을 두 번 쓰지 않는다
  const seen = new Map<number, Set<string>>();

  return async (request: AiDialogueRequest, signal: AbortSignal) => {
    const response = await doFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) throw new AiHttpError(response.status);
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") throw error;
      throw new AiResponseRejected("JSON 이 아님");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body))
      throw new AiResponseRejected("봉투가 객체가 아님");
    const b = body as Record<string, unknown>;
    if (b.schema !== NPC_DIALOGUE_RESPONSE_SCHEMA)
      throw new AiResponseRejected(`schema 가 ${NPC_DIALOGUE_RESPONSE_SCHEMA} 가 아님`);
    if (b.session_id !== request.session_id)
      throw new AiResponseRejected(`다른 세션의 응답 (${String(b.session_id)} ≠ ${request.session_id})`);
    if (b.turn !== request.turn) throw new AiResponseRejected(`다른 차례의 응답 (${String(b.turn)} ≠ ${request.turn})`);
    if (b.response_id !== undefined) {
      if (typeof b.response_id !== "string" || !b.response_id)
        throw new AiResponseRejected("response_id 가 문자열이 아님");
      const ids = seen.get(request.session_id) ?? new Set<string>();
      if (ids.has(b.response_id)) throw new AiResponseRejected(`같은 응답 반복 (${b.response_id})`);
      ids.add(b.response_id);
      seen.set(request.session_id, ids);
      if (seen.size > 50) seen.delete(seen.keys().next().value as number);
    }
    // 대사 필드만 넘긴다 — 나머지 검증(text · last · end)은 공급자가 한다
    return { text: b.text, last: b.last, end: b.end, content_type: b.content_type, line_id: b.line_id };
  };
}
