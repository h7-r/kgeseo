/**
 * 세진 님 동행 서버 대화(companion/companionDialog)와 대화창(dialogue)을 잇는 다리 — 화면은 대화창 한 벌이다(계약 v0.4.16 §10).
 *
 *   서버가 준 말    companionDialog 의 line(승인 대사 · 힌트 · 한국어 알림)이 새로 생기면 대화창에 그대로 올린다.
 *                   reply 가 null 이면 line 이 안 생기므로 아무것도 띄우지 않는다. 영문 detail 은 companionDialog 가 이미 걸렀다(DIALOG_TEXT).
 *   힌트 제안       suggest_hint(offer via ref)가 오면 Y/N 으로 묻고 「네」일 때만 acceptOffer — 동행을 겨눈 E 꾹을 대신한다(§10-2).
 *   auto 턴         상황 감지(situations)가 낸 상황 · 구역 진입을 여기 한 길로만 보낸다(createAutoTurnPlanner).
 *                   표시할 수 없을 때(연출 · 창 · 장면 인물 대화 · 동행 물음 · 첫 소개)는 보내지 않고 버린다 — 늦게 보내지도 않는다(계약 §11-2).
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
import type { ObjectiveId, Stage } from "./objectives.ts";
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
  autoTurn(situation?: NpcSituation, focusObjectId?: string): Promise<boolean>;
  requestPuzzleHint(puzzleId: string): Promise<boolean>;
}

export type OpenHintRequest = { lead: string | null; lineId?: string; balance: number | null };

/** 서버 대사가 대화창 줄에서 이만큼 넘게 기다렸으면 버린다 — 연출에 막혀 때를 놓친 말이 늦게 나오지 않게 */
const SERVER_LINE_TTL_MS = 10_000;

/** 서버가 준 한 줄 → 대화창의 말. 글은 손대지 않는다(승인 원문 = 화면 문장, §8-7) */
export function toSpeech(line: DialogLine): Speech {
  if (line.kind === "hint")
    return { kind: "hint", text: line.text, topic: `힌트 ${line.level}/2${line.isReview ? " · 다시 보기" : ""}` };
  if (line.kind === "notice") return { kind: "notice", text: line.text };
  return { kind: "line", text: line.text, lineId: line.lineId ?? undefined, ttlMs: SERVER_LINE_TTL_MS };
}

/** 이번에 보낼 auto 턴 — situation 이 null 이면 v0.4.7 방식(상황 없이). focusObjectId 는 걸음 상황일 때만 */
export type AutoTurnPlan = { situation: NpcSituation | null; focusObjectId?: string };

/**
 * auto 턴을 언제 · 무엇으로 보낼지 — 0.5초마다 상황 감지 뒤에 부른다. 상황은 「생긴 순간」 하나만 오므로 그대로 하나씩 보낸다.
 *   sendSituation 꺼짐  상황은 보내지 않고, 구역 코드가 바뀐 순간에만(첫 구역 제외) 상황 없는 턴 — 세진 님 CompanionNpc 의 동작 그대로
 *   sendSituation 켜짐  상황이 있으면 그 코드로(서버 판정 퍼즐의 실수 · 진전 없음 · 풀림은 toSituationPayload 가 null — 안 보낸다),
 *                       없고 구역에 막 들어섰으면 상황 없는 턴
 *   표시할 수 없는 때(canDisplay 거짓) 상황 · 구역 진입은 버린다 — 구역은 기억만 해 두어 나중에 「막 들어섰다」로 보내지 않는다(§11-2)
 */
