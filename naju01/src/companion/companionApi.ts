/**
 * 동행 NPC 가 쓰는 백엔드 창구 — NPC 턴 · 정식 Hint API · 플레이 세션.
 * 계약 기준은 저장소 백엔드 코드(backend/app/schemas/npc_turn.py · hint.py · play_session.py)다.
 *
 * 본편 src/server/api.ts 는 소화전 자물쇠(case_001) 전용이고 오류 detail 을 문자열로 뭉갠다.
 * 여기서는 detail 원형(문자열 · 배열 · { code })을 그대로 보존해야 힌트 오류 코드를 가를 수 있어 따로 둔다.
 * 이 파일은 React · 별칭(@/) 을 쓰지 않는다 — node --test 로 바로 돈다(naju01/tests).
 */

import { apiOrigin } from "../../../shared/deploymentUrls.ts";

const API_ORIGIN = apiOrigin(import.meta.env?.VITE_API_ORIGIN, import.meta.env?.PROD ?? false);

/** 서버 오류 — 화면에는 code 로 고른 한국어 문구만 띄우고, 영문 detail 은 콘솔에만 남긴다. */
export class CompanionApiError extends Error {
  readonly status: number | null;
  /** 응답 본문의 detail 원형. 네트워크 오류면 null */
  readonly detail: unknown;
  readonly body: unknown;

  constructor(status: number | null, detail: unknown, body: unknown, options?: ErrorOptions) {
    super(`companion api ${status ?? "network"}`, options);
    this.name = "CompanionApiError";
    this.status = status;
    this.detail = detail;
    this.body = body;
  }
}

