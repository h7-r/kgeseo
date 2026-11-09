/**
 * 동행 대화창의 상태 — 지금 떠 있는 말 한 마디와 그 뒤에 줄 선 말들.
 *
 * 화면 아래 창 하나에 동행의 말이 전부 모인다: 퍼즐 설명(guide) · 상황 대사(line) · 방금 일어난 일(notice) ·
 * 힌트(hint) · 대답을 기다리는 물음(ask). 급한 말이 덜 급한 말을 밀어내고, 같은 급의 말은 차례로 이어진다.
 * 플레이어가 건 물음은 대답할 때까지 자리를 지키고, 동행이 먼저 건 물음은 방금 일어난 일의 알림에 자리를 내준다.
 * 긴 말은 쪽으로 나뉘어 차례로 넘어간다(paginate) — 창이 커지지 않는다.
 * React · 별칭을 쓰지 않는다(node --test).
 */
import { paginate, textWidth } from "./paginate.ts";

export type SpeechKind = "ask" | "hint" | "notice" | "line" | "guide";

export interface Choice {
  id: string;
  label: string;
}

export interface Speech {
  kind: SpeechKind;
  text: string;
  /** 이름 옆에 붙는 화제 — 퍼즐 이름 */
  topic?: string;
  /** 대사 id(NUDGE_…) — 서버 승인 대사와 대조하고 기록에 남긴다 */
  lineId?: string;
  /** 물음의 선택지. 둘이면 [Y] [N], 셋부터는 [1] [2] [3] 으로 고른다 */
  choices?: Choice[];
  /** 선택지가 둘이어도 숫자로 고른다 — 예 · 아니오가 아닌 물음(반말 · 존댓말) */
  numbered?: boolean;
  /** 물음이 대답 없이 물러나는 시간. 없으면 계속 기다린다 */
  timeoutMs?: number;
  /** 한 쪽이 머무는 최소 시간 — 알림처럼 부른 쪽이 길이를 정한 말 */
  holdMs?: number;
  /** 이 말을 끌어낸 플레이어의 말 — 대화처럼 동행의 말 위에 작게 보인다 */
  asked?: string;
  /** 플레이어가 먼저 건 대화 — 고르는 동안 마우스를 풀어 눌러서 고를 수 있게 한다 */
  freeCursor?: boolean;
  /** 줄에서 이만큼 넘게 기다렸으면 버린다 — 때를 놓친 말(이미 지나간 상황의 한마디)이 늦게 튀어나오지 않게 */
  ttlMs?: number;
  /**
   * 화면에 뜰 때마다(밀려났다 다시 뜰 때도) — 실제로 플레이어에게 보였는지를 부른 쪽이 안다. 줄에서 기다리다 버려진 말은 부르지 않는다.
   * 서버 개입(넛지 · 제안)의 쿨다운 · 퍼즐당 횟수를 「보인 것」만 세는 데 쓴다(companionBridge)
   */
  onShow?: () => void;
  /** 같은 key 의 말이 떠 있거나 줄 서 있으면 새 말로 바꿔 끼운다 */
  key?: string;
  /** 미룰 수 없는 말(숨이 모자란다) — 급을 따지지 않고 떠 있는 말을 물리고 바로 뜬다 */
  urgent?: boolean;
  /** 물음의 대답(고른 선택지 id). 대답 없이 물러나면 null */
  onAnswer?: (choiceId: string | null) => void;
}

export interface ShownSpeech {
  speech: Speech;
  pages: string[];
  pageIndex: number;
  /** 같은 말이라도 쪽이 넘어가면 달라진다 — 화면이 글자를 처음부터 다시 찍는 기준 */
  serial: number;
}

/** 클수록 급하다. 같은 급이면 새 말이 떠 있는 말을 밀어낸다 */
const PRIORITY: Record<SpeechKind, number> = { ask: 4, hint: 3, notice: 2, line: 1, guide: 0 };
const QUEUE_LIMIT = 4;

export const DIALOGUE_TIMING = {
  /** 한 쪽이 머무는 시간 = base + 글자 폭 × perChar (min~max) */
  baseMs: 1400,
  perCharMs: 95,
  minMs: 2600,
  maxMs: 9500,
  /** 화면이 글자를 찍는 속도 — 머무는 시간에 이미 들어 있다 */
  typeMs: 22,
};

type Timing = typeof DIALOGUE_TIMING;

export function pageDurationMs(text: string, timing: Timing = DIALOGUE_TIMING, holdMs = 0): number {
  const byLength = Math.min(timing.maxMs, Math.max(timing.minMs, timing.baseMs + textWidth(text) * timing.perCharMs));
  return Math.max(byLength, holdMs);
}

