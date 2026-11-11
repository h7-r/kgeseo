/**
 * 세진 님 동행 서버 대화(companion/companionDialog)와 대화창(dialogue)을 잇는 다리 — 화면은 대화창 한 벌이다(계약 v0.4.16 §10).
 *
 *   서버가 준 말    companionDialog 의 line(승인 대사 · 힌트 · 한국어 알림)이 새로 생기면 대화창에 그대로 올린다.
 *                   reply 가 null 이면 line 이 안 생기므로 아무것도 띄우지 않는다. 영문 detail 은 companionDialog 가 이미 걸렀다(DIALOG_TEXT).
 *   힌트 제안       suggest_hint(offer via ref)가 오면 Y/N 으로 묻고 「네」일 때만 acceptOffer — 동행을 겨눈 E 꾹을 대신한다(§10-2).
 *   auto 턴         상황 감지(situations)가 낸 상황 · 구역 진입 · 퍼즐 폴링을 여기 한 길로만 보낸다(createAutoTurnPlanner).
 *                   퍼즐 폴링: 지금 목표가 서버 퍼즐이면 1분마다 그 퍼즐 대표 Object 를 focus_object_id 로 실은 auto 턴 —
 *                   v0.4.7 퍼즐 자동 개입(오답 6회 · 무입력 240초)을 BE 가 판단할 수 있게(상황을 싣든 안 싣든).
 *                   표시할 수 없을 때(연출 · 창 · 장면 인물 대화 · 동행 물음 · 첫 소개)는 보내지 않고 버린다 — 늦게 보내지도 않는다(계약 §11-2).
 *                   서버 개입(넛지 대사 · 제안)을 받은 순간부터 쉬고(구역 진입 auto 턴도), 받은 개입이 아직 대화창 줄에서 기다리면 폴링을 안 보낸다.
 *                   상황 대사는 퍼즐 자동 개입의 표시 · 거절 보고 대상이 아니다(§11-7) — FE 는 어느 쪽도 보고하지 않는다.
 *   [F] 정식 힌트   director 의 HintProvider — 지금 판에 정식 힌트가 있는 서버 퍼즐일 때만 Hint API 를 부른다(HINTED_PUZZLES).
 *
 * 서버 통신은 세진 님 코드 그대로 쓴다(같은 Play Session). React · 별칭 · import.meta.env 를 쓰지 않는다(node --test) — 싱글턴을
 * 잇는 일은 companionLink.ts 가 한다.
 */
import type { NpcSituation } from "../companion/companionApi.ts";
import type { DialogLine, DialogState, HintOffer } from "../companion/companionDialog.ts";
import type { Speech } from "./dialogueStore.ts";
import type { HintProvider } from "./director.ts";
import { NAJU_ID_TABLE_V1 } from "../progress/najuIdTable.ts";
import { NAJU_LOCAL } from "../progress/najuLocalIds.ts";
import { OBJECTIVES, type ObjectiveId, type Stage } from "./objectives.ts";
import { toSituationPayload, toSituationRequest } from "./situationCodes.ts";
import type { Situation } from "./situations.ts";

/**
 * auto 턴에 situation 을 싣는가. 운영 백엔드가 아직 situation 을 모르고 모르는 필드를 막는다(extra="forbid" → 422).
 * BE 상황 대사(#54)가 운영에 배포될 때까지 꺼 둔다(계약 §11-7). 꺼진 동안은 v0.4.7 방식(situation 없는 auto 턴)을 구역에 들어설 때만 보낸다.
 */
export const SEND_SITUATION = false;

// ── 나주 ID 대응표 v1.1(docs/naju/나주_ID대응표_v1_1108.md §5) ──

/**
 * 로컬 목표 → 서버 퍼즐 ID(Hint API). 공식 ID 그대로. 이름만 잇는 표다 — 그 판에 정식 힌트가 있는지는 HINTED_PUZZLES 가 정한다
 * (이 표만 보고 [F] 정식 힌트를 열면 힌트 없는 퍼즐에서도 「남은 힌트가 하나 줄어요」를 묻고 404 로 끝난다)
 */
