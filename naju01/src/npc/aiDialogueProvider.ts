// AI 대사 공급자 어댑터 — 기존 NpcDialogueProvider(open · next) 계약 그대로, 대사를 AI 전송(transport)에 묻고
// 응답을 검증한 뒤 쓴다. 실패 · 시간 초과 · 잘못된 응답이면 고정 대사 공급자(fallback)로 같은 차례를 답한다.
// 모델 · 백엔드는 연결하지 않는다 — transport 는 주입한다(지금은 검사 · 개발용 가짜 전송만 있다: mockAiTransport.ts).
//
// [시간] transport 에 자체 시간 제한(기본 2.5 s)을 둔다. 대화 세션의 응답 제한(5 s)보다 짧아야 fallback 이 그 안에 답한다.
// [취소] 세션이 요청을 끊으면(닫힘 · 지난 세션) transport 도 끊고 fallback 을 부르지 않는다 — 응답은 어차피 버려진다.
// [고정] 한 세션에서 한 번 fallback 으로 넘어가면 그 세션 끝까지 fallback 을 쓴다(AI · 고정 대사가 번갈아 나오지 않게).
// [검증] 응답은 { text, last?, end? } 만 쓴다. text 는 비지 않은 문자열 · 길이 제한 · 제어 문자 없음. speaker 는 받지 않는다
//   (NPC 이름은 설정 값 — AI 가 바꾸지 않는다). 내용(힌트 · 정답 노출 등)은 여기서 판단하지 않는다 — 다음 단계의 내용 정책이다.
import { DIALOGUE_CONTENT_TYPES, type DialogueContentType } from "./dialogueContent";
import type { ContentCandidate, ContentVerdict } from "./dialogueContentPolicy";
import type { NpcAiInput } from "./npcAiInput";
import type { DialogIntent, NpcDialogueContext, NpcDialogueProvider, NpcLine } from "./npcDialogue";

export const NPC_DIALOGUE_REQUEST_SCHEMA = "npc_dialogue_request/0.1";

/** AI 에 보내는 요청 — JSON 으로 그대로 직렬화된다 */
export interface AiDialogueRequest {
  readonly schema: typeof NPC_DIALOGUE_REQUEST_SCHEMA;
  readonly kind: "open" | "next";
  readonly session_id: number;
  readonly turn: number;
  readonly intent: DialogIntent;
  readonly speaker: string;
  readonly observation: {
    readonly distance: number | null;
    readonly zone: string | null;
    readonly recent_events: readonly string[];
  } | null;
  /** npc_ai_input/0.1 (없으면 null) */
  readonly ai_input: NpcAiInput | null;
  /** 이 차례가 허용된 마지막 차례인지 — AI 가 대화를 맺도록 */
  readonly final_turn: boolean;
}

/** 전송: 요청을 보내고 날것의 응답(검증 전)을 돌려준다. signal 이 끊기면 그만둬야 한다 */
export type AiDialogueTransport = (request: AiDialogueRequest, signal: AbortSignal) => Promise<unknown>;

export const AI_PROVIDER_CONFIG = {
  /** transport 시간 제한 (ms) — 대화 세션 제한(5000 ms)보다 짧게 */
  timeoutMs: 2500,
  /** 대사 최대 글자 수 */
  maxTextLength: 200,
  /** 한 대화의 최대 차례 수 — 이 차례 대사는 마지막으로 친다 */
  maxTurns: 6,
  /** 결과 기록 수 */
  recordLimit: 20,
};

export type AiProviderConfig = typeof AI_PROVIDER_CONFIG;

export type AiFallbackReason =
  | "timeout"
  | "transport_error"
  | "invalid_response"
  | "sticky_fallback" // 이 세션은 이미 fallback 으로 넘어감
  | "end_on_open" // 첫 대사 요청에 대화 끝을 답함 — 첫 대사는 있어야 한다
  | "content_rejected" // 콘텐츠 정책이 막음 (13단계)
  | "unsafe_request"; // 요청에 아직 비밀인 말이 섞여 보내지 않음 (13단계)

export interface AiProviderRecord {
  readonly sessionId: number;
  readonly turn: number;
  readonly kind: "open" | "next";
  readonly intent: DialogIntent;
  readonly source: "ai" | "fallback" | "aborted";
  readonly reason: AiFallbackReason | null;
  /** 검증 실패 내용 (invalid_response · content_rejected 일 때) */
  readonly detail: string | null;
  readonly ms: number;
  /** 화면에 내보낸 승인 대사 id (콘텐츠 정책을 통과한 경우) */
  readonly lineId?: string | null;
}

