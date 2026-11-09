/**
 * 동행 NPC 대화 · 힌트 제안 상태. 한 번에 요청 하나만 기다린다.
 *
 * 계약(backend/app/schemas/npc_turn.py · hint.py)에서 지키는 것:
 * - reply 가 null 이면 정상 무발화다. 말풍선 · 오류를 띄우지 않고 FE 가 대사를 지어내지 않는다.
 * - 모드는 content_mode, 사유는 fallback_reason 으로만 읽는다(reply 유무로 추측하지 않는다).
 * - suggest_hint 는 해금이 아니라 제안이다. 플레이어가 수락할 때만 Hint API 를 부른다(level 1 고정).
 *   level 1 응답의 puzzle_id 로 level 2(정답) · 다시 보기를 puzzle_id 경로로 연다.
 * - generic(긴급 중단 등)이면 NPC 의 힌트 제안만 숨긴다. 정식 힌트(puzzle_id 경로)는 그대로 둔다.
 * - 서버 영문 detail 은 화면에 내지 않는다. 코드로 고른 한국어 문구만 띄우고 원문은 콘솔에 남긴다.
 * React · 별칭을 쓰지 않는다(node --test).
 */
import {
  CompanionApiError,
  clientTimestamp,
  errorCode,
  newEventId,
  postHint,
  postNpcTurn,
  type FallbackReason,
  type HintBody,
  type HintResponse,
  type NpcSituation,
  type NpcTurnBody,
  type NpcTurnResponse,
} from "./companionApi.ts";
import type { CompanionSession } from "./companionSession.ts";

export type DialogLine =
  | { kind: "npc"; text: string; lineId: string | null }
  | { kind: "hint"; level: 1 | 2; text: string; isReview: boolean }
  | { kind: "notice"; text: string };

/** 수락하면 Hint API 를 부를 제안. ref = NPC 가 권한 것(level 1), puzzle = 정식 힌트 버튼(다음 단계 · 다시 보기) */
export type HintOffer = { via: "ref"; hintRef: string; level: 1 } | { via: "puzzle"; puzzleId: string; level: 1 | 2 };

export interface DialogState {
  /** 세션이 준비돼 말을 걸 수 있는가 */
  isEnabled: boolean;
  waiting: "npc" | "hint" | null;
  line: DialogLine | null;
  offer: HintOffer | null;
  contentMode: "case" | "generic" | null;
  fallbackReason: FallbackReason | null;
  /** 첫 힌트 응답 전에는 모른다 */
  hintBalance: number | null;
  /** 이 플레이에서 연 힌트 단계(퍼즐별) */
  hintLevels: Record<string, number>;
}

/** 화면 문구 — 서버 영문 문장 대신 쓴다 */
export const DIALOG_TEXT = {
  connection: "연결이 불안정해요. 잠시 후 다시 말을 걸어 주세요.",
  sessionRenewed: "대화를 다시 이어 갈게요. 한 번 더 말을 걸어 주세요.",
  unavailable: "동행이 지금은 대답할 수 없어요.",
  failed: "지금은 대답을 듣지 못했어요.",
  balanceEmpty: "남은 힌트가 없어요.",
  hintUnavailable: "지금은 이 힌트를 열 수 없어요.",
  hintNotYet: "아직 이 힌트를 열 수 없어요.",
} as const;

export const DIALOG_TIMING = {
  /** 대사 머무름 = 1s + 글자 × 85ms, 2.6~8s */
  lineBaseMs: 1000,
  lineCharMs: 85,
  lineMinMs: 2600,
  lineMaxMs: 8000,
  /** 힌트는 다시 읽게 1.5배, 최소 6s */
  hintMinMs: 6000,
  noticeMs: 2600,
  /** 자동 턴은 주기 호출하지 않는다 — 구역 진입 같은 순간에 한 번, 그래도 이 간격 안에서는 다시 보내지 않는다 */
  autoMinIntervalMs: 180_000,
};

/** E 로 말을 걸 때 보내는 플레이어 말(player_message 는 message 가 필수다). 플레이어 쪽 말이라 승인 대상이 아니다. */
export const TALK_OPENER = "도와줄 수 있어?";
export const MAX_MESSAGE_LENGTH = 200;