export const HINT_PUZZLE_IDS: Partial<Record<ObjectiveId, string>> = {
  P01: "P01",
  P02: "P02",
  "P02-2": "P02-2",
  P03: "P03",
  P05: "P05",
  P07: "P07",
  P08: "P08",
  P09: "P09",
  P10: "P10",
  P11: "P11",
  P12: "P12",
  P13: "P13",
  "P13-2": "P13-2",
};
/**
 * 게시 판(`case_id@content_version`)마다 정식 힌트(server.json `puzzles[].hints`)가 실제로 있는 서버 퍼즐 ID.
 * 표에 없는 판 · 세션이 준비되지 않은 때는 0개다 — 서버 힌트 정보 없이 지원 여부를 짐작하지 않는다.
 * 새 판에 힌트를 넣으면 그 판의 줄을 더한다(예: "naju-angam-01@2": ["P01", "P03"]). 힌트 1 · 2단계 · 다시 보기 흐름은 그대로 쓴다.
 */
export const HINTED_PUZZLES: Readonly<Record<string, readonly string[]>> = {
  // 나주 v1(sha256:cf804b17…): 서버 퍼즐 P01 · P03 · P07 · P09 모두 hints 가 없다 — 정식 힌트 0개(11/9 확인)
  "naju-angam-01@1": [],
};

/** 지금 판에서 정식 힌트를 열 수 있는 서버 퍼즐 ID. 판을 모르거나 그 판에 힌트가 없으면 null — Hint API 를 부르지 않는다 */
export function hintedPuzzleIdOf(
  objective: ObjectiveId,
  content: { caseId: string; contentVersion: number } | null,
  table: Readonly<Record<string, readonly string[]>> = HINTED_PUZZLES,
): string | null {
  if (!content) return null;
  const puzzleId = HINT_PUZZLE_IDS[objective];
  const hinted = table[`${content.caseId}@${content.contentVersion}`];
  return puzzleId && hinted?.includes(puzzleId) ? puzzleId : null;
}

/** FE 구역 → 서버 Zone ID(잡담 QUIET 의 zone_id). 물굴은 잡담을 보내지 않는다(§10-5) */
export const SITUATION_ZONE_IDS: Partial<Record<Stage, string>> = {
  dock: "ZONE_FERRY_TERRACE",
  rock: "ZONE_GRAVEL_BEACH",
  ridge: "ZONE_JINBU_RIDGE",
};
/**
 * 서버 퍼즐 → 대표 Object(대응표 v1.1 §5) — 퍼즐 폴링의 focus_object_id. 진행 동기화가 쓰는 표(NAJU_LOCAL · NAJU_ID_TABLE_V1)
 * 그대로 뽑는다 — 대응표에 없는 로컬 ID 는 서버로 보내지 않는다(대응표 기존 규칙). content_version 1 은 서버에 연결된
 * P01 · P03 · P07 · P09 뿐이고, 다음 판에서 퍼즐을 연결해 그 표에 더하면 여기도 따라 늘어난다.
 */
export const PUZZLE_FOCUS_IDS: Partial<Record<ObjectiveId, string>> = Object.fromEntries(
  Object.entries(NAJU_LOCAL.objects).flatMap(([key, local]) => {
    const runtime = NAJU_ID_TABLE_V1.objects[local];
    return key in OBJECTIVES && runtime ? [[key, runtime]] : [];
  }),
);
/** 판정 없는 걸음 → 대표 Object(상황 대사 focus_object_id, 대응표 §4). 걸음 상황을 보낼 때 함께 싣는다 */
export const STEP_FOCUS_IDS: Partial<Record<ObjectiveId, string>> = {
  S1_FIRE: "OBJ_S1_BONFIRE_0",
  S1_SMOKE: "OBJ_S1_SMOKE_ARROW",
  S2_BOTTLE: "OBJ_S1_MAKGEOLLI_BOTTLE",
  S2_OFFER: "OBJ_S1_RITUAL_TABLE",
  S2_STONES: "OBJ_S1_FLOAT_STONES",
  S2_ENTER: "OBJ_S1_RIVER_ENTRANCE",
  C_JAR: "OBJ_S1_CAVE_JAR",
  C_SOCKET: "OBJ_S1_CAVE_SOCKET",
  S3_GO: "OBJ_S2_RIDGE_PATH",
  S3_SCALE: "OBJ_S2_TEAR_FOSSIL",
  S3_KEY: "OBJ_S2_LOCKED_BOX",
  S3_RIFT: "OBJ_S2_TIME_RIFT",
};

