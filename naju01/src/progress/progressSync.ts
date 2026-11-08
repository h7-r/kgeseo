/**
 * 나주 진행 상태를 서버 Interaction API(`POST /api/v1/play-sessions/{id}/interactions`)로 보내는 공통 창구.
 * 계약 기준은 backend/app/schemas/interaction_api.py · interaction.py · api/v1/interactions.py 다.
 *
 * - 보내는 것: navigate · complete · input · select 네 가지. 나머지(inspect · combine_clues)는 이번 범위가 아니다.
 * - 퍼즐 코드는 로컬 ID(나주 구역 코드 · 물건 id)로 부른다. 런타임 ID 로 못 바꾸면 보내지 않는다(idmap 규칙 unmapped_local_id).
 * - 세션은 동행 NPC 세션(companionSession)을 그대로 쓴다. 여기서 세션을 만들거나 다시 만들지 않는다.
 * - 재전송은 같은 client_event_id · 같은 본문이어야 서버가 처음 결과를 다시 준다(다르면 409).
 *   그래서 본문을 한 번 만들어(prepare) 그대로 다시 보낸다(send).
 * - 실제 나주 ID 는 아직 정해지지 않았다. 이 파일은 ID 값을 하나도 갖지 않는다 — 대응표는 부르는 쪽이 넘긴다.
 * React · 별칭(@/) 을 쓰지 않는다(node --test).
 */
import { CompanionApiError, clientTimestamp, newEventId, sendFrozen } from "../companion/companionApi.ts";
import type { CompanionSessionStatus } from "../companion/companionSession.ts";

// ── 서버 계약 모양 ──

/** 서버가 돌려주는 state_changes 13종(backend/app/schemas/interaction.py InteractionStateChange) */
export type InteractionStateChange =
  | { type: "puzzle_completed"; puzzle_id: string }
  | { type: "clue_acquired"; clue_id: string }
  | { type: "item_acquired"; item_id: string }
  | { type: "item_consumed"; item_id: string }
  | { type: "zone_unlocked"; zone_id: string }
  | { type: "current_zone_changed"; zone_id: string }
  | { type: "hint_level_changed"; puzzle_id: string; hint_level: number }
  | { type: "flag_updated"; flag: string; value: unknown }
  | { type: "object_revealed"; zone_id: string; object_id: string }
  | { type: "object_hidden"; zone_id: string; object_id: string }
  | { type: "object_unlocked"; zone_id: string; object_id: string }
  | { type: "case_completed" }
  | { type: "scene_cleared"; scene_id: string };

export type InteractionResultType = "ok" | "correct" | "incorrect" | "already_completed";

export interface InteractionResponse {
  interaction_id: string;
  result_type: InteractionResultType;
  message: string | null;
  attempt_count: number | null;
  state_changes: InteractionStateChange[];
  ui_actions: Record<string, unknown>[];
}

export type InteractionAction = "navigate" | "complete" | "input" | "select";