export type AiValidation =
  | {
      ok: true;
      kind: "line";
      line: NpcLine;
      /** 대사 유형 · 고른 승인 대사 id (응답이 밝혔으면) — 콘텐츠 정책이 쓴다 */
      meta: { contentType: DialogueContentType | null; lineId: string | null };
    }
  | { ok: true; kind: "end" }
  | { ok: false; detail: string };

// 줄바꿈 · 탭을 뺀 제어 문자 · 방향 바꿈 문자
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/;

/** AI 응답 검증. allowEnd 면 { end: true } 를 대화 끝으로 받는다 */
export function validateAiDialogueResponse(
  raw: unknown,
  allowEnd: boolean,
  config: AiProviderConfig = AI_PROVIDER_CONFIG,
): AiValidation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, detail: "객체가 아님" };
  const r = raw as Record<string, unknown>;
  if (r.end === true) return allowEnd ? { ok: true, kind: "end" } : { ok: false, detail: "첫 대사에 end" };
  if (r.end !== undefined && r.end !== false) return { ok: false, detail: "end 가 boolean 이 아님" };
  if (typeof r.text !== "string") return { ok: false, detail: "text 가 문자열이 아님" };
  const text = r.text.replace(/\r\n?/g, "\n").trim();
  if (!text) return { ok: false, detail: "text 가 비었음" };
  if (text.length > config.maxTextLength)
    return { ok: false, detail: `text 가 ${config.maxTextLength}자를 넘음 (${text.length})` };
  if (CONTROL.test(text)) return { ok: false, detail: "제어 문자" };
  if (r.last !== undefined && typeof r.last !== "boolean") return { ok: false, detail: "last 가 boolean 이 아님" };
  if (r.content_type !== undefined && !DIALOGUE_CONTENT_TYPES.includes(r.content_type as DialogueContentType))
    return { ok: false, detail: "content_type 이 알 수 없는 값" };
  if (r.line_id !== undefined && (typeof r.line_id !== "string" || !r.line_id || r.line_id.length > 64))
    return { ok: false, detail: "line_id 가 문자열이 아님" };
  return {
    ok: true,
    kind: "line",
    line: { text, last: r.last === true },
    meta: {
      contentType: (r.content_type as DialogueContentType | undefined) ?? null,
      lineId: (r.line_id as string | undefined) ?? null,
    },
  };
}

export interface AiDialogueProviderOptions {
  transport: AiDialogueTransport;
  /** 실패 때 같은 차례를 답할 공급자 (보통 고정 대사) */
  fallback: NpcDialogueProvider;
  config?: AiProviderConfig;
  /** 콘텐츠 정책 (선택) — 형식 검증 뒤에 부른다. 막으면 fallback(content_rejected) */
  contentPolicy?: (candidate: ContentCandidate, context: NpcDialogueContext) => ContentVerdict;
  /** 요청 검사 (선택) — 보내면 안 되는 요청이면 이유를 돌려준다. 그때는 보내지 않고 fallback(unsafe_request) */
  requestGuard?: (request: AiDialogueRequest) => string | null;
}

export interface AiDialogueProvider extends NpcDialogueProvider {
  /** 최근 결과 (최신이 마지막) */
  records(): readonly AiProviderRecord[];
}

class AbortedError extends Error {
  constructor() {
    super("대화 세션이 요청을 끊었다");
    this.name = "AbortError";
  }
}

