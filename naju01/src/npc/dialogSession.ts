// NPC 대화 세션 — 대화창 상태와 행동 상태(FSM)의 Interact 전환을 묶는다. React 의존 없음(화면은 useSyncExternalStore 로 구독).
//
// [규칙]
//   - 열기: START_INTERACT 가 수락됐을 때만 세션을 연다. 이미 열려 있으면 거부한다.
//   - 닫기: 몇 번 불러도 안전하다. 그 세션이 연 Interact 에 대해서만 END_INTERACT 를 한 번 보낸다.
//     (밖에서 Interact 를 끝냈으면 세션만 닫고 보내지 않는다.)
//   - 대사 요청마다 세션 번호와 AbortController 를 둔다. 닫힌 세션 · 지난 요청의 응답은 상태를 바꾸지 못한다.
//   - 공급자가 실패하거나 시간 안에 답하지 않으면 대화를 닫는다 — FSM 이 Interact 에 남지 않는다.
//   - 저장소 구독은 attach/detach 로 붙였다 뗀다(React effect 가 떼었다 다시 붙여도 같은 인스턴스로 이어 쓴다).
import type { NpcBehaviorStore } from "./behaviorState";
import type { NpcAiInput } from "./npcAiInput";
import type { DialogIntent, NpcDialogueObservation, NpcDialogueProvider, NpcLine } from "./npcDialogue";
import type { DialogAutoClose } from "./npcTargeting";

export type DialogPhase = "closed" | "loading" | "showing";

export type DialogCloseReason =
  | "finished" // 마지막 대사 뒤
  | "escape" // Esc
  | "user" // 개발 도구 등에서 닫음
  | DialogAutoClose // 거리 · 컷 · 씬 멈춤 · 잠금 풀림
  | "error" // 공급자 실패
  | "timeout" // 공급자 응답 시간 초과
  | "external" // 밖에서 Interact 를 끝냄
  | "unmount"; // 훅이 떨어짐

export interface DialogSnapshot {
  phase: DialogPhase;
  sessionId: number | null;
  /** 지금 대화를 연 까닭 (닫혀 있으면 null) */
  intent: DialogIntent | null;
  speaker: string | null;
  text: string | null;
  /** 지금 보이는(또는 기다리는) 대사 차례 */
  turn: number;
  /** 지금 대사가 마지막인지 */
  last: boolean;
  /** 마지막으로 닫힌 세션 */
  lastClose: { sessionId: number; reason: DialogCloseReason; error: string | null } | null;
  opened: number;
  closed: number;
}

export interface DialogSession {
  getSnapshot(): DialogSnapshot;
  subscribe(listener: () => void): () => void;
  isOpen(): boolean;
  /**
   * 대화를 연다. START_INTERACT 가 거부되거나 이미 열려 있으면 false.
   * intent 는 선택(기본 manual) — 공급자 맥락과 START_INTERACT 의 source(dialog · dialog:hint_offer)로 넘어간다.
   */
  open(intent?: DialogIntent): boolean;
  /** 대사가 보이는 중이면 다음 대사 (마지막이면 닫기). 기다리는 중이면 무시 */
  advance(): void;
  /** 닫기 — 열려 있지 않으면 아무것도 안 한다 */
  close(reason: DialogCloseReason, error?: string | null): void;
  attach(): () => void;
  detach(): void;
}

export interface DialogSessionOptions {
  store: NpcBehaviorStore;
  /** 대사 공급자 — 대화를 연 까닭에 따라 고를 수 있다 */
  getProvider: (intent: DialogIntent) => NpcDialogueProvider;
  getSpeaker: () => string;
  observe?: () => NpcDialogueObservation | null;
  /** 요청마다 공급자 맥락에 실을 AI 입력 (선택) */
  getAiInput?: () => NpcAiInput | null;
  /** 공급자 응답 시간 제한 (ms) */
  timeoutMs?: number;
}

interface ActiveSession {
  id: number;
  intent: DialogIntent;
  turn: number;
  last: boolean;
  /** 이 세션이 연 Interact 를 아직 쥐고 있는지 */
  owns: boolean;
  request: AbortController | null;
}