/** detail 이 문자열이면 그 값, { code } 객체면 code. 배열(422)이면 null */
export function errorCode(error: unknown): string | null {
  if (!(error instanceof CompanionApiError)) return null;
  const { detail } = error;
  if (typeof detail === "string") return detail;
  if (typeof detail === "object" && detail !== null && !Array.isArray(detail) && "code" in detail) {
    const code = (detail as { code: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

// ── 계약 모양 ──

export type NpcTurnTrigger = "player_message" | "auto";

export interface NpcTurnBody {
  client_event_id: string;
  client_timestamp: string;
  trigger: NpcTurnTrigger;
  message?: string;
  focus_object_id?: string;
}

export type FallbackReason =
  | "NPC_GENERIC_PACK_MISSING"
  | "NPC_CONTENT_WITHDRAWN"
  | "NPC_CONTENT_MISSING"
  | "NPC_CONTENT_VERSION_MISMATCH"
  | "NPC_CONTENT_INVALID";

export interface NpcTurnResponse {
  npc_event_id: string;
  reply: { source: "generated" | "approved_line"; text: string; line_id?: string | null } | null;
  suggest_hint: { hint_ref: string } | null;
  fallback_reason: FallbackReason | null;
  content_mode: "case" | "generic";
}

export type HintTarget = { hint_ref: string } | { puzzle_id: string };

export type HintBody = HintTarget & {
  client_event_id: string;
  client_timestamp: string;
  target_level: 1 | 2;
};

export interface HintResponse {
  interaction_id: string;
  result: {
    result_type: "hint_unlocked" | "already_unlocked";
    puzzle_id: string;
    hint_level: number;
    hint_balance: number;
    help_used: number;
  };
  hint: { level: 1 | 2; text: string };
}

export interface PlaySessionState {
  current_zone_id?: string | null;
  hint_levels: Record<string, number>;
  [field: string]: unknown;
}

export interface PlaySessionData {
  play_session_id: string;
  case_id: string;
  state: PlaySessionState;
  /** 이 세션이 읽을 케이스 에셋의 버전 경로(예: /c/naju-angam-01/v1). 서버가 아직 안 주면 없거나 null 이다 */
  asset_base_path?: string | null;
}

// ── 응답 모양 검사 — 약속한 모양이 아니면 성공으로 보지 않는다(빈 대사를 띄우지 않게) ──

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function isNpcTurnResponse(value: unknown): value is NpcTurnResponse {
  if (!isObject(value)) return false;
  if (typeof value.npc_event_id !== "string") return false;
  // content_mode 는 늘 있다(기본값 금지) — 없으면 파싱 오류로 본다
  if (value.content_mode !== "case" && value.content_mode !== "generic") return false;
  const { reply, suggest_hint: suggest } = value;
  if (reply !== null && !(isObject(reply) && typeof reply.text === "string" && reply.text.trim() !== "")) return false;
  if (suggest !== null && !(isObject(suggest) && typeof suggest.hint_ref === "string" && suggest.hint_ref !== ""))
    return false;
  return value.fallback_reason === null || typeof value.fallback_reason === "string";
}

export function isHintResponse(value: unknown): value is HintResponse {
  if (!isObject(value) || !isObject(value.result) || !isObject(value.hint)) return false;
  const { result, hint } = value;
  return (
    (result.result_type === "hint_unlocked" || result.result_type === "already_unlocked") &&
    typeof result.puzzle_id === "string" &&
    typeof result.hint_level === "number" &&
    typeof result.hint_balance === "number" &&
    (hint.level === 1 || hint.level === 2) &&
    typeof hint.text === "string" &&
    hint.text !== ""
  );
}

// ── 보내기 ──

/** NPC 는 UUID 형식이 필수다. randomUUID 가 없는 오래된 브라우저는 getRandomValues 로 v4 를 만든다. */
export function newEventId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 시간대가 붙은 ISO(Z) — 서버는 오프셋이 없으면 422 다 */
export const clientTimestamp = () => new Date().toISOString();

export const API_CONFIG = {
  /** 응답을 이만큼 기다린다(ms) */
  timeoutMs: 10_000,
  /** 네트워크 · 시간 초과 · 502~504 에서만 같은 본문으로 다시 보낸다 */
  maxRetries: 2,
  retryDelayMs: 600,
} as const;

const RETRYABLE_STATUS = new Set([502, 503, 504]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 한 번 보낸다. 실패하면 CompanionApiError */
async function requestOnce(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      // 운영은 play → api 로 출처가 다르다. 세션 소유권을 게스트 쿠키로 확인하므로 쿠키를 함께 보낸다
      credentials: "include",
      signal: controller.signal,
    });
  } catch (cause) {
    throw new CompanionApiError(null, null, null, { cause });
  } finally {
    clearTimeout(timer);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new CompanionApiError(response.status, isObject(body) ? body.detail : null, body);
  return body;
}

/**
 * 같은 행동의 재전송은 같은 client_event_id · 같은 본문이어야 한다(다르면 서버가 409).
 * 그래서 본문 문자열을 한 번 만들어 얼려 두고, 다시 보낼 때도 그 문자열을 그대로 쓴다.
 * 네트워크 · 시간 초과 · 502~504 만 다시 보낸다. 500 · 409 · 422 는 다시 보내도 같다.
 */
export async function sendFrozen(
  path: string,
  body: object,
  options: { timeoutMs?: number; maxRetries?: number; retryDelayMs?: number } = {},
): Promise<unknown> {
  const frozen = JSON.stringify(body);
  const maxRetries = options.maxRetries ?? API_CONFIG.maxRetries;
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestOnce(path, { method: "POST", body: frozen }, options.timeoutMs ?? API_CONFIG.timeoutMs);
    } catch (error) {
      // 코드가 실린 503(HINT_REF_UNAVAILABLE 등)은 서버 설정 문제라 다시 보내도 같다
      const retryable =
        error instanceof CompanionApiError &&
        (error.status === null || (RETRYABLE_STATUS.has(error.status) && errorCode(error) === null));
      if (!retryable || attempt >= maxRetries) throw error;
      await sleep(options.retryDelayMs ?? API_CONFIG.retryDelayMs);
    }
  }
}

const sessionPath = (playSessionId: string) => `/api/v1/play-sessions/${encodeURIComponent(playSessionId)}`;

export async function createAnonymousSession(): Promise<string> {
  const body = await requestOnce("/api/v1/anonymous-sessions", { method: "POST" }, API_CONFIG.timeoutMs);
  const id = isObject(body) && isObject(body.data) ? body.data.anonymous_session_id : null;
  if (typeof id !== "string" || !id) throw new CompanionApiError(200, "INVALID_RESPONSE", body);
  return id;
}

function toPlaySession(body: unknown): PlaySessionData {
  const data = isObject(body) ? body.data : null;
  if (!isObject(data) || typeof data.play_session_id !== "string" || !isObject(data.state))
    throw new CompanionApiError(200, "INVALID_RESPONSE", body);
  return data as unknown as PlaySessionData;
}

/** NPC 는 content_version 을 고정한 세션에서만 돈다 — 버전은 필수로 받는다 */
export async function createPinnedPlaySession(
  anonymousSessionId: string,
  caseId: string,
  contentVersion: number,
): Promise<PlaySessionData> {
  const body = await requestOnce(
    "/api/v1/play-sessions",
    {
      method: "POST",
      body: JSON.stringify({
        anonymous_session_id: anonymousSessionId,
        case_id: caseId,
        content_version: contentVersion,
      }),
    },
    API_CONFIG.timeoutMs,
  );
  return toPlaySession(body);
}

export async function loadPlaySession(playSessionId: string): Promise<PlaySessionData> {
  return toPlaySession(await requestOnce(sessionPath(playSessionId), { method: "GET" }, API_CONFIG.timeoutMs));
}

export async function postNpcTurn(playSessionId: string, body: NpcTurnBody): Promise<NpcTurnResponse> {
  const response = await sendFrozen(`${sessionPath(playSessionId)}/npc/turns`, body);
  if (!isNpcTurnResponse(response)) throw new CompanionApiError(200, "INVALID_RESPONSE", response);
  return response;
}

/** 정식 경로 하나만 쓴다(별칭 /puzzles/{id}/hints 는 쓰지 않는다) */
export async function postHint(playSessionId: string, body: HintBody): Promise<HintResponse> {
  const response = await sendFrozen(`${sessionPath(playSessionId)}/hints`, body);
  if (!isHintResponse(response)) throw new CompanionApiError(200, "INVALID_RESPONSE", response);
  return response;
}
