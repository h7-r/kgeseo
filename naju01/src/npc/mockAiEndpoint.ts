// 모의 AI 엔드포인트 — 검사 전용. fetch 와 같은 모양의 함수로 진짜 Response 객체를 돌려준다(서버 · 모델 없음).
// httpAiTransport 의 정상 · HTTP 오류 · 네트워크 실패 · 잘못된 JSON · 봉투 오류 · 지난 세션/차례 · 중복 응답 · 지연을 만든다.
// 대사는 「(모의 HTTP)」 로 시작해 진짜 응답으로 오해되지 않게 한다.
import type { AiDialogueRequest } from "./aiDialogueProvider";
import { NPC_DIALOGUE_RESPONSE_SCHEMA } from "./httpAiTransport";

export type MockEndpointMode =
  | "ok"
  | { status: number }
  | "network"
  | "bad_json"
  | "wrong_schema"
  | "stale_session"
  | "stale_turn"
  | "duplicate"
  | { delayMs: number };

export interface MockEndpointCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  credentials: RequestCredentials | undefined;
  body: AiDialogueRequest;
  aborted: boolean;
}

export interface MockAiEndpoint {
  fetch: typeof fetch;
  calls: MockEndpointCall[];
  setMode(mode: MockEndpointMode): void;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

export function createMockAiEndpoint(initial: MockEndpointMode = "ok", { lines = 2 } = {}): MockAiEndpoint {
  let mode = initial;
  const calls: MockEndpointCall[] = [];
  const reply = (req: AiDialogueRequest, responseId: string) => {
    if (req.kind === "next" && req.turn >= lines)
      return {
        schema: NPC_DIALOGUE_RESPONSE_SCHEMA,
        session_id: req.session_id,
        turn: req.turn,
        response_id: responseId,
        end: true,
      };
    return {
      schema: NPC_DIALOGUE_RESPONSE_SCHEMA,
      session_id: req.session_id,
      turn: req.turn,
      response_id: responseId,
      text: `(모의 HTTP) ${req.intent === "hint_offer" ? "도움" : "대화"} ${req.turn + 1}번째 대사`,
      last: req.turn === lines - 1,
    };
  };
  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = JSON.parse(String(init?.body)) as AiDialogueRequest;
    const call: MockEndpointCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      credentials: init?.credentials,
      body,
      aborted: false,
    };
    calls.push(call);
    const signal = init?.signal;
    const abortError = () => new DOMException("요청이 끊겼다", "AbortError");
    if (signal?.aborted) {
      call.aborted = true;
      throw abortError();
    }
    const m = mode;
    if (typeof m === "object" && "delayMs" in m) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, m.delayMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          call.aborted = true;
          reject(abortError());
        });
      });
      return json(reply(body, `r-${calls.length}`));
    }
    if (typeof m === "object" && "status" in m) return json({ detail: "모의 오류" }, m.status);
    switch (m) {
      case "network":
        throw new TypeError("Failed to fetch (모의 네트워크 실패)");
      case "bad_json":
        return new Response("{ 이건 JSON 이 아니다", { status: 200, headers: { "Content-Type": "application/json" } });
      case "wrong_schema":
        return json({ ...reply(body, `r-${calls.length}`), schema: "다른/0.9" });
      case "stale_session":
        return json({ ...reply(body, `r-${calls.length}`), session_id: body.session_id - 1 });
      case "stale_turn":
        return json({ ...reply(body, `r-${calls.length}`), turn: body.turn + 1 });
      case "duplicate":
        return json(reply(body, "r-같은응답"));
      default:
        return json(reply(body, `r-${calls.length}`));
    }
  }) as typeof fetch;
  return {
    fetch: mockFetch,
    calls,
    setMode(next) {
      mode = next;
    },
  };
}
