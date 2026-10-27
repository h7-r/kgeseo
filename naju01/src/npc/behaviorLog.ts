// 행동 상태 저장소(behaviorState)를 감싸 마지막으로 수락·거부된 이벤트를 남긴다 — 개발 도구 전용.
// 상태와 전이 규칙은 원래 저장소 그대로다(getState·subscribe 는 그대로 넘기고 dispatch 결과만 적는다).
// 감싼 저장소를 거치지 않고 원래 저장소에 직접 보낸 이벤트는 수락된 전이만 구독으로 알고, 이벤트 내용·거부는 모른다.
import type {
  NpcBehavior,
  NpcBehaviorEvent,
  NpcBehaviorRejection,
  NpcBehaviorResult,
  NpcBehaviorStore,
} from "./behaviorState";

export interface BehaviorLogEntry {
  /** 감싼 저장소로 들어온 이벤트. 원래 저장소에 직접 들어온 전이면 null */
  event: NpcBehaviorEvent | null;
  from: NpcBehavior;
  to: NpcBehavior;
  accepted: boolean;
  reason: NpcBehaviorRejection | null;
  /** performance.now() (ms) */
  at: number;
}

export interface BehaviorLog {
  lastAccepted: BehaviorLogEntry | null;
  lastRejected: BehaviorLogEntry | null;
  accepted: number;
  rejected: number;
}

export interface TrackedBehaviorStore extends NpcBehaviorStore {
  readonly log: BehaviorLog;
  /** 원래 저장소 구독을 붙인다(이미 붙어 있으면 그대로). 돌려준 함수로 뗀다 — 감싼 것을 버릴 때 떼야 구독이 쌓이지 않는다 */
  attach(): () => void;
}

function entry(event: NpcBehaviorEvent | null, result: NpcBehaviorResult): BehaviorLogEntry {
  return {
    event,
    from: result.previous.current,
    to: result.state.current,
    accepted: result.accepted,
    reason: result.reason ?? null,
    at: performance.now(),
  };
}

export function trackBehaviorStore(store: NpcBehaviorStore): TrackedBehaviorStore {
  const log: BehaviorLog = { lastAccepted: null, lastRejected: null, accepted: 0, rejected: 0 };
  // 원래 저장소에 직접 들어온 전이도 수락 기록에 남긴다. 감싼 dispatch 로 들어온 것이면 아래에서 이벤트를 채워 덮는다.
  let unsubscribe: (() => void) | null = null;
  const detach = () => {
    unsubscribe?.();
    unsubscribe = null;
  };
  const attach = () => {
    unsubscribe ??= store.subscribe((result) => {
      log.lastAccepted = entry(null, result);
      log.accepted++;
    });
    return detach;
  };
  attach();
  return {
    log,
    attach,
    getState: () => store.getState(),
    subscribe: (listener) => store.subscribe(listener),
    dispatch(event) {
      const result = store.dispatch(event);
      if (result.accepted) {
        log.lastAccepted = entry(event, result);
      } else {
        log.lastRejected = entry(event, result);
        log.rejected++;
      }
      return result;
    },
  };
}
