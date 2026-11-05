// 게임 이벤트 → NPC 행동 상태 명령으로 바꾸는 컨트롤러. React·Three.js 의존 없음.
// 프로토타입(feat/SJ-npc-follow-prototype · src/npc/npcEventController.ts) 이식. 중복 처리 · 대화 중 보류 ·
// 채널별 최신 이벤트 적용 · 처리 기록은 그대로다. 다른 점:
//   - 기본 규칙 표가 비어 있다. 실제 게임의 NPC 반응이 정해지지 않았으므로 기본은 「기록만」(no-rule)이고,
//     규칙을 넘겼을 때만 FSM 명령을 보낸다.
//   - 이벤트 종류가 나주 계약(gameEvents.ts)으로 바뀌었다.
// 이 컨트롤러는 행동 상태 저장소에 START_FOLLOW · STOP_FOLLOW 를 보낼 뿐이다 — NPC 위치·속도에는 손대지 않는다.
// [생명주기] 규칙은 setRules 로 바꾼다 — 인스턴스·중복 기록·보류분은 그대로다. 저장소 구독은 attach/detach 로 붙였다 뗄 수 있다
//   (만들 때 붙는다). React effect 가 떼었다 다시 붙여도(StrictMode·재마운트) 같은 인스턴스로 이어 쓴다.
import { createFollowCommands, type NpcBehaviorResult, type NpcBehaviorStore } from "./behaviorState";
import { parseGameEvent, type GameEvent, type GameEventType } from "./gameEvents";

export type NpcEventAction = "START_FOLLOW" | "STOP_FOLLOW";

// 이벤트 종류 + 대상 ID 조합마다 NPC 반응을 정한다
export interface NpcEventRule {
  event_type: GameEventType;
  target_id: string;
  action: NpcEventAction;
}

/** 기본 규칙: 없음 — 모든 이벤트를 기록만 한다 */
export const DEFAULT_NPC_EVENT_RULES: readonly NpcEventRule[] = [];

export type NpcEventStatus = "applied" | "deferred" | "ignored";

export type NpcEventIgnoreReason =
  | "invalid" // 계약에 맞지 않는 데이터
  | "duplicate" // 이미 받은 event_id
  | "no-rule" // 등록된 규칙이 없는 이벤트 — 기록만
  | "no-change" // 이미 그 행동 상태
  | "superseded"; // 대화 중 보류됐다가 같은 채널(동행 모드)의 더 나중 이벤트로 대체됨

export interface NpcEventResult {
  seq: number; // 컨트롤러가 받은 순서 (보류 처리 순서의 기준)
  status: NpcEventStatus;
  reason?: NpcEventIgnoreReason;
  event: GameEvent | null;
  action?: NpcEventAction;
  behavior?: NpcBehaviorResult;
  // immediate = 받은 즉시 처리, flush = 대화 종료 후 보류분 처리
  phase: "immediate" | "flush";
}

export interface NpcEventControllerSnapshot {
  pending: readonly GameEvent[]; // 대화 종료를 기다리는 이벤트 (받은 순서)
  log: readonly NpcEventResult[]; // 최근 처리 결과 (최신이 마지막)
  received: number; // 지금까지 받은 이벤트 수 (잘못된 것 포함)
}

export interface NpcEventController {
  handle(input: unknown): NpcEventResult;
  /**
   * 규칙 표만 바꾼다. 받은 event_id 기록·대화 중 보류분은 그대로 두고, 보류분은 받을 때 정한 행동을 그대로 쓴다.
   * 행동 상태 저장소는 건드리지 않는다.
   */
  setRules(rules: readonly NpcEventRule[]): void;
  getSnapshot(): NpcEventControllerSnapshot;
  subscribe(listener: () => void): () => void;
  /** 저장소 구독을 붙인다(이미 붙어 있으면 그대로). 돌려준 함수로 뗀다 */
  attach(): () => void;
  /** 저장소 구독을 뗀다 — 떼어 둔 동안 대화가 끝나면 보류분을 처리하지 않는다 */
  detach(): void;
  /** 구독을 떼고 화면 구독자도 비운다 */
  dispose(): void;
}

export interface NpcEventControllerOptions {
  rules?: readonly NpcEventRule[];
  logLimit?: number; // 디버그용으로 남길 결과 수
  seenLimit?: number; // 중복 판정용으로 기억할 event_id 수
}

// 같은 채널에 속한 명령은 서로 덮어쓴다. 지금은 모든 규칙이 '동행 모드' 하나를 바꾼다.
// 이후 다른 종류의 반응이 생기면 별도 채널로 두어 서로 대체되지 않게 한다.
function channelOf(action: NpcEventAction): string {
  switch (action) {
    case "START_FOLLOW":
    case "STOP_FOLLOW":
      return "follow-mode";
  }
}