const CLOSED: DialogSnapshot = {
  phase: "closed",
  sessionId: null,
  intent: null,
  speaker: null,
  text: null,
  turn: 0,
  last: false,
  lastClose: null,
  opened: 0,
  closed: 0,
};

export function createDialogSession({
  store,
  getProvider,
  getSpeaker,
  observe,
  getAiInput,
  timeoutMs = 5000,
}: DialogSessionOptions): DialogSession {
  let current: ActiveSession | null = null;
  let nextId = 0;
  let snapshot: DialogSnapshot = CLOSED;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<DialogSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };

  const request = (session: ActiveSession, kind: "open" | "next") => {
    session.request?.abort();
    const controller = new AbortController();
    session.request = controller;
    const stale = () => current !== session || session.request !== controller || controller.signal.aborted;
    const timer = setTimeout(() => {
      if (stale()) return;
      controller.abort();
      close("timeout");
    }, timeoutMs);
    const context = {
      sessionId: session.id,
      turn: session.turn,
      speaker: getSpeaker(),
      observation: observe?.() ?? null,
      intent: session.intent,
      aiInput: getAiInput?.() ?? null,
    };
    let reply: Promise<NpcLine | null>;
    try {
      const provider = getProvider(session.intent);
      reply = kind === "open" ? provider.open(context, controller.signal) : provider.next(context, controller.signal);
    } catch (error) {
      reply = Promise.reject(error);
    }
    reply.then(
      (line) => {
        clearTimeout(timer);
        if (stale()) return;
        session.request = null;
        if (!line) {
          close("finished");
          return;
        }
        session.last = line.last === true;
        publish({ phase: "showing", speaker: line.speaker ?? getSpeaker(), text: line.text, last: session.last });
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (stale()) return;
        close("error", error instanceof Error ? error.message : String(error));
      },
    );
  };

  const close = (reason: DialogCloseReason, error: string | null = null) => {
    const session = current;
    if (!session) return;
    current = null; // 아래 END_INTERACT 알림이 다시 닫기를 부르지 않게 먼저 비운다
    session.request?.abort();
    session.request = null;
    publish({
      phase: "closed",
      sessionId: null,
      intent: null,
      speaker: null,
      text: null,
      last: false,
      lastClose: { sessionId: session.id, reason, error },
      closed: snapshot.closed + 1,
    });
    if (session.owns && store.getState().current === "Interact")
      store.dispatch({ type: "END_INTERACT", source: `dialog:${reason}` });
  };

  let unsubscribe: (() => void) | null = null;
  const detach = () => {
    unsubscribe?.();
    unsubscribe = null;
  };
  const attach = () => {
    unsubscribe ??= store.subscribe((result) => {
      // 밖(개발 도구 · 다른 입력)에서 Interact 가 끝나면 세션만 닫는다
      if (current && result.previous.current === "Interact" && result.state.current !== "Interact") {
        current.owns = false;
        close("external");
      }
    });
    return detach;
  };
  attach();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isOpen: () => current !== null,
    open(intent = "manual") {
      if (current) return false;
      const source = intent === "manual" ? "dialog" : `dialog:${intent}`;
      if (!store.dispatch({ type: "START_INTERACT", source }).accepted) return false;
      const session: ActiveSession = { id: ++nextId, intent, turn: 0, last: false, owns: true, request: null };
      current = session;
      publish({
        phase: "loading",
        sessionId: session.id,
        intent,
        speaker: getSpeaker(),
        text: null,
        turn: 0,
        last: false,
        opened: snapshot.opened + 1,
      });
      request(session, "open");
      return true;
    },
    advance() {
      const session = current;
      if (!session || snapshot.phase !== "showing") return;
      if (session.last) {
        close("finished");
        return;
      }
      session.turn++;
      publish({ phase: "loading", turn: session.turn });
      request(session, "next");
    },
    close,
    attach,
    detach,
  };
}

/** 화면 안내 종류: [F] 대화 · [F] 도움 · 없음 */
export type InteractionPrompt = "talk" | "help" | null;

/** 화면 안내 — 바뀔 때만 알린다 */
export interface InteractionPromptStore {
  get(): InteractionPrompt;
  set(value: InteractionPrompt): void;
  subscribe(listener: () => void): () => void;
}

export function createInteractionPromptStore(): InteractionPromptStore {
  let value: InteractionPrompt = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