/** 동행 서버 대화 중 다리가 쓰는 것(companionDialog) */
export interface CompanionDialogPort {
  getState(): DialogState;
  subscribe(listener: () => void): () => unknown;
  acceptOffer(): Promise<boolean>;
  autoTurn(situation?: NpcSituation, focusObjectId?: string, options?: { quiet?: boolean }): Promise<boolean>;
  requestPuzzleHint(puzzleId: string): Promise<boolean>;
}

export type OpenHintRequest = {
  lead: string | null;
  lineId?: string;
  balance: number | null;
  /** 물음이 실제로 화면에 떴다 — 받은 개입이 줄에서 기다리는 동안(폴링을 쉰다)이 끝난다. 쿨다운 · 횟수는 받은 순간에 이미 셌다 */
  onShow?: () => void;
  /** 화면에 뜬 물음에 「아니요」를 골랐다 — 거절 쿨다운(대답 없이 물러남 · 버려짐은 거절이 아니다) */
  onDecline?: () => void;
};

/** 서버 대사가 대화창 줄에서 이만큼 넘게 기다렸으면 버린다 — 연출에 막혀 때를 놓친 말이 늦게 나오지 않게 */
export const SERVER_LINE_TTL_MS = 10_000;

/** 서버가 준 한 줄 → 대화창의 말. 글은 손대지 않는다(승인 원문 = 화면 문장, §8-7) */
export function toSpeech(line: DialogLine): Speech {
  if (line.kind === "hint")
    return { kind: "hint", text: line.text, topic: `힌트 ${line.level}/2${line.isReview ? " · 다시 보기" : ""}` };
  if (line.kind === "notice") return { kind: "notice", text: line.text };
  return { kind: "line", text: line.text, lineId: line.lineId ?? undefined, ttlMs: SERVER_LINE_TTL_MS };
}

/** 이번에 보낼 auto 턴 — situation 이 null 이면 v0.4.7 방식(상황 없이). focusObjectId 는 걸음 상황 · 퍼즐 폴링일 때만 */
export type AutoTurnPlan = { situation: NpcSituation | null; focusObjectId?: string };

/** 퍼즐 폴링 간격 — 지금 목표가 서버 퍼즐인 동안 이만큼마다 한 번 */
export const PUZZLE_POLL_MS = 60_000;

/** 퍼즐 폴링에 쓰는 지금 형편(relay 가 넣는다) */
export interface PuzzleSight {
  /** 지금 목표 — 상황 판정(gameObserver)이 본 것 */
  objective: ObjectiveId | null;
  /** 지금 시각(ms) */
  now: number;
  /** 폴링을 보내도 되나 — 서버 응답을 기다리는 중 · 방금 제안을 물은 뒤 쉬는 중이면 거짓 */
  canPoll: boolean;
}

/**
 * auto 턴을 언제 · 무엇으로 보낼지 — 0.5초마다 상황 감지 뒤에 부른다. 상황은 「생긴 순간」 하나만 오므로 그대로 하나씩 보낸다.
 *   sendSituation 꺼짐  상황은 보내지 않고, 구역 코드가 바뀐 순간에만(첫 구역 제외) 상황 없는 턴 — 세진 님 CompanionNpc 의 동작 그대로
 *   sendSituation 켜짐  상황이 있으면 그 코드로(서버 판정 퍼즐의 실수 · 진전 없음 · 풀림은 toSituationPayload 가 null — 안 보낸다),
 *                       없고 구역에 막 들어섰으면 상황 없는 턴
 *   표시할 수 없는 때(canDisplay 거짓) 상황 · 구역 진입은 버린다 — 구역은 기억만 해 두어 나중에 「막 들어섰다」로 보내지 않는다(§11-2)
 *   퍼즐 폴링           지금 목표가 서버 퍼즐(puzzleFocusOf 가 대표 Object 를 줌)이면, 그 목표가 된 때부터 pollMs 마다 상황 없이
 *                       focus_object_id 만 실은 턴. 표시할 수 없거나 · 응답 대기 중이거나 · 쉬는 중(canPoll 거짓)이면 보내지 않고
 *                       때가 지난 채 기다렸다가 그런 때가 풀리면 보낸다. 목표가 바뀌면 처음부터 센다. 한 번에 턴 하나 —
 *                       상황 · 구역 진입이 먼저다
 */