interface PendingItem {
  seq: number;
  event: GameEvent;
  action: NpcEventAction;
}

export function createNpcEventController(
  store: NpcBehaviorStore,
  { rules = DEFAULT_NPC_EVENT_RULES, logLimit = 20, seenLimit = 500 }: NpcEventControllerOptions = {},
): NpcEventController {
  const commands = createFollowCommands(store);
  const toRuleMap = (list: readonly NpcEventRule[]) => new Map(list.map((r) => [`${r.event_type}:${r.target_id}`, r]));
  let ruleMap = toRuleMap(rules);
  const seen = new Set<string>();
  let pending: PendingItem[] = [];
  let log: NpcEventResult[] = [];
  let seq = 0;
  let snapshot: NpcEventControllerSnapshot = { pending: [], log: [], received: 0 };
  const listeners = new Set<() => void>();

  const publish = () => {
    snapshot = { pending: pending.map((p) => p.event), log, received: seq };
    listeners.forEach((listener) => listener());
  };

  const record = (result: NpcEventResult): NpcEventResult => {
    log = [...log, result].slice(-logLimit);
    return result;
  };

  const remember = (eventId: string) => {
    seen.add(eventId);
    // 오래된 ID부터 잊는다 (Set은 넣은 순서를 유지)
    if (seen.size > seenLimit) seen.delete(seen.values().next().value as string);
  };

  const apply = (
    itemSeq: number,
    event: GameEvent,
    action: NpcEventAction,
    phase: NpcEventResult["phase"],
  ): NpcEventResult => {
    const source = `event:${event.event_type}:${event.event_id}`;
    const behavior = action === "START_FOLLOW" ? commands.startFollow(source) : commands.stopFollow(source);
    return record({
      seq: itemSeq,
      status: behavior.accepted ? "applied" : "ignored",
      reason: behavior.accepted ? undefined : "no-change",
      event,
      action,
      behavior,
      phase,
    });
  };

  // 대화 종료 후 보류 이벤트 처리.
  // 같은 채널 안에서는 받은 순서상 마지막 이벤트만 적용하고 앞선 것은 superseded로 기록한다.
  // (동행 모드는 '최종 상태'만 의미가 있어, 전부 차례로 적용하면 같은 프레임에 Idle·Follow가
  //  번갈아 바뀔 뿐 결과는 마지막과 같다.) 채널 사이의 처리 순서는 받은 순서를 따른다.
  const flush = () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    const lastInChannel = new Map<string, number>();
    batch.forEach((item) => lastInChannel.set(channelOf(item.action), item.seq));
    for (const item of batch) {
      if (lastInChannel.get(channelOf(item.action)) === item.seq) {
        apply(item.seq, item.event, item.action, "flush");
      } else {
        record({
          seq: item.seq,
          status: "ignored",
          reason: "superseded",
          event: item.event,
          action: item.action,
          phase: "flush",
        });
      }
    }
    publish();
  };

  // 대화(Interact)가 끝나 다른 상태로 바뀌는 순간 보류분을 처리한다
  let unsubscribe: (() => void) | null = null;
  const detach = () => {
    unsubscribe?.();
    unsubscribe = null;
  };
  const attach = () => {
    unsubscribe ??= store.subscribe((result) => {
      if (result.previous.current === "Interact" && result.state.current !== "Interact") flush();
    });
    return detach;
  };
  attach();

  return {
    handle(input) {
      const itemSeq = ++seq;
      const event = parseGameEvent(input);
      let result: NpcEventResult;
      if (!event) {
        result = record({ seq: itemSeq, status: "ignored", reason: "invalid", event: null, phase: "immediate" });
      } else if (seen.has(event.event_id)) {
        result = record({ seq: itemSeq, status: "ignored", reason: "duplicate", event, phase: "immediate" });
      } else {
        remember(event.event_id);
        const rule = ruleMap.get(`${event.event_type}:${event.target_id}`);
        if (!rule) {
          result = record({ seq: itemSeq, status: "ignored", reason: "no-rule", event, phase: "immediate" });
        } else if (store.getState().current === "Interact") {
          // 대화 중 동행 명령은 저장소가 거부하므로 여기서 보류한다
          pending = [...pending, { seq: itemSeq, event, action: rule.action }];
          result = record({ seq: itemSeq, status: "deferred", event, action: rule.action, phase: "immediate" });
        } else {
          result = apply(itemSeq, event, rule.action, "immediate");
        }
      }
      publish();
      return result;
    },
    setRules(next) {
      ruleMap = toRuleMap(next);
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach,
    detach,
    dispose() {
      detach();
      listeners.clear();
    },
  };
}
