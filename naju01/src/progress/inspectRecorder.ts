/**
 * 조사(inspect) 기록 — 플레이어가 무엇을 읽었는지 서버 Play Session 에 남긴다. 퍼즐 판정과는 상관없다.
 *
 * - 부르는 쪽은 화면 알림을 먼저 띄우고 note 를 기다리지 않는다(void). 전송은 뒤에서 한다.
 * - 대응표 확정 전 · 세션 준비 전이면 「읽었다」를 기억해 두었다가, 준비되면(세션 상태가 바뀌거나 flush) 한 번 보낸다.
 *   대응표가 없는 동안은 보내지 않고 기다리기만 한다(진단 한 줄).
 * - Play Session 하나에 같은 물건은 한 번만 보낸다. 서버는 같은 조사를 다시 받으면 already_inspected
 *   (result_type ok · 상태 변화 없음)로 답할 뿐이라 여러 번 보낼 까닭이 없다.
 * - 연결 실패(unreachable · invalid-response)는 같은 prepared(같은 client_event_id)를 쥐고 다음 flush 때 다시 보낸다.
 * - 409 · 404 · 422 같은 거절은 쥐지 않는다(진단만). 다시 읽으면 새 이벤트로 시도한다. 대응표에 없는 물건도 같다.
 * React · 별칭(@/) 을 쓰지 않는다(node --test).
 */
import type { ProgressRuntime } from "./progressRuntime.ts";
import type { PreparedInteraction } from "./progressSync.ts";

type Runtime = Pick<ProgressRuntime, "availability" | "prepare" | "send">;

export interface InspectRecorderOptions {
  runtime: Runtime;
  /** 지금 Play Session id — 준비 전이면 null */
  playSessionId: () => string | null;
  /** 세션 상태가 바뀔 때 부를 곳(동행 세션 subscribe). 돌려준 함수로 끊는다 */
  subscribe?: (listener: () => void) => () => void;
  onDiagnostic?: (message: string, detail?: unknown) => void;
}

interface Waiting {
  zone: string;
  object: string;
  /** 연결 실패로 쥔 같은 이벤트 */
  prepared: PreparedInteraction | null;
}

export function createInspectRecorder(options: InspectRecorderOptions) {
  const { runtime } = options;
  const diagnose = options.onDiagnostic ?? (() => {});
  /** 아직 서버에 남기지 못한 「읽었다」 — `zone\nobject` */
  const waiting = new Map<string, Waiting>();
  /** 남긴 것 — `playSessionId\nzone\nobject` */
  const recorded = new Set<string>();
  let running: Promise<void> | null = null;
  let again = false;
  let isWaitingTold = false;

  async function drain() {
    for (const [key, entry] of [...waiting]) {
      const availability = runtime.availability();
      const session = options.playSessionId();
      if (availability !== "ready" || session === null) {
        if (availability === "not-configured" && !isWaitingTold) {
          isWaitingTold = true;
          diagnose("대응표 확정 전 — 읽은 것을 기억해 두고 기다린다", [...waiting.keys()]);
        }
        return;
      }
      isWaitingTold = false;
      const recordKey = `${session}\n${key}`;
      if (recorded.has(recordKey)) {
        waiting.delete(key);
        continue;
      }
      if (!entry.prepared) {
        const result = runtime.prepare({ action: "inspect", zone: entry.zone, object: entry.object });
        if (!result.ok) {
          waiting.delete(key);
          diagnose("대응표에 없는 물건 — 보내지 않음", key);
          continue;
        }
        entry.prepared = result.prepared;
      }
      const outcome = await runtime.send(entry.prepared);
      if (outcome.kind === "sent") {
        recorded.add(recordKey);
        waiting.delete(key);
      } else if (outcome.kind === "not-sent") {
        return;
      } else if (outcome.kind === "unreachable" || outcome.kind === "invalid-response") {
        diagnose("연결 실패 — 같은 이벤트로 다시 보낸다", outcome);
        return;
      } else {
        waiting.delete(key);
        diagnose("서버가 받지 않음", outcome);
      }
    }
  }

  /** 기다리는 것을 지금 보낼 수 있으면 보낸다. 도는 중이면 끝난 뒤 한 번 더 돈다 */
  function flush(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await drain();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  options.subscribe?.(() => void flush());

  return {
    /** 읽었다. 이 Play Session 에 이미 남겼으면 아무것도 하지 않는다 */
    note(zone: string, object: string): Promise<void> {
      const key = `${zone}\n${object}`;
      const session = options.playSessionId();
      if (session !== null && recorded.has(`${session}\n${key}`)) return Promise.resolve();
      if (!waiting.has(key)) waiting.set(key, { zone, object, prepared: null });
      return flush();
    },
    flush,
    /** 아직 남기지 못한 수(시험 · 진단용) */
    waitingCount: () => waiting.size,
  };
}

export type InspectRecorder = ReturnType<typeof createInspectRecorder>;