export function createAutoTurnPlanner(options: {
  sendSituation: boolean;
  zoneIdOf?: (stage: Stage) => string | null;
  focusIdOf?: (objective: ObjectiveId) => string | null;
  /** 서버 퍼즐이면 그 대표 Object, 아니면 null — 퍼즐 폴링 대상 */
  puzzleFocusOf?: (objective: ObjectiveId) => string | null;
  pollMs?: number;
}) {
  const pollMs = options.pollMs ?? PUZZLE_POLL_MS;
  let lastZone: string | null = null;
  /** 폴링을 세는 목표와 그 기준 시각(목표가 된 때 · 마지막으로 보낸 때) */
  let pollObjective: ObjectiveId | null = null;
  let pollFrom = 0;
  return {
    next(
      situation: Situation | null,
      zoneCode: string | null,
      canDisplay = true,
      puzzle: PuzzleSight | null = null,
    ): AutoTurnPlan | null {
      const isZoneEntry = zoneCode !== null && lastZone !== null && zoneCode !== lastZone;
      if (zoneCode !== null) lastZone = zoneCode;
      if (puzzle && puzzle.objective !== pollObjective) {
        pollObjective = puzzle.objective;
        pollFrom = puzzle.now;
      }
      if (!canDisplay) return null;
      const payload = options.sendSituation && situation ? toSituationPayload(situation) : null;
      if (payload && situation) {
        const plan: AutoTurnPlan = { situation: toSituationRequest(payload, options.zoneIdOf) };
        const focus = situation.objective ? (options.focusIdOf?.(situation.objective) ?? null) : null;
        if (focus) plan.focusObjectId = focus;
        return plan;
      }
      if (isZoneEntry) return { situation: null };
      const focus = puzzle?.objective ? (options.puzzleFocusOf?.(puzzle.objective) ?? null) : null;
      if (!puzzle || !focus || !puzzle.canPoll || puzzle.now - pollFrom < pollMs) return null;
      pollFrom = puzzle.now;
      return { situation: null, focusObjectId: focus };
    },
  };
}

/**
 * 서버가 개입한 뒤(넛지 대사 · 힌트 제안) 퍼즐 폴링을 쉬는 시간과 퍼즐당 상한 — BE v0.4.7 기본값(RuleConfig: cooldown 180초 ·
 * decline_cooldown 600초 · max_per_puzzle 2)과 같은 값.
 * BE 는 「같은 PlaySession · 같은 퍼즐에서 서버가 돌려준 넛지(line_id)」를 쓴 것으로 세고, 후보를 다 쓰면 reply: null 을 준다
 * (세진 11/10, 동시 요청은 세션 잠금). FE 도 화면에 뜬 때가 아니라 받은 때를 기준으로 맞춘다 — 받은 순간 180초 쉬고 퍼즐당 횟수에 든다.
 * 600초는 화면에 뜬 물음에 「아니요」를 골랐을 때만. reply: null 은 개입이 아니다(띄우지도 쉬지도 세지도 않는다).
 * 퍼즐당 횟수는 이 탭(앱 한 번)에서만 센다.
 */
export const OFFER_POLL_PAUSE_MS = { shown: 180_000, declined: 600_000 };
export const POLL_MAX_PER_PUZZLE = 2;