interface StoreOptions {
  timing?: Partial<Timing>;
  /** 한 쪽에 들어가는 폭(한글 글자 수) — 화면이 창 너비를 재서 고친다 */
  capacity?: number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** 아직 안 읽은 쪽들 */
const restOf = (shown: ShownSpeech) => shown.pages.slice(shown.pageIndex).join(" ");
/** 밀려나도 나중에 이어 읽어야 하는 말 — 퍼즐 설명과 플레이어가 청한 대답 */
const isResumable = (speech: Speech) => speech.kind === "guide" || (speech.kind === "line" && !!speech.asked);

export function createDialogueStore(options: StoreOptions = {}) {
  const timing: Timing = { ...DIALOGUE_TIMING, ...options.timing };
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const listeners = new Set<() => void>();

  let capacity = options.capacity ?? 96;
  let current: ShownSpeech | null = null;
  let queue: (Speech & { queuedAt: number })[] = [];
  let timer: unknown = null;
  let serial = 0;
  /** 연출 중처럼 말을 걸면 안 되는 동안 — 떠 있는 말은 내리고 새 말은 줄만 세운다 */
  let isHeld = false;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  function stopTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function armTimer() {
    stopTimer();
    if (!current) return;
    const { speech, pages, pageIndex } = current;
    const isLastPage = pageIndex >= pages.length - 1;
    // 물음은 마지막 쪽에서 대답을 기다린다(정한 시간이 있으면 그때 물러난다)
    if (speech.kind === "ask" && isLastPage) {
      if (speech.timeoutMs) timer = setTimer(() => finish(null), speech.timeoutMs);
      return;
    }
    timer = setTimer(step, pageDurationMs(pages[pageIndex], timing, speech.holdMs));
  }

  function show(speech: Speech) {
    const pages = paginate(speech.text, capacity);
    if (pages.length === 0) return showNext();
    current = { speech, pages, pageIndex: 0, serial: ++serial };
    armTimer();
    emit();
    speech.onShow?.();
  }

  function showNext() {
    stopTimer();
    current = null;
    // 기다리다 때를 놓친 말은 꺼내지 않는다
    const fresh = queue.filter((queued) => !queued.ttlMs || Date.now() - queued.queuedAt <= queued.ttlMs);
    for (const queued of queue) if (!fresh.includes(queued)) queued.onAnswer?.(null);
    queue = fresh;
    if (!isHeld && queue.length) {
      // 가장 급한 말부터, 같은 급이면 먼저 온 말부터
      let best = 0;
      for (let k = 1; k < queue.length; k++) if (PRIORITY[queue[k].kind] > PRIORITY[queue[best].kind]) best = k;
      const [next] = queue.splice(best, 1);
      show(next);
      return;
    }
    emit();
  }

  /** 다음 쪽으로. 마지막 쪽이면 말을 마친다 */
  function step() {
    if (!current) return;
    if (current.pageIndex < current.pages.length - 1) {
      current = { ...current, pageIndex: current.pageIndex + 1, serial: ++serial };
      armTimer();
      emit();
      return;
    }
    if (current.speech.kind === "ask") return;
    showNext();
  }

  function finish(choiceId: string | null) {
    const speech = current?.speech;
    if (!speech) return;
    showNext();
    speech.onAnswer?.(choiceId);
  }

  function enqueue(speech: Speech) {
    if (speech.key) queue = queue.filter((queued) => queued.key !== speech.key);
    // 같은 말이 연달아 줄 서지 않게
    const last = queue[queue.length - 1];
    if (last && last.kind === speech.kind && last.text === speech.text) return;
    queue.push({ ...speech, queuedAt: Date.now() });
    // 넘치면 덜 급하고 오래된 말부터 버린다 — 대답 못 받은 물음은 「대답 없음」으로 돌려준다
    while (queue.length > QUEUE_LIMIT) {
      let worst = 0;
      for (let k = 1; k < queue.length; k++) if (PRIORITY[queue[k].kind] < PRIORITY[queue[worst].kind]) worst = k;
      const [dropped] = queue.splice(worst, 1);
      dropped.onAnswer?.(null);
    }
  }

  /**
   * 떠 있던 말을 물린다 — 알림 · 설명 · 힌트 · 청한 대답과 플레이어가 건 물음은 줄에 남겨 뒤에 이어 가고,
   * 동행이 먼저 건 말은 때가 지났으니 거둔다. 거둔 물음은 돌려준다(부른 쪽이 「대답 없음」을 알린다).
   */
  function setAside(interrupted: ShownSpeech): Speech | null {
    const { speech } = interrupted;
    if (speech.kind === "ask") {
      if (speech.timeoutMs) return speech;
      enqueue(speech);
    } else if (speech.kind !== "line" || speech.asked) enqueue({ ...speech, text: restOf(interrupted) });
    return null;
  }

  return {
    getState: () => current,
    queueLength: () => queue.length,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /**
     * 동행이 말한다. 더 급한 말은 떠 있는 말을 밀어내고, 같거나 덜 급한 말은 뒤에 줄 선다(알림끼리는 새 알림이 앞선다).
     * 밀려난 설명과 플레이어가 청한 대답은 남은 쪽부터 다시 이어진다. 미룰 수 없는 말(urgent)은 물음 앞에도 선다.
     */
    say(speech: Speech) {
      if (!speech.text.trim()) return;
      if (isHeld) return enqueue(speech);
      if (!current) return show(speech);
      const shown = current.speech;
      if (speech.key && speech.key === shown.key) return show(speech);
      if (speech.urgent) {
        const withdrawn = setAside(current);
        show(speech);
        withdrawn?.onAnswer?.(null);
        return;
      }
      const isFeedback = speech.kind === "notice" || speech.kind === "hint";
      if (shown.kind === "ask") {
        // 동행이 먼저 꺼낸 물음(시간이 지나면 물러나는 것)은 방금 일어난 일을 알리는 말에 자리를 내준다
        if (!shown.timeoutMs || !isFeedback) return enqueue(speech);
        show(speech);
        shown.onAnswer?.(null);
        return;
      }
      const isUrgent =
        PRIORITY[speech.kind] > PRIORITY[shown.kind] || (speech.kind === "notice" && shown.kind === "notice");
      if (!isUrgent) return enqueue(speech);
      if (isResumable(shown)) enqueue({ ...shown, text: restOf(current) });
      show(speech);
    },

    /** 물어보고 대답을 기다린다 — 고른 선택지 id, 대답 없이 물러나면 null */
    ask(speech: Omit<Speech, "kind" | "onAnswer">): Promise<string | null> {
      return new Promise((resolve) => {
        this.say({ ...speech, kind: "ask", onAnswer: resolve });
      });
    },

    /** 플레이어가 넘겼다 — 다음 쪽 · 말 마치기. 물음의 마지막 쪽은 넘길 수 없다(대답해야 한다) */
    advance() {
      if (!current) return false;
      const isLastPage = current.pageIndex >= current.pages.length - 1;
      if (current.speech.kind === "ask" && isLastPage) return false;
      step();
      return true;
    },

    /** 물음에 대답한다. 지금 물음의 선택지가 아니면 무시한다 */
    answer(choiceId: string) {
      const speech = current?.speech;
      if (speech?.kind !== "ask" || !speech.choices?.some((choice) => choice.id === choiceId)) return false;
      finish(choiceId);
      return true;
    },

    /** 지금 물음을 「대답 없음」으로 물린다(Esc · 자리를 뜸) */
    declineAsk() {
      if (current?.speech.kind !== "ask") return false;
      finish(null);
      return true;
    },

    /** 이 key 의 말을 내린다 — 퍼즐에서 멀어지면 그 설명은 더 읽을 까닭이 없다 */
    retract(key: string) {
      queue = queue.filter((queued) => queued.key !== key);
      if (current?.speech.key === key && current.speech.kind !== "ask") showNext();
    },

    /**
     * 연출 · 읽는 창이 떠 있는 동안은 말을 멈춘다. 떠 있던 알림 · 설명 · 힌트 · 청한 대답은 줄에 남겨 끝난 뒤 이어 가고,
     * 동행이 먼저 건 말과 물음은 때가 지났으니 거둔다.
     */
    setHeld(next: boolean) {
      if (isHeld === next) return;
      isHeld = next;
      if (!isHeld) {
        if (!current) showNext();
        return;
      }
      const interrupted = current;
      stopTimer();
      current = null;
      if (interrupted) setAside(interrupted)?.onAnswer?.(null);
      emit();
    },

    /** 창 너비가 바뀌어 한 쪽에 들어가는 글자 수가 달라졌다 — 떠 있는 말은 지금 쪽부터 다시 나눈다 */
    setCapacity(next: number) {
      const rounded = Math.max(12, Math.round(next));
      if (rounded === capacity) return;
      capacity = rounded;
      if (!current) return;
      const rest = current.pages.slice(current.pageIndex).join(" ");
      current = { ...current, pages: paginate(rest, capacity), pageIndex: 0, serial: ++serial };
      armTimer();
      emit();
    },

    reset() {
      stopTimer();
      for (const speech of queue) speech.onAnswer?.(null);
      const shown = current?.speech;
      queue = [];
      current = null;
      shown?.onAnswer?.(null);
      emit();
    },
  };
}

export type DialogueStore = ReturnType<typeof createDialogueStore>;