export function createAutoTurnPlanner(options: {
  sendSituation: boolean;
  zoneIdOf?: (stage: Stage) => string | null;
  focusIdOf?: (objective: ObjectiveId) => string | null;
}) {
  let lastZone: string | null = null;
  return {
    next(situation: Situation | null, zoneCode: string | null, canDisplay = true): AutoTurnPlan | null {
      const isZoneEntry = zoneCode !== null && lastZone !== null && zoneCode !== lastZone;
      if (zoneCode !== null) lastZone = zoneCode;
      if (!canDisplay) return null;
      const payload = options.sendSituation && situation ? toSituationPayload(situation) : null;
      if (payload && situation) {
        const plan: AutoTurnPlan = { situation: toSituationRequest(payload, options.zoneIdOf) };
        const focus = situation.objective ? (options.focusIdOf?.(situation.objective) ?? null) : null;
        if (focus) plan.focusObjectId = focus;
        return plan;
      }
      return isZoneEntry ? { situation: null } : null;
    },
  };
}

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
  /** 상태 변화를 한 번에 모아 본다 — 기본은 마이크로태스크(검사에서 바꿔 끼운다) */
  schedule?: (run: () => void) => void;
}

export function createCompanionBridge(options: CompanionBridgeOptions) {
  const { dialog } = options;
  const schedule = options.schedule ?? ((run) => queueMicrotask(run));
  const serverPuzzleIdOf = options.serverPuzzleIdOf ?? (() => null);
  const planner = createAutoTurnPlanner({
    sendSituation: options.sendSituation ?? false,
    zoneIdOf: options.zoneIdOf,
    focusIdOf: options.focusIdOf,
  });

  // 다리를 놓기 전에 이미 있던 말 · 제안은 다시 띄우지 않는다
  let seenLine: DialogLine | null = dialog.getState().line;
  let seenOffer: HintOffer | null = dialog.getState().offer;
  let isScheduled = false;

  /**
   * 서버 응답 하나는 제안(offer)을 먼저, 대사(line)를 뒤에 따로 알린다(applyTurn). 한 번에 모아 봐야
   * 같이 온 대사를 물음 위에 붙일 수 있다 — 따로 띄우면 더 급한 물음이 그 대사를 밀어낸다.
   */
  function flush() {
    isScheduled = false;
    const { line, offer, hintBalance } = dialog.getState();
    const freshLine = line && line !== seenLine ? line : null;
    seenLine = line;
    // 서버가 권한 제안(ref)만 묻는다. 정식 힌트 다음 단계(puzzle)는 [F] 「힌트를 주세요」가 연다
    const freshOffer = offer?.via === "ref" && offer !== seenOffer ? offer : null;
    seenOffer = offer;
    if (!freshOffer) {
      if (freshLine) options.say(toSpeech(freshLine));
      return;
    }
    const lead = freshLine?.kind === "npc" ? freshLine : null;
    if (freshLine && !lead) options.say(toSpeech(freshLine));
    void options
      .askOpenHint({ lead: lead?.text ?? null, lineId: lead?.lineId ?? undefined, balance: hintBalance })
      .then((isYes) => {
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
    open(objective) {
      const puzzleId = serverPuzzleIdOf(objective);
      return puzzleId ? dialog.requestPuzzleHint(puzzleId) : Promise.resolve(false);
    },
  };

  return {
    /** 상황 감지 한 번(0.5초)마다 — 이번에 생긴 상황(없으면 null) · 지금 구역 코드 · 지금 동행 말을 띄울 수 있나(§11-2) */
    relay(situation: Situation | null, zoneCode: string | null, canDisplay = true) {
      const plan = planner.next(situation, zoneCode, canDisplay);
      if (!plan) return;
      // 상황이 있으면 쿨다운 · 횟수는 BE 가 센다. 보낼 수 없을 때(세션 준비 전 · 대기 중)는 버린다 — 지난 상황을 늦게 보내지 않는다
      if (!plan.situation) return void dialog.autoTurn();
      void (plan.focusObjectId ? dialog.autoTurn(plan.situation, plan.focusObjectId) : dialog.autoTurn(plan.situation));
    },
    hintProvider,
    dispose() {
      unsubscribe();
    },
  };
}

export type CompanionBridge = ReturnType<typeof createCompanionBridge>;