export interface CompanionBridgeOptions {
  dialog: CompanionDialogPort;
  /** 대화창에 올린다 */
  say: (speech: Speech) => void;
  /** 힌트를 열지 Y/N 으로 묻는다(director.askOpenHint) */
  askOpenHint: (request: OpenHintRequest) => Promise<boolean>;
  sendSituation?: boolean;
  serverPuzzleIdOf?: (objective: ObjectiveId) => string | null;
  zoneIdOf?: (stage: Stage) => string | null;
  /** 걸음 → 대표 Object(STEP_FOCUS_IDS) */
  focusIdOf?: (objective: ObjectiveId) => string | null;
  /**
   * 서버 판정 퍼즐 → 대표 Object(PUZZLE_FOCUS_IDS) — 퍼즐 폴링 대상. 서버 판정 퍼즐(OBJECTIVES[…].puzzleId)이 아니거나 대응표에
   * 대표 Object 가 없으면 null.
   * 정식 힌트 유무(serverPuzzleIdOf)와 묶지 않는다 — 힌트 없는 판에서도 자동 개입(넛지)은 BE 가 한다
   */
  puzzleFocusIdOf?: (objective: ObjectiveId) => string | null;
  /** 정식 힌트 2단계(정답)가 처음 왔다(다시 보기 빼고) — 도움 별의 「정답 확인」(progress/helpLog, 미르 11/11) */
  onAnswerSeen?: () => void;
  /**
   * [F] 「힌트를 주세요」로 청한 정식 힌트 글이 실제로 왔다(다시 보기 빼고) — 도움 별의 「직접 청한 도움」.
   * 잔액 없음 · 연결 오류처럼 힌트를 못 받았으면 부르지 않는다(미르 11/11 「알려 준 것을 받았을 때 차감」)
   */
  onRequestedHint?: () => void;
  /** 지금 시각(ms) — 기본 Date.now(검사에서 바꿔 끼운다) */
  now?: () => number;
  /** 상태 변화를 한 번에 모아 본다 — 기본은 마이크로태스크(검사에서 바꿔 끼운다) */
  schedule?: (run: () => void) => void;
  /**
   * 플레이어가 바쁜가(물건을 살피는 중 · 집중 퍼즐 단계) — 다리가 보낸 auto 턴의 대사(먼저 거는 말)가 그때 도착하면 띄우지 않고 버린다.
   * 받은 것으로는 센다(쉬기 · 퍼즐당 횟수 — BE 가 돌려준 것을 센다). 힌트 제안(Y/N)은 버리지 않는다(미르 11/11)
   */
  isBusy?: () => boolean;
}

