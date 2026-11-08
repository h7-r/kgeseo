/**
 * 나주 진행 동기화의 공통 연결 지점 — progressSync(Interaction API) 와 동행 NPC Play Session 을 잇는다.
 *
 * - 세션은 동행 세션을 그대로 쓴다(getStatus 로 읽기만, noteHintLevel 로 힌트 단계만 올린다). 세션을 만들거나 다시 만들지 않는다.
 * - 대응표(로컬 ID → 런타임 ID)는 밖에서 넣는다(setIdTable). 넣기 전에는 모든 ID 가 미매핑이라 아무것도 보내지 않는다.
 * - 상태 변화는 progressSync 가 (Play Session, interaction_id) 당 한 번만 넘긴다. 여기서는
 *     hint_level_changed → 보낸 세션이 지금 세션일 때만, 지금보다 높을 때만 noteHintLevel (여러 번 받아도 같다)
 *     그 밖 → 구독자(subscribe)에게 그대로. 모르는 종류는 해석하지 않는다(결과의 unknownStateChanges 로만 돌아간다).
 * - 실패는 progressSync 결과(SendOutcome)를 그대로 돌려준다. 세션 재생성 · 진행 재구축 · 자동 재전송은 하지 않는다
 *   (정책 미정 — 부르는 쪽이 결과를 보고 정한다).
 * React · 별칭(@/) 을 쓰지 않는다(node --test). 앱 한 벌은 najuProgress.ts 에서 만든다.
 */
import type { CompanionSessionStatus } from "../companion/companionSession.ts";
import {
  createProgressIdMap,
  createProgressSync,
  type InteractionStateChange,
  type PrepareResult,
  type PreparedInteraction,
  type ProgressIdKind,
  type ProgressIdMap,
  type ProgressIdTable,
  type ProgressIntent,
  type SendOutcome,
  type StateChangeContext,
  type UnmappedReport,
} from "./progressSync.ts";

/** 동행 세션(createCompanionSession)에서 쓰는 두 가지 */
export interface ProgressRuntimeSession {
  getStatus(): CompanionSessionStatus;
  noteHintLevel(puzzleId: string, level: number): void;
}

export type ProgressStateListener = (
  changes: InteractionStateChange[],
  context: StateChangeContext & { prepared: PreparedInteraction },
) => void;

export interface ProgressRuntimeOptions {
  session: ProgressRuntimeSession;
  /** 처음 대응표. 없으면(null) 확정 전 — 모든 ID 가 미매핑 */
  ids?: ProgressIdTable | null;
  onUnmapped?: (report: UnmappedReport) => void;
  /** 시험용 · progressSync 로 그대로 넘긴다 */
  sendOptions?: { timeoutMs?: number; maxRetries?: number; retryDelayMs?: number };
  deliveryHistoryLimit?: number;
  newEventId?: () => string;
  now?: () => string;
}

export type SubmitResult = SendOutcome | Extract<PrepareResult, { ok: false }>;

export type ProgressAvailability = "ready" | "not-configured" | "session-not-ready";

/** 서버가 처리했다고 답했는가(sent 만). not-sent · unreachable · conflict · 미매핑 등은 false */
export const isServerApplied = (result: SubmitResult): result is Extract<SendOutcome, { kind: "sent" }> =>
  "kind" in result && result.kind === "sent";

export function createProgressRuntime(options: ProgressRuntimeOptions) {
  const { session } = options;
  let table: ProgressIdMap | null = options.ids ? createProgressIdMap(options.ids) : null;
  const listeners = new Set<ProgressStateListener>();

  /** 확정 전(null)에는 모든 ID 가 미매핑이다 */
  const ids: ProgressIdMap = {
    toRuntime: (kind: ProgressIdKind, localId: string) => table?.toRuntime(kind, localId) ?? null,
    toLocal: (kind: ProgressIdKind, runtimeId: string) => table?.toLocal(kind, runtimeId) ?? null,
  };

  /** 보낸 세션이 지금도 같은 세션일 때만, 지금보다 높은 단계만 올린다 — 여러 번 받아도 · 늦게 와도 안전하다 */
  function applyHintLevel(change: Extract<InteractionStateChange, { type: "hint_level_changed" }>, sentTo: string) {
    const status = session.getStatus();
    if (status.phase !== "ready" || status.playSessionId !== sentTo) return;
    if (change.hint_level > (status.hintLevels[change.puzzle_id] ?? 0)) {
      session.noteHintLevel(change.puzzle_id, change.hint_level);
    }
  }

  /**
   * progressSync 가 처음 받은 상태 변화만 넘긴다. 구독자가 하나라도 던지면 모두 부른 뒤 던진다
   * → progressSync 가 handler-failed 로 돌려주고 기록하지 않는다(같은 prepared 를 다시 보내면 다시 넘긴다).
   * 그래서 구독자는 같은 변화를 두 번 받아도 괜찮게 짠다. 힌트 단계 반영은 이미 그렇다.
   */
  function handleStateChanges(
    changes: InteractionStateChange[],
    prepared: PreparedInteraction,
    context: StateChangeContext,
  ) {
    for (const change of changes)
      if (change.type === "hint_level_changed") applyHintLevel(change, context.playSessionId);
    const errors: unknown[] = [];
    for (const listener of [...listeners]) {
      try {
        listener(changes, { ...context, prepared });
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "progress state listeners failed");
  }

  const sync = createProgressSync({
    getSession: session.getStatus,
    ids,
    onUnmapped: options.onUnmapped,
    onStateChanges: handleStateChanges,
    deliveryHistoryLimit: options.deliveryHistoryLimit,
    sendOptions: options.sendOptions,
    newEventId: options.newEventId,
    now: options.now,
  });

  return {
    /** 확정된 대응표를 넣는다. 빈 값 · 중복 런타임 ID 가 있으면 던지고 이전 대응표를 그대로 둔다. null 이면 다시 미확정 */
    setIdTable(next: ProgressIdTable | null) {
      table = next ? createProgressIdMap(next) : null;
    },
    hasIdTable: () => table !== null,
    /** 지금 보낼 수 있는가 — 대응표 없음(확정 전) · 세션 준비 안 됨을 보내 보기 전에 가린다(미매핑 진단을 남기지 않는다) */
    availability(): ProgressAvailability {
      if (table === null) return "not-configured";
      return session.getStatus().phase === "ready" ? "ready" : "session-not-ready";
    },
    /** 퍼즐 · 구역 코드가 부르는 곳. 결과를 그대로 돌려준다(성공은 isServerApplied 로 가린다) */
    submit: (intent: ProgressIntent): Promise<SubmitResult> => sync.submit(intent),
    /** 같은 이벤트로 다시 보내야 할 때(부르는 쪽이 정한다) — prepare 한 것을 send 로 */
    prepare: sync.prepare,
    send: sync.send,
    /** 처음 받은 상태 변화를 받는다. 돌려준 함수로 끊는다 */
    subscribe(listener: ProgressStateListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clearDeliveryHistory: sync.clearDeliveryHistory,
  };
}

export type ProgressRuntime = ReturnType<typeof createProgressRuntime>;