export function createAiDialogueProvider({
  transport,
  fallback,
  config = AI_PROVIDER_CONFIG,
  contentPolicy,
  requestGuard,
}: AiDialogueProviderOptions): AiDialogueProvider {
  let records: AiProviderRecord[] = [];
  const fallbackSessions = new Set<number>();

  const record = (r: AiProviderRecord) => {
    records = [...records, Object.freeze(r)].slice(-config.recordLimit);
  };

  const toRequest = (kind: "open" | "next", c: NpcDialogueContext): AiDialogueRequest => {
    const o = c.observation;
    return Object.freeze({
      schema: NPC_DIALOGUE_REQUEST_SCHEMA,
      kind,
      session_id: c.sessionId,
      turn: c.turn,
      intent: c.intent ?? "manual",
      speaker: c.speaker,
      observation: o
        ? {
            distance: Number.isFinite(o.distance) ? o.distance : null,
            zone: o.zone,
            recent_events: [...o.recentEvents],
          }
        : null,
      ai_input: c.aiInput ?? null,
      final_turn: c.turn >= config.maxTurns - 1,
    });
  };

  /** transport 를 시간 제한 · 세션 취소와 함께 부른다 */
  const callTransport = (request: AiDialogueRequest, sessionSignal: AbortSignal) =>
    new Promise<unknown>((resolve, reject) => {
      const controller = new AbortController();
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sessionSignal.removeEventListener("abort", onSessionAbort);
        fn();
      };
      const onSessionAbort = () => {
        controller.abort();
        finish(() => reject(new AbortedError()));
      };
      const timer = setTimeout(() => {
        controller.abort();
        finish(() => reject(Object.assign(new Error("시간 초과"), { reason: "timeout" as const })));
      }, config.timeoutMs);
      if (sessionSignal.aborted) {
        onSessionAbort();
        return;
      }
      sessionSignal.addEventListener("abort", onSessionAbort);
      let reply: Promise<unknown>;
      try {
        reply = Promise.resolve(transport(request, controller.signal));
      } catch (error) {
        reply = Promise.reject(error);
      }
      reply.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    });

  const answer = async (
    kind: "open" | "next",
    context: NpcDialogueContext,
    signal: AbortSignal,
  ): Promise<NpcLine | null> => {
    const start = performance.now();
    const intent = context.intent ?? "manual";
    const base = { sessionId: context.sessionId, turn: context.turn, kind, intent };
    const viaFallback = async (reason: AiFallbackReason, detail: string | null) => {
      fallbackSessions.add(context.sessionId);
      record({ ...base, source: "fallback", reason, detail, ms: performance.now() - start });
      return kind === "open" ? fallback.open(context, signal) : fallback.next(context, signal);
    };
    if (fallbackSessions.has(context.sessionId)) return viaFallback("sticky_fallback", null);
    // 허용된 차례를 다 썼으면 AI 에 묻지 않고 끝낸다
    if (kind === "next" && context.turn >= config.maxTurns) {
      record({ ...base, source: "ai", reason: null, detail: "차례 한도", ms: 0 });
      return null;
    }
    const request = toRequest(kind, context);
    const unsafe = requestGuard?.(request) ?? null;
    if (unsafe) return viaFallback("unsafe_request", unsafe);
    let raw: unknown;
    try {
      raw = await callTransport(request, signal);
    } catch (error) {
      if (error instanceof AbortedError) {
        record({ ...base, source: "aborted", reason: null, detail: null, ms: performance.now() - start });
        throw error;
      }
      // 전송이 붙인 이유: timeout(시간 초과) · invalid_response(HTTP 응답 봉투 · JSON 문제) · 그 밖은 전송 실패
      const tagged = (error as { reason?: string } | null)?.reason;
      return viaFallback(
        tagged === "timeout" ? "timeout" : tagged === "invalid_response" ? "invalid_response" : "transport_error",
        error instanceof Error ? error.message : String(error),
      );
    }
    const valid = validateAiDialogueResponse(raw, kind === "next", config);
    if (!valid.ok)
      return viaFallback(
        kind === "open" && (raw as { end?: unknown })?.end === true ? "end_on_open" : "invalid_response",
        valid.detail,
      );
    if (valid.kind === "end") {
      record({ ...base, source: "ai", reason: null, detail: null, ms: performance.now() - start });
      return null;
    }
    let line = valid.line;
    let lineId: string | null = null;
    if (contentPolicy) {
      const verdict = contentPolicy({ ...valid.line, ...valid.meta, last: valid.line.last === true }, context);
      if (!verdict.allow) return viaFallback("content_rejected", [...verdict.reasons, ...verdict.details].join(" · "));
      line = verdict.line;
      lineId = verdict.lineId;
    }
    record({ ...base, source: "ai", reason: null, detail: null, ms: performance.now() - start, lineId });
    // 차례 한도의 마지막 차례면 AI 가 last 를 안 붙여도 마지막으로 친다
    return { ...line, last: line.last === true || request.final_turn };
  };

  return {
    open: async (context, signal) => (await answer("open", context, signal)) ?? { text: "…", last: true },
    next: (context, signal) => answer("next", context, signal),
    records: () => records,
  };
}