export function createCompanionBridge(options: CompanionBridgeOptions) {
  const { dialog } = options;
  const schedule = options.schedule ?? ((run) => queueMicrotask(run));
  const serverPuzzleIdOf = options.serverPuzzleIdOf ?? (() => null);
  const now = options.now ?? (() => Date.now());
  const planner = createAutoTurnPlanner({
    sendSituation: options.sendSituation ?? false,
    zoneIdOf: options.zoneIdOf,
    focusIdOf: options.focusIdOf,
    // 폴링 대상은 서버 퍼즐(공식 ID 가 있는 것)이다 — 정식 힌트가 있는지(serverPuzzleIdOf, HINTED_PUZZLES)와는 따로.
    // 힌트가 없는 판(나주 v1)에서도 BE 퍼즐 자동 개입(넛지 대사)은 돈다
    puzzleFocusOf: (objective) => options.puzzleFocusIdOf?.(objective) ?? null,
  });
  /** 서버가 개입한 뒤 퍼즐 폴링을 쉬는 끝 시각(OFFER_POLL_PAUSE_MS) */
  let pollPausedUntil = 0;
  const pausePolling = (ms: number) => {
    pollPausedUntil = Math.max(pollPausedUntil, now() + ms);
  };
  /** 응답을 기다리는 퍼즐 폴링의 목표 — 그 응답이 개입(넛지 · 제안)이면 그 퍼즐 몫으로 센다 */
  let pollingFor: ObjectiveId | null = null;
  /** 퍼즐마다 폴링으로 받은 개입 수(POLL_MAX_PER_PUZZLE) — 화면에 떴는지와 상관없이 받은 것 */
  const interventions = new Map<ObjectiveId, number>();
  /** 개입을 받은 순간 — 쿨다운을 걸고, 폴링 응답이면 그 퍼즐 몫으로 센다(BE 가 돌려준 것을 센다, 세진 11/10) */
  const charge = (objective: ObjectiveId | null) => {
    pausePolling(OFFER_POLL_PAUSE_MS.shown);
    if (objective) interventions.set(objective, (interventions.get(objective) ?? 0) + 1);
  };
  /**
   * 받았지만 아직 화면에 안 뜬 개입 → 그 끝 시각(대사는 줄의 수명 SERVER_LINE_TTL_MS, 물음은 대답 · 버려짐까지 Infinity).
   * 하나라도 있으면 퍼즐 폴링을 보내지 않는다 — 뜨면(onShow) · 버려지면(물음 대답 없음, 대사는 수명이 다하면) 빠진다
   */
  const unshown = new Map<object, number>();
  const hasUnshown = (time: number) => {
    for (const [token, until] of unshown) if (time > until) unshown.delete(token);
    return unshown.size > 0;
  };

  // 다리를 놓기 전에 이미 있던 말 · 제안은 다시 띄우지 않는다
  let seenLine: DialogLine | null = dialog.getState().line;
  /** [F] 로 청한 정식 힌트를 기다리는 중 — 결과(힌트 글 · 실패 문구)가 오면 내린다 */
  let isHintRequested = false;
  let seenOffer: HintOffer | null = dialog.getState().offer;
  let isScheduled = false;
  /** 다리가 보낸 auto 턴(구역 진입 · 상황 · 퍼즐 폴링)의 응답을 기다리는 중 — 그 응답 대사는 플레이어가 청하지 않은 말이다 */
  let isAutoPending = false;
  /** auto 턴을 보낸다 — 실제로 보냈을 때만(대기가 새로 생김) 기다리는 중으로 적는다. 플레이어 말의 응답을 기다리던 중이면 보내지지 않는다(Codex 리뷰) */
  const sendAuto = (send: () => void) => {
    const wasWaiting = dialog.getState().waiting !== null;
    send();
    if (!wasWaiting && dialog.getState().waiting !== null) isAutoPending = true;
  };

  /**
   * 서버 응답 하나는 제안(offer)을 먼저, 대사(line)를 뒤에 따로 알린다(applyTurn). 한 번에 모아 봐야
   * 같이 온 대사를 물음 위에 붙일 수 있다 — 따로 띄우면 더 급한 물음이 그 대사를 밀어낸다.
   */
  function flush() {
    isScheduled = false;
    const { line, offer, hintBalance } = dialog.getState();
    const freshLine = line && line !== seenLine ? line : null;
    seenLine = line;
    if (freshLine?.kind === "hint" && freshLine.level === 2 && !freshLine.isReview) options.onAnswerSeen?.();
    // [F] 로 청한 힌트의 결과 — 힌트 글이면 센다, 실패 문구면 그냥 끝
    if (isHintRequested && freshLine && freshLine.kind !== "npc") {
      isHintRequested = false;
      if (freshLine.kind === "hint" && !freshLine.isReview) options.onRequestedHint?.();
    }
    // 서버가 권한 제안(ref)만 묻는다. 정식 힌트 다음 단계(puzzle)는 [F] 「힌트를 주세요」가 연다
    const freshOffer = offer?.via === "ref" && offer !== seenOffer ? offer : null;
    seenOffer = offer;
    // 서버의 개입(승인 넛지 대사 · 힌트 제안)을 받았다 — 받은 순간 쿨다운만큼 폴링을 쉬고, 폴링 응답이면 그 퍼즐 몫으로 센다.
    // 창 · 컷신 때문에 줄에서 기다리다 버려져도 이미 센 것이다(BE 가 돌려준 것을 센다, 세진 11/10).
    // reply: null(후보를 다 씀)이면 line 이 새로 안 생기므로 개입이 아니다 — 띄우지도 쉬지도 세지도 않는다
    const isIntervention = freshOffer !== null || freshLine?.kind === "npc";
    if (isIntervention) charge(pollingFor);
    if (isIntervention || dialog.getState().waiting === null) pollingFor = null;
    const isUnasked = isAutoPending;
    if (dialog.getState().waiting === null) isAutoPending = false;
    if (!freshOffer) {
      if (!freshLine) return;
      if (freshLine.kind !== "npc") return options.say(toSpeech(freshLine));
      // 청하지 않은 넛지가 바쁠 때 왔으면 띄우지 않는다 — 쌓아 두면 바쁨이 끝난 뒤 몰려 나온다(받은 것으로는 위에서 셌다)
      if (isUnasked && options.isBusy?.()) return;
      // 넛지 대사가 줄에서 기다리는 동안은 폴링을 보내지 않는다 — 뜨면 빠지고, 못 뜨면 줄의 수명이 다할 때 빠진다
      const token = {};
      unshown.set(token, now() + SERVER_LINE_TTL_MS);
      options.say({ ...toSpeech(freshLine), onShow: () => unshown.delete(token) });
      return;
    }
    const lead = freshLine?.kind === "npc" ? freshLine : null;
    if (freshLine && !lead) options.say(toSpeech(freshLine));
    // 물음이 줄에서 기다리는 동안도 폴링을 보내지 않는다 — 뜨거나 · 대답 없이 끝나면(버려짐 포함) 빠진다
    const token = {};
    unshown.set(token, Infinity);
    void options
      .askOpenHint({
        lead: lead?.text ?? null,
        lineId: lead?.lineId ?? undefined,
        balance: hintBalance,
        onShow: () => unshown.delete(token),
        // 화면에 뜬 물음에 「아니요」 — 거절 쿨다운만큼 다시 묻지 않는다(대답 없이 물러남 · 버려짐은 거절이 아니다)
        onDecline: () => pausePolling(OFFER_POLL_PAUSE_MS.declined),
      })
      .then((isYes) => {
        unshown.delete(token);
        // 묻는 사이 제안이 바뀌었으면(세션이 바뀜 · 새 제안) 이 대답으로 열지 않는다
        if (isYes && dialog.getState().offer === freshOffer) void dialog.acceptOffer();
      });
  }

  const unsubscribe = dialog.subscribe(() => {
    if (isScheduled) return;
    isScheduled = true;
    schedule(flush);
  });

  const hintProvider: HintProvider = {
    canOpen(objective) {
      const state = dialog.getState();
      return state.isEnabled && !state.waiting && serverPuzzleIdOf(objective) !== null;
    },
    async open(objective) {
      const puzzleId = serverPuzzleIdOf(objective);
      if (!puzzleId) return false;
      isHintRequested = true;
      const isSent = await dialog.requestPuzzleHint(puzzleId);
      // 보내지 못했으면(세션 없음 · 다른 요청 중) 기다릴 결과도 없다
      if (!isSent) isHintRequested = false;
      return isSent;
    },
  };

  return {
    /**
     * 상황 감지 한 번(0.5초)마다 — 이번에 생긴 상황(없으면 null) · 지금 구역 코드 · 지금 동행 말을 띄울 수 있나(§11-2, 컷신 · 창 ·
     * 대화 중이면 거짓) · 지금 목표(퍼즐 폴링)
     */
    relay(
      situation: Situation | null,
      zoneCode: string | null,
      canDisplay = true,
      objective: ObjectiveId | null = null,
    ) {
      const time = now();
      const state = dialog.getState();
      const isPaused = time < pollPausedUntil;
      const canPoll =
        state.isEnabled &&
        state.waiting === null &&
        !isPaused &&
        !hasUnshown(time) &&
        (objective === null || (interventions.get(objective) ?? 0) < POLL_MAX_PER_PUZZLE);
      const plan = planner.next(situation, zoneCode, canDisplay, { objective, now: time, canPoll });
      if (!plan) return;
      // 상황이 있으면 쿨다운 · 횟수는 BE 가 센다. 보낼 수 없을 때(세션 준비 전 · 대기 중)는 버린다 — 지난 상황을 늦게 보내지 않는다
      if (plan.situation) {
        const { situation, focusObjectId } = plan;
        sendAuto(() => void (focusObjectId ? dialog.autoTurn(situation, focusObjectId) : dialog.autoTurn(situation)));
        return;
      }
      // 퍼즐 폴링 — reply null 이면 아무것도 안 뜨고(line 없음), 제안이면 위 flush 가 Y/N 으로 묻는다. 실패해도 안내 없이
      if (plan.focusObjectId) {
        pollingFor = objective;
        const focusObjectId = plan.focusObjectId;
        sendAuto(() => void dialog.autoTurn(undefined, focusObjectId, { quiet: true }));
        // 보내지 못했으면(세션 준비 전) 그 퍼즐 몫으로 셀 응답도 없다 — 요청은 보내는 순간 대기(waiting)가 된다
        if (dialog.getState().waiting === null) pollingFor = null;
        return;
      }
      // 구역 진입 — 개입을 받고 쉬는 중이면 보내지 않고 버린다(늦게 보내지 않는다). companionDialog 의 간격(autoMinIntervalMs)은
      // 구역 진입끼리만 세서, 넛지 바로 뒤 구역에 들어서면 또 말을 걸었다(세진 11/10)
      if (isPaused) return;
      sendAuto(() => void dialog.autoTurn());
    },
    hintProvider,
    dispose() {
      unsubscribe();
    },
  };
}

export type CompanionBridge = ReturnType<typeof createCompanionBridge>;
