/**
 * 퍼즐 하나의 서버 제출 — najuProgress(progressRuntime) 위에서 「한 번 만든 이벤트를 끝까지 쓴다」를 지킨다.
 *
 * - submit: 새 시도. 보내기 전에 보낼 수 있는지(대응표 · 세션) 먼저 본다 — 못 보내면 unavailable(부르는 쪽이 정한다:
 *   개발 빌드의 로컬 판정 또는 「연결 필요」 안내).
 * - 보낸 뒤 연결 실패(unreachable · 모양이 어긋난 응답)면 그 prepared 를 쥐고 retryable 이 된다.
 *   retry 는 같은 prepared(같은 client_event_id · 같은 본문)를 다시 보낸다 — 새 이벤트를 만들지 않는다. 자동 재전송은 없다.
 * - 409 · 404 · 422 등은 failed — 다시 보내도 같으므로 쥐지 않는다. 세션 재생성 · 진행 재구축은 하지 않는다.
 * - 보내는 중(sending)에는 새 시도를 받지 않는다(busy).
 * React · 별칭을 쓰지 않는다(node --test).
 */
import type { ProgressAvailability, ProgressRuntime } from "./progressRuntime.ts";
import type { ConflictReason, PreparedInteraction, ProgressIntent, SendOutcome } from "./progressSync.ts";

export type PuzzleVerdict =
  /** 서버가 이번 이벤트로 완료했다 */
  | { kind: "correct" }
  /** 서버에서는 이미 완료였다(재접속 · 다른 이벤트). 오류가 아니다 — 보상 · 연출은 부르는 쪽이 한 번만 */
  | { kind: "already-completed" }
  /** 서버 판정 오답(input · select). 퍼즐 상태를 바꾸지 않는다 */
  | { kind: "incorrect"; attemptCount: number | null }
  /** 보내지 못했다 — 대응표 확정 전 · 세션 준비 안 됨 · 대응표에 없는 ID */
  | { kind: "unavailable"; reason: Exclude<ProgressAvailability, "ready"> | "unmapped" }
  /** 연결이 끊겼다. retry 로 같은 이벤트를 다시 보낼 수 있다 */
  | { kind: "retryable"; reason: "unreachable" | "invalid-response" }
  /** 서버가 거절했다(다시 보내도 같다) */
  | { kind: "failed"; reason: ConflictReason | "session-missing" | "rejected" }
  /** 앞 요청을 기다리는 중 */
  | { kind: "busy" };

export type SubmissionState = "idle" | "sending" | "retryable" | "done";

type Runtime = Pick<ProgressRuntime, "availability" | "prepare" | "send">;

export function verdictOf(outcome: SendOutcome): PuzzleVerdict {
  switch (outcome.kind) {
    case "sent": {
      const type = outcome.response.result_type;
      if (type === "already_completed") return { kind: "already-completed" };
      if (type === "incorrect") return { kind: "incorrect", attemptCount: outcome.response.attempt_count };
      // correct · ok(완료 신고에 ok 가 올 일은 없지만 서버가 처리했다는 뜻이다)
      return { kind: "correct" };
    }
    case "not-sent":
      return { kind: "unavailable", reason: "session-not-ready" };
    case "unreachable":
      return { kind: "retryable", reason: "unreachable" };
    case "invalid-response":
      return { kind: "retryable", reason: "invalid-response" };
    case "conflict":
      return { kind: "failed", reason: outcome.reason };
    case "session-missing":
      return { kind: "failed", reason: "session-missing" };
    case "rejected":
      return { kind: "failed", reason: "rejected" };
  }
}

export function createPuzzleSubmission(
  runtime: Runtime,
  options: { onChange?: (state: SubmissionState) => void } = {},
) {
  let state: SubmissionState = "idle";
  let pending: PreparedInteraction | null = null;

  const set = (next: SubmissionState) => {
    if (next === state) return;
    state = next;
    options.onChange?.(state);
  };

  async function sendPending(prepared: PreparedInteraction): Promise<PuzzleVerdict> {
    set("sending");
    const verdict = verdictOf(await runtime.send(prepared));
    if (verdict.kind === "retryable") {
      pending = prepared;
      set("retryable");
    } else {
      pending = null;
      set(verdict.kind === "correct" || verdict.kind === "already-completed" ? "done" : "idle");
    }
    return verdict;
  }

  return {
    state: () => state,
    canRetry: () => state === "retryable",
    /** 새 시도. 이전에 쥔 실패 이벤트는 버린다(플레이어가 다시 맞췄다) */
    async submit(intent: ProgressIntent): Promise<PuzzleVerdict> {
      if (state === "sending") return { kind: "busy" };
      const availability = runtime.availability();
      if (availability !== "ready") return { kind: "unavailable", reason: availability };
      const result = runtime.prepare(intent);
      if (!result.ok) return { kind: "unavailable", reason: "unmapped" };
      pending = null;
      return sendPending(result.prepared);
    },
    /** 연결 실패로 쥔 같은 이벤트를 다시 보낸다. 쥔 것이 없으면 null */
    async retry(): Promise<PuzzleVerdict | null> {
      if (state !== "retryable" || pending === null) return null;
      return sendPending(pending);
    },
  };
}

export type PuzzleSubmission = ReturnType<typeof createPuzzleSubmission>;

/** 화면 안내 — 서버 원문은 싣지 않는다 */
export function verdictNotice(verdict: PuzzleVerdict): string | null {
  switch (verdict.kind) {
    case "unavailable":
      return "서버와 연결되지 않아 맞았는지 확인할 수 없다. 연결된 뒤 다시 해 보자.";
    case "retryable":
      return "서버 연결이 끊겼다. [E] 로 다시 보내 보자.";
    case "failed":
      return verdict.reason === "session-missing"
        ? "진행 기록을 찾지 못했다. 게임을 다시 연 뒤 시도해 보자."
        : "서버와 진행이 맞지 않아 이번 결과를 받지 못했다. 잠시 뒤 다시 해 보자.";
    default:
      return null;
  }
}