type Timing = typeof DIALOG_TIMING;

export function lineDurationMs(line: DialogLine, timing: Timing = DIALOG_TIMING): number {
  if (line.kind === "notice") return timing.noticeMs;
  const base = Math.min(
    timing.lineMaxMs,
    Math.max(timing.lineMinMs, timing.lineBaseMs + [...line.text].length * timing.lineCharMs),
  );
  return line.kind === "hint" ? Math.max(timing.hintMinMs, base * 1.5) : base;
}

export function createCompanionDialog(options: {
  session: CompanionSession;
  timing?: Partial<Timing>;
  now?: () => number;
  /** 자막을 지우는 타이머 — 게임에서는 「전부 멈춤」 동안 흐르지 않는 게임 타이머를 넘긴다(companionRuntime). 시험은 기본값 */
  timers?: { set: (callback: () => void, ms: number) => number; clear: (id: number) => void };
  log?: (level: "warn" | "error", message: string, detail?: unknown) => void;
}) {
  const { session } = options;
  const timing: Timing = { ...DIALOG_TIMING, ...options.timing };
  const now = options.now ?? (() => Date.now());
  const timers = options.timers ?? {
    set: (callback: () => void, ms: number) => setTimeout(callback, ms) as unknown as number,
    clear: (id: number) => clearTimeout(id),
  };
  const log = options.log ?? (() => {});
  const listeners = new Set<() => void>();

  const readySession = () => {
    const status = session.getStatus();
    return status.phase === "ready" ? status : null;
  };

  let state: DialogState = {
    isEnabled: readySession() !== null,
    waiting: null,
    line: null,
    offer: null,
    contentMode: null,
    fallbackReason: null,
    hintBalance: null,
    hintLevels: { ...(readySession()?.hintLevels ?? {}) },
  };
  /** 지금 기다리는 요청의 client_event_id — 다른 id 의 늦은 응답은 버린다 */
  let pendingId: string | null = null;
  let lineTimer: number | null = null;
  let lastAutoAt = -Infinity;
  let reportedContentError = false;

  const emit = () => {
    for (const listener of listeners) listener();
  };
  const patch = (next: Partial<DialogState>) => {
    state = { ...state, ...next };
    emit();
  };

  session.subscribe(() => {
    const ready = readySession();
    const isEnabled = ready !== null;
    if (isEnabled !== state.isEnabled) {
      // 세션이 바뀌면 그 전 세션의 제안 · 대기는 쓸모없다
      pendingId = null;
      patch({ isEnabled, waiting: null, offer: null, hintLevels: { ...(ready?.hintLevels ?? {}) } });
    }
  });

  function show(line: DialogLine | null) {
    if (lineTimer) timers.clear(lineTimer);
    lineTimer = null;
    patch({ line });
    if (!line) return;
    lineTimer = timers.set(
      () => {
        lineTimer = null;
        if (state.line === line) patch({ line: null });
      },
      lineDurationMs(line, timing),
    );
  }

  /**
   * NPC · Hint 공통 오류. 여기서 처리했으면 { text }(띄울 문구, null 이면 조용히 끝), 아니면 null —
   * 부른 쪽이 자기 오류(NPC 500 · 힌트 코드)로 마저 가른다.
   */
  function handleCommonError(error: unknown, kind: "npc" | "hint"): { text: string | null } | null {
    const code = errorCode(error);
    const status = error instanceof CompanionApiError ? error.status : null;
    if (status === null || (status >= 502 && status <= 504 && code === null)) {
      log("warn", `${kind} 요청이 서버에 닿지 못했다(${status ?? "network"}, 재시도 소진)`, error);
      return { text: DIALOG_TEXT.connection };
    }
    if (status === 404 && code === "Play session not found.") {
      log("warn", "세션이 없어져 새로 만든다");
      void session.recreate();
      return { text: DIALOG_TEXT.sessionRenewed };
    }
    if (status === 409 && code === "CASE_VERSION_UNAVAILABLE") {
      // 버전 고정 세션의 콘텐츠를 쓸 수 없다 — 다시 보내도 같다
      log("warn", "CASE_VERSION_UNAVAILABLE — 동행 NPC 를 끈다");
      session.disable("case-version-unavailable");
      return { text: DIALOG_TEXT.unavailable };
    }
    if (status === 409 && code === "Client event ID conflicts with a previous interaction.") {
      // 같은 id 에 다른 본문 — FE 버그다. 새 id 로 다시 보내지 않는다
      log("error", "client_event_id 충돌(같은 id · 다른 본문) — FE 버그", error);
      return { text: null };
    }
    if (status === 422) {
      log("error", `${kind} 요청 422 — FE 요청 모양 오류`, error);
      return { text: DIALOG_TEXT.failed };
    }
    if (code === "INVALID_RESPONSE") {
      log("error", `${kind} 응답이 계약 모양이 아니다`, error);
      return { text: DIALOG_TEXT.failed };
    }
    return null;
  }

  // ── NPC 턴 ──

  async function sendTurn(body: Omit<NpcTurnBody, "client_event_id" | "client_timestamp">) {
    const ready = readySession();
    if (!ready || state.waiting) return false;
    const request: NpcTurnBody = { client_event_id: newEventId(), client_timestamp: clientTimestamp(), ...body };
    pendingId = request.client_event_id;
    patch({ waiting: "npc" });
    try {
      const response = await postNpcTurn(ready.playSessionId, request);
      if (pendingId !== request.client_event_id) return true;
      applyTurn(response);
    } catch (error) {
      if (pendingId !== request.client_event_id) return true;
      const common = handleCommonError(error, "npc");
      if (common) {
        patch({ waiting: null });
        if (common.text) show({ kind: "notice", text: common.text });
      } else if (error instanceof CompanionApiError && error.status === 500) {
        // NPC 콘텐츠 검증 실패 등 — 비활성 + 보고(한 번)
        if (!reportedContentError) log("error", "NPC 500 — 동행 NPC 를 끈다", error);
        reportedContentError = true;
        session.disable("case-content-unavailable");
        patch({ waiting: null });
        show({ kind: "notice", text: DIALOG_TEXT.unavailable });
      } else {
        log("error", "NPC 턴 실패", error);
        patch({ waiting: null });
        show({ kind: "notice", text: DIALOG_TEXT.failed });
      }
    } finally {
      if (pendingId === request.client_event_id) pendingId = null;
    }
    return true;
  }

  function applyTurn(response: NpcTurnResponse) {
    const isCase = response.content_mode === "case";
    // generic 이면 NPC 의 힌트 제안은 숨긴다. 이미 연 퍼즐의 정식 힌트(puzzle 경로)는 남긴다
    let offer = state.offer;
    if (!isCase && offer?.via === "ref") offer = null;
    if (isCase && response.suggest_hint) offer = { via: "ref", hintRef: response.suggest_hint.hint_ref, level: 1 };
    patch({
      waiting: null,
      contentMode: response.content_mode,
      fallbackReason: response.fallback_reason,
      offer,
    });
    // 서버가 준 문장은 승인 원문(또는 긴급 중단의 「잠시 멈춤」)이다 — 그대로 띄운다. null 이면 아무것도 띄우지 않는다
    if (response.reply) show({ kind: "npc", text: response.reply.text, lineId: response.reply.line_id ?? null });
  }

  // ── 힌트 ──

  function hintErrorText(error: unknown): string {
    const code = errorCode(error);
    if (code === "HINT_BALANCE_EMPTY") return DIALOG_TEXT.balanceEmpty;
    if (
      code === "HINT_REF_MISMATCH" ||
      code === "HINT_REF_INVALID" ||
      code === "HINT_REF_UNAVAILABLE" ||
      code === "Puzzle not found." ||
      code === "Hint not found."
    )
      return DIALOG_TEXT.hintUnavailable;
    if (
      code === "Previous hint level is not unlocked." ||
      code === "Hint is not available yet." ||
      code === "Required clues are not acquired."
    )
      return DIALOG_TEXT.hintNotYet;
    return DIALOG_TEXT.failed;
  }

  async function acceptOffer() {
    const ready = readySession();
    const offer = state.offer;
    if (!ready || !offer || state.waiting) return false;
    const target = offer.via === "ref" ? { hint_ref: offer.hintRef } : { puzzle_id: offer.puzzleId };
    const request: HintBody = {
      client_event_id: newEventId(),
      client_timestamp: clientTimestamp(),
      target_level: offer.level,
      ...target,
    };
    pendingId = request.client_event_id;
    patch({ waiting: "hint" });
    try {
      const response = await postHint(ready.playSessionId, request);
      if (pendingId !== request.client_event_id) return true;
      applyHint(response);
    } catch (error) {
      if (pendingId !== request.client_event_id) return true;
      const common = handleCommonError(error, "hint");
      const text = common ? common.text : hintErrorText(error);
      if (!common) log("warn", `힌트 요청 실패(${errorCode(error) ?? "unknown"})`, error);
      // 수락한 제안은 이 응답으로 끝났다 — 같은 제안을 다시 띄우지 않는다(잔액 · 참조 문제)
      patch({ waiting: null, offer: null });
      if (text) show({ kind: "notice", text });
    } finally {
      if (pendingId === request.client_event_id) pendingId = null;
    }
    return true;
  }

  function applyHint(response: HintResponse) {
    const { result, hint } = response;
    const level = Math.max(result.hint_level, state.hintLevels[result.puzzle_id] ?? 0);
    session.noteHintLevel(result.puzzle_id, level);
    patch({
      waiting: null,
      hintBalance: result.hint_balance,
      hintLevels: { ...state.hintLevels, [result.puzzle_id]: level },
      // 다음은 level 2 — 아직이면 정답 열기, 이미 열었으면 다시 보기(서버가 already_unlocked · 차감 없음으로 준다)
      offer: { via: "puzzle", puzzleId: result.puzzle_id, level: 2 },
    });
    show({ kind: "hint", level: hint.level, text: hint.text, isReview: result.result_type === "already_unlocked" });
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** 채팅 전송 — player_message. E 로 말 걸기는 뺐고(계약 v0.4.16 §10-2) 자유 입력은 베타에서 숨긴다(§10-1, CompanionHud) */
    talk(message: string = TALK_OPENER) {
      const text = message.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!text) return Promise.resolve(false);
      return sendTurn({ trigger: "player_message", message: text });
    },
    /**
     * 끼어들어도 되는 순간(구역 진입 등)에 한 번. 주기 호출하지 않는다. 부르는 곳은 dialogue/companionBridge 하나다.
     * situation 이 있으면(계약 v0.4.16 §1) 횟수 · 쿨다운은 BE 가 센다 — 여기 간격으로 막지 않는다.
     * focusObjectId 는 걸음 상황의 대표 Object(나주 대응표 §4) — 상황과 함께만 싣는다.
     */
    autoTurn(situation?: NpcSituation, focusObjectId?: string) {
      if (!situation && now() - lastAutoAt < timing.autoMinIntervalMs) return Promise.resolve(false);
      if (!readySession() || state.waiting) return Promise.resolve(false);
      if (!situation) {
        lastAutoAt = now();
        return sendTurn({ trigger: "auto" });
      }
      return sendTurn(
        focusObjectId ? { trigger: "auto", situation, focus_object_id: focusObjectId } : { trigger: "auto", situation },
      );
    },
    acceptOffer,
    /**
     * [F] 보기 「힌트를 주세요」(계약 §10-2: 말 거는 키는 F 하나) — 서버 퍼즐 ID 로 다음 단계를 연다.
     * 1 → 2, 이미 2 면 다시 보기(already_unlocked · 차감 없음). 결과 · 오류 문구는 acceptOffer 와 같은 길로 line 에 뜬다.
     */
    requestPuzzleHint(puzzleId: string) {
      if (!readySession() || state.waiting) return Promise.resolve(false);
      const level = Math.min(2, (state.hintLevels[puzzleId] ?? 0) + 1) as 1 | 2;
      patch({ offer: { via: "puzzle", puzzleId, level } });
      return acceptOffer();
    },
    /** 지금 자막을 접는다 */
    dismissLine() {
      show(null);
    },
    /** 다음 단계 제안이 정답(level 2)인지 · 다시 보기인지 화면이 고를 때 쓴다 */
    isReviewOffer(offer: HintOffer | null) {
      return offer?.via === "puzzle" && (state.hintLevels[offer.puzzleId] ?? 0) >= offer.level;
    },
  };
}

export type CompanionDialog = ReturnType<typeof createCompanionDialog>;