export interface InteractionBody {
  client_event_id: string;
  client_timestamp: string;
  zone_id: string;
  action: InteractionAction;
  target_type: "zone" | "object";
  target_id: string;
  payload: Record<string, never> | { answer: string } | { choice: string };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

const STATE_CHANGE_FIELDS: Record<InteractionStateChange["type"], readonly string[]> = {
  puzzle_completed: ["puzzle_id"],
  clue_acquired: ["clue_id"],
  item_acquired: ["item_id"],
  item_consumed: ["item_id"],
  zone_unlocked: ["zone_id"],
  current_zone_changed: ["zone_id"],
  hint_level_changed: ["puzzle_id"],
  flag_updated: ["flag"],
  object_revealed: ["zone_id", "object_id"],
  object_hidden: ["zone_id", "object_id"],
  object_unlocked: ["zone_id", "object_id"],
  case_completed: [],
  scene_cleared: ["scene_id"],
};

/** 아는 종류이고 필수 문자열이 있으면 true. 모르는 종류는 응답 전체를 깨지 않고 건너뛴다(splitStateChanges) */
export function isKnownStateChange(value: unknown): value is InteractionStateChange {
  if (!isObject(value) || typeof value.type !== "string" || !(value.type in STATE_CHANGE_FIELDS)) return false;
  const fields = STATE_CHANGE_FIELDS[value.type as InteractionStateChange["type"]];
  if (!fields.every((field) => isText(value[field]))) return false;
  if (value.type === "hint_level_changed") return Number.isInteger(value.hint_level);
  if (value.type === "flag_updated") return "value" in value;
  return true;
}

export function splitStateChanges(values: readonly unknown[]): {
  known: InteractionStateChange[];
  unknown: unknown[];
} {
  const known: InteractionStateChange[] = [];
  const unknown: unknown[] = [];
  for (const value of values) (isKnownStateChange(value) ? known : unknown).push(value);
  return { known, unknown };
}

const RESULT_TYPES = new Set<unknown>(["ok", "correct", "incorrect", "already_completed"]);

/** 약속한 모양이 아니면 성공으로 보지 않는다. state_changes 안의 모르는 종류는 여기서 거르지 않는다 */
export function isInteractionResponse(value: unknown): value is InteractionResponse {
  return (
    isObject(value) &&
    isText(value.interaction_id) &&
    RESULT_TYPES.has(value.result_type) &&
    Array.isArray(value.state_changes)
  );
}

// ── 로컬 ID ↔ 런타임 ID ──

export type ProgressIdKind = "zone" | "object";

export interface ProgressIdTable {
  /** 나주 구역 코드 → 런타임 Zone ID */
  zones: Readonly<Record<string, string>>;
  /** 나주 물건 로컬 ID → 런타임 Object ID */
  objects: Readonly<Record<string, string>>;
}

export interface ProgressIdMap {
  toRuntime(kind: ProgressIdKind, localId: string): string | null;
  toLocal(kind: ProgressIdKind, runtimeId: string): string | null;
}

/** 빈 값 · 중복 런타임 ID 는 대응을 믿을 수 없으므로 만들 때 멈춘다 */
export function createProgressIdMap(table: ProgressIdTable): ProgressIdMap {
  const build = (kind: ProgressIdKind, entries: Readonly<Record<string, string>>) => {
    const forward = new Map<string, string>();
    const reverse = new Map<string, string>();
    for (const [local, runtime] of Object.entries(entries)) {
      if (!local.trim() || !isText(runtime) || !runtime.trim()) throw new Error(`progress idmap: empty ${kind} id`);
      if (reverse.has(runtime)) throw new Error(`progress idmap: duplicate ${kind} runtime id ${runtime}`);
      forward.set(local, runtime);
      reverse.set(runtime, local);
    }
    return { forward, reverse };
  };
  const maps = { zone: build("zone", table.zones), object: build("object", table.objects) };
  return {
    toRuntime: (kind, localId) => maps[kind].forward.get(localId) ?? null,
    toLocal: (kind, runtimeId) => maps[kind].reverse.get(runtimeId) ?? null,
  };
}

// ── 보낼 일(로컬 ID 로 적는다) ──

export type ProgressIntent =
  /** 지금 서버가 아는 구역(from)에서 이웃 구역(to)으로 */
  | { action: "navigate"; fromZone: string; toZone: string }
  /** 손놀림 퍼즐(solve.mode client_skill) 완료 신고 */
  | { action: "complete"; zone: string; object: string }
  | { action: "input"; zone: string; object: string; answer: string }
  | { action: "select"; zone: string; object: string; choice: string };

/** 한 번 만든 본문. 다시 보낼 때도 이 값을 그대로 쓴다(client_event_id 유지) */
export interface PreparedInteraction {
  readonly intent: ProgressIntent;
  readonly body: Readonly<InteractionBody>;
}

export type PrepareResult =
  | { ok: true; prepared: PreparedInteraction }
  | { ok: false; reason: "unmapped"; kind: ProgressIdKind; localId: string };

export interface UnmappedReport {
  localId: string;
  kind: ProgressIdKind;
  action: InteractionAction;
  caseId: string | null;
  contentVersion: number | null;
  at: string;
}

// ── 보낸 결과 ──

/** 409 의 detail 문자열(backend/app/api/v1/interactions.py)을 부르는 쪽이 고를 수 있는 이름으로 */
export type ConflictReason =
  | "required-clues"
  | "required-puzzles"
  | "required-items"
  | "clue-not-acquired"
  | "case-version-unavailable"
  | "solve-mode-mismatch"
  | "object-interaction-unavailable"
  | "interaction-type-mismatch"
  | "current-zone-unknown"
  | "zone-not-current"
  | "navigation-unavailable"
  | "object-not-visible"
  | "object-not-enabled"
  | "idempotency-conflict"
  | "other";

const CONFLICTS: Record<string, ConflictReason> = {
  "Required clues are not acquired.": "required-clues",
  "Required puzzles are not completed.": "required-puzzles",
  "Required items are not held.": "required-items",
  "Clue is not acquired.": "clue-not-acquired",
  CASE_VERSION_UNAVAILABLE: "case-version-unavailable",
  "Interaction action does not match the puzzle solve mode.": "solve-mode-mismatch",
  "Object interaction is unavailable.": "object-interaction-unavailable",
  "Interaction action does not match the object.": "interaction-type-mismatch",
  "Current zone is unknown.": "current-zone-unknown",
  "Zone is not current.": "zone-not-current",
  "Navigation is unavailable.": "navigation-unavailable",
  "Object is not visible.": "object-not-visible",
  "Object is not enabled.": "object-not-enabled",
  "Client event ID conflicts with a previous interaction.": "idempotency-conflict",
};

/**
 * 이번 응답의 상태 변화를 onStateChanges 로 넘겼는가.
 * 서버는 같은 (Play Session, client_event_id) 를 다시 받으면 처음 결과를 같은 interaction_id 로 되돌려 준다
 * (backend/app/services/interaction.py `_replay_existing_event`). 그래서 (Play Session, interaction_id) 를 한 번만 넘긴다.
 */
export type StateChangeDelivery =
  /** 처음 받은 상태 변화를 넘겼다 */
  | { status: "delivered" }
  /** 넘길 것이 없다(아는 상태 변화가 없거나 onStateChanges 가 없다). 기록하지 않는다 */
  | { status: "none" }
  /** 이 Play Session 에서 이미 넘긴 interaction_id — 다시 넘기지 않았다 */
  | { status: "duplicate" }
  /** onStateChanges 가 던졌다. 넘긴 것으로 기록하지 않는다 — 같은 prepared 를 다시 보내면 다시 넘긴다 */
  | { status: "handler-failed"; error: unknown };

export type SendOutcome =
  | { kind: "sent"; response: InteractionResponse; unknownStateChanges: unknown[]; delivery: StateChangeDelivery }
  /** 세션이 준비되지 않아 보내지 않았다(꺼짐 · 시작 중 · 쓸 수 없음). 같은 prepared 로 나중에 다시 보낼 수 있다 */
  | { kind: "not-sent"; reason: "session-not-ready" }
  /** 409 — 다시 보내도 같다. 진행 순서 · 구역 · 콘텐츠 버전이 서버와 어긋났다는 뜻 */
  | { kind: "conflict"; reason: ConflictReason; detail: unknown }
  /** 404 Play session not found — 세션을 다시 만들지는 부르는 쪽(동행 세션)이 정한다 */
  | { kind: "session-missing" }
  /** 404(그 밖) · 422 · 500 · 501 — 콘텐츠 · 요청 모양 문제. 다시 보내도 같다 */
  | { kind: "rejected"; status: number; detail: unknown }
  /** 연결 실패 · 시간 초과 · 502~504 를 다시 보내도 실패. 같은 prepared 로 나중에 다시 보내면 같은 이벤트로 처리된다 */
  | { kind: "unreachable"; status: number | null }
  /** 200 이지만 약속한 모양이 아니다 */
  | { kind: "invalid-response"; body: unknown };

export interface StateChangeContext {
  /** 요청을 보낸 Play Session */
  playSessionId: string;
  interactionId: string;
}

export interface ProgressSyncOptions {
  /** 동행 NPC 세션(companionSession.getStatus). 세션을 만들지 않고 읽기만 한다 */
  getSession: () => CompanionSessionStatus;
  ids: ProgressIdMap;
  /** 대응이 없는 로컬 ID — 보내지 않고 알리기만 한다 */
  onUnmapped?: (report: UnmappedReport) => void;
  /**
   * 서버가 적용한 상태 변화. 화면 · NPC 반영은 부르는 쪽이 한다. 같은 (Play Session, interaction_id) 는 한 번만 부른다.
   * context.playSessionId 는 요청을 보낸 세션이다(응답을 기다리는 사이 세션이 바뀌었을 수 있다).
   */
  onStateChanges?: (
    changes: InteractionStateChange[],
    prepared: PreparedInteraction,
    context: StateChangeContext,
  ) => void;
  /** 넘긴 (Play Session, interaction_id) 를 이만큼만 기억한다. 넘으면 가장 오래된 것부터 잊는다(기본 256) */
  deliveryHistoryLimit?: number;
  /** 시험용. 기본은 companionApi 의 값 */
  sendOptions?: { timeoutMs?: number; maxRetries?: number; retryDelayMs?: number };
  newEventId?: () => string;
  now?: () => string;
}

const DEFAULT_DELIVERY_HISTORY_LIMIT = 256;

const interactionsPath = (playSessionId: string) =>
  `/api/v1/play-sessions/${encodeURIComponent(playSessionId)}/interactions`;

export function createProgressSync(options: ProgressSyncOptions) {
  const makeEventId = options.newEventId ?? newEventId;
  const now = options.now ?? clientTimestamp;
  const historyLimit = Math.max(1, Math.floor(options.deliveryHistoryLimit ?? DEFAULT_DELIVERY_HISTORY_LIMIT));
  /** 이미 넘긴 `<playSessionId>\n<interaction_id>`. Set 은 넣은 차례를 지켜 가장 오래된 것을 먼저 지운다 */
  const delivered = new Set<string>();

  function remember(key: string) {
    delivered.add(key);
    while (delivered.size > historyLimit) {
      const oldest = delivered.values().next().value as string;
      delivered.delete(oldest);
    }
  }

  /** 검증된 응답만 들어온다. 콜백이 끝까지 돌았을 때만 기록한다 */
  function deliver(
    playSessionId: string,
    response: InteractionResponse,
    prepared: PreparedInteraction,
  ): StateChangeDelivery {
    const handler = options.onStateChanges;
    if (!handler || response.state_changes.length === 0) return { status: "none" };
    const key = `${playSessionId}\n${response.interaction_id}`;
    if (delivered.has(key)) return { status: "duplicate" };
    try {
      handler(response.state_changes, prepared, { playSessionId, interactionId: response.interaction_id });
    } catch (error) {
      return { status: "handler-failed", error };
    }
    remember(key);
    return { status: "delivered" };
  }

  function reportUnmapped(kind: ProgressIdKind, localId: string, action: InteractionAction) {
    const session = options.getSession();
    options.onUnmapped?.({
      localId,
      kind,
      action,
      caseId: session.phase === "ready" ? session.caseId : null,
      contentVersion: session.phase === "ready" ? session.contentVersion : null,
      at: now(),
    });
  }

  /** 로컬 ID 를 바꾸고 본문을 한 번 만든다. 하나라도 대응이 없으면 만들지 않는다 */
  function prepare(intent: ProgressIntent): PrepareResult {
    const lookups: [ProgressIdKind, string][] =
      intent.action === "navigate"
        ? [
            ["zone", intent.fromZone],
            ["zone", intent.toZone],
          ]
        : [
            ["zone", intent.zone],
            ["object", intent.object],
          ];
    const runtime: string[] = [];
    for (const [kind, localId] of lookups) {
      const id = options.ids.toRuntime(kind, localId);
      if (id === null) {
        reportUnmapped(kind, localId, intent.action);
        return { ok: false, reason: "unmapped", kind, localId };
      }
      runtime.push(id);
    }
    const [zoneId, targetId] = runtime;
    const base = { client_event_id: makeEventId(), client_timestamp: now(), zone_id: zoneId, target_id: targetId };
    const body: InteractionBody =
      intent.action === "navigate"
        ? { ...base, action: "navigate", target_type: "zone", payload: {} }
        : intent.action === "complete"
          ? { ...base, action: "complete", target_type: "object", payload: {} }
          : intent.action === "input"
            ? { ...base, action: "input", target_type: "object", payload: { answer: intent.answer } }
            : { ...base, action: "select", target_type: "object", payload: { choice: intent.choice } };
    return { ok: true, prepared: Object.freeze({ intent, body: Object.freeze(body) }) };
  }

  /** 같은 prepared 를 몇 번 보내도 같은 client_event_id · 같은 본문이다 */
  async function send(prepared: PreparedInteraction): Promise<SendOutcome> {
    const session = options.getSession();
    if (session.phase !== "ready") return { kind: "not-sent", reason: "session-not-ready" };
    let body: unknown;
    try {
      body = await sendFrozen(interactionsPath(session.playSessionId), prepared.body, options.sendOptions);
    } catch (error) {
      if (!(error instanceof CompanionApiError)) throw error;
      return classifyError(error);
    }
    if (!isInteractionResponse(body)) return { kind: "invalid-response", body };
    const { known, unknown } = splitStateChanges(body.state_changes);
    const response: InteractionResponse = { ...body, state_changes: known };
    // 보낼 때의 세션으로 기록한다 — 응답을 기다리는 사이 세션이 바뀌어도 다른 세션 기록과 섞이지 않는다
    const delivery = deliver(session.playSessionId, response, prepared);
    return { kind: "sent", response, unknownStateChanges: unknown, delivery };
  }

  return {
    prepare,
    send,
    /** 넘긴 기록을 모두 잊는다(시험 · 강제 초기화용). 세션이 바뀌는 것만으로는 부를 필요가 없다 */
    clearDeliveryHistory() {
      delivered.clear();
    },
    /** prepare + send. 대응이 없으면 보내지 않는다 */
    async submit(intent: ProgressIntent): Promise<SendOutcome | Extract<PrepareResult, { ok: false }>> {
      const result = prepare(intent);
      return result.ok ? send(result.prepared) : result;
    },
  };
}

function classifyError(error: CompanionApiError): SendOutcome {
  const { status, detail } = error;
  if (status === null || status === 502 || status === 503 || status === 504) return { kind: "unreachable", status };
  if (status === 409) {
    const reason = typeof detail === "string" ? (CONFLICTS[detail] ?? "other") : "other";
    return { kind: "conflict", reason, detail };
  }
  if (status === 404 && detail === "Play session not found.") return { kind: "session-missing" };
  return { kind: "rejected", status, detail };
}

export type ProgressSync = ReturnType<typeof createProgressSync>;
