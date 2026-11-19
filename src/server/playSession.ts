import { useSyncExternalStore } from "react";

import { readStorage, removeStorage, writeStorage } from "@/engine/storage";
import { createChangeSignal } from "@/lib/changeSignal";
import { randomUuid } from "@/lib/uuid";

import {
  BackendError,
  createAnonymousSession,
  createPlaySession,
  getErrorMessage,
  loadCaseBundle,
  loadPlaySession,
  submitInteraction,
  type CaseBundleResponse,
  type InteractionResult,
  type PlaySessionState,
} from "./api";

export const PLAY_CONTRACT = Object.freeze({
  caseId: "case_001",
  zoneId: "ZONE_SECRET_CORRIDOR",
  objectId: "OBJ_FIRE_CABINET_LOCK",
  puzzleId: "PUZZLE_FIRE_CABINET_LOCK",
  unlockedFlag: "fire_cabinet_unlocked",
});

type PlayPhase =
  | "idle"
  | "starting"
  | "restoring"
  | "restored"
  | "restoreFailed"
  | "creating"
  | "ready"
  | "prepareFailed"
  | "judging"
  | "correct"
  | "wrong"
  | "requestFailed";

/** 개발용 상태판에 그대로 보이는 글자 */
export const PLAY_PHASE_LABELS: Record<PlayPhase, string> = {
  idle: "대기",
  starting: "시작 중",
  restoring: "복원 중",
  restored: "복원됨",
  restoreFailed: "복원 실패",
  creating: "신규 생성",
  ready: "준비됨",
  prepareFailed: "준비 실패",
  judging: "판정 중",
  correct: "정답",
  wrong: "오답",
  requestFailed: "요청 실패",
};

/** 저장 상태가 어디서 왔나 — "restored" 일 때만 월드를 소리·연출 없이 되살린다. */
type PlayStateSource = "restored" | "new" | "interaction";

interface PlaySessionStatus {
  phase: PlayPhase;
  caseId: string | null;
  playSessionId: string | null;
  lastResult: InteractionResult | null;
  savedState: PlaySessionState | null;
  stateSource: PlayStateSource | null;
  error: string | null;
}

/** 새로고침해도 같은 플레이를 이어 가도록 남겨 두는 게스트 식별자 */
interface GuestPlayRecord {
  anonymousSessionId: string | null;
  playSessionId: string | null;
  caseId: string;
}

const GUEST_PLAY_KEY = "kgeseo.guest-play.v1";

let status: PlaySessionStatus = {
  phase: "idle",
  caseId: null,
  playSessionId: null,
  lastResult: null,
  savedState: null,
  stateSource: null,
  error: null,
};
let starting: Promise<string> | null = null;
let startingCaseId: string | null = null;
let submitting: Promise<boolean> | null = null;
const signal = createChangeSignal();
const subscribe = signal.subscribe;

const update = (patch: Partial<PlaySessionStatus>) => {
  status = { ...status, ...patch };
  signal.notify();
};

export const usePlaySession = () => useSyncExternalStore(subscribe, () => status);

const isPuzzleCompleted = (puzzleId: string) =>
  !!puzzleId && status.savedState?.completed_puzzle_ids.includes(puzzleId) === true;
const readPlayFlag = (flagId: string) => (flagId ? status.savedState?.flags[flagId] : undefined);

export const usePuzzleCompleted = (puzzleId: string) =>
  useSyncExternalStore(subscribe, () => isPuzzleCompleted(puzzleId));
export const usePlayFlag = (flagId: string) => useSyncExternalStore(subscribe, () => readPlayFlag(flagId));
export const usePlayStateSource = () => useSyncExternalStore(subscribe, () => status.stateSource);

const errorStatus = (error: unknown) => (error instanceof BackendError ? error.status : null);
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isNullableId = (value: unknown) => value === null || isNonEmptyString(value);

function readGuestPlay(): GuestPlayRecord | null {
  try {
    const value: unknown = JSON.parse(readStorage(GUEST_PLAY_KEY) || "null");
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !("caseId" in value) ||
      !isNonEmptyString(value.caseId) ||
      !("anonymousSessionId" in value) ||
      !isNullableId(value.anonymousSessionId) ||
      !("playSessionId" in value) ||
      !isNullableId(value.playSessionId)
    ) {
      if (value !== null) removeStorage(GUEST_PLAY_KEY);
      return null;
    }
    return value as GuestPlayRecord;
  } catch {
    removeStorage(GUEST_PLAY_KEY);
    return null;
  }
}

/** 저장 실패가 플레이 시작까지 막지는 않는다. */
function writeGuestPlay(record: GuestPlayRecord) {
  writeStorage(GUEST_PLAY_KEY, JSON.stringify(record));
}

function clearPlayId(record: GuestPlayRecord | null, caseId: string): GuestPlayRecord {
  const next = { anonymousSessionId: record?.anonymousSessionId ?? null, playSessionId: null, caseId };
  writeGuestPlay(next);
  return next;
}

function clearAnonymousId(caseId: string): GuestPlayRecord {
  const next = { anonymousSessionId: null, playSessionId: null, caseId };
  writeGuestPlay(next);
  return next;
}

function assertBundle(bundle: CaseBundleResponse, caseId: string) {
  if (bundle.data.case_id !== caseId) {
    throw new Error(`${caseId} bundle의 case_id가 일치하지 않습니다.`);
  }
  if (caseId !== PLAY_CONTRACT.caseId) return;

  const zone = bundle.data.zones.find((item) => item.zone_id === PLAY_CONTRACT.zoneId);
  const object = zone?.objects.find((item) => item.object_id === PLAY_CONTRACT.objectId);
  if (bundle.data.entry_zone_id !== PLAY_CONTRACT.zoneId || object?.interaction?.type !== "input") {
    throw new Error("case_001 bundle에 소화전 자물쇠 계약이 없습니다.");
  }
}

/**
 * 게스트 쿠키를 먼저 받는다(계약 v0.4.16 §10-7). 플레이 API 는 쿠키로 주인을 가리므로 조회·생성보다 앞선다.
 * 쿠키가 살아 있으면 서버가 같은 익명 세션을 돌려주고, 로그인 중이면 호환용 익명 세션을 새로 준다(권한 아님).
 * 다른 케이스의 플레이 ID 는 이어 쓰지 않는다.
 */
async function issueAnonymousSession(caseId: string, record: GuestPlayRecord | null) {
  const anonymous = await createAnonymousSession();
  const playSessionId = record?.caseId === caseId ? record.playSessionId : null;
  const next = { anonymousSessionId: anonymous.data.anonymous_session_id, playSessionId, caseId };
  writeGuestPlay(next);
  return next;
}

/**
 * 방금 받은 익명 세션으로 플레이를 연다. 익명 세션이 그새 없어졌거나 만료됐을 때(404·410 Anonymous …)만 한 번 다시 받는다.
 * 「Case not found.」 같은 다른 404 는 다시 받아도 같아서 그대로 실패로 낸다.
 */
async function createFreshPlaySession(caseId: string, anonymousSessionId: string) {
  update({ phase: "creating", error: null });
  try {
    return { anonymousSessionId, play: await createPlaySession(anonymousSessionId, caseId) };
  } catch (error) {
    const code = errorStatus(error);
    const isAnonymousGone =
      (code === 404 || code === 410) && error instanceof BackendError && error.detail.startsWith("Anonymous");
    if (!isAnonymousGone) throw error;
    clearAnonymousId(caseId);
  }

  const renewed = await issueAnonymousSession(caseId, null);
  return {
    anonymousSessionId: renewed.anonymousSessionId,
    play: await createPlaySession(renewed.anonymousSessionId, caseId),
  };
}

/**
 * 지난 회차를 이어 쓰지 않는다 — 튜토리얼을 처음부터 할 때(save/resumeStart). 다음 판정 때 서버에 새 회차를 연다(빈 진행 · 처음 힌트 잔액).
 * 이미 푼 회차를 이어 쓰면 서버가 답을 보기 전에 「이미 완료」를 돌려줘 아무 답이나 열렸다(미르 11/9 · 11/10).
 * 게스트 쿠키(익명 세션)는 그대로 둔다. 새 회차를 못 열면 판정하는 쪽이 지금처럼 그 자리 판정으로 대신한다 — 지난 회차로 돌아가지 않는다.
 * 플레이를 시작하기 전(첫 화면을 그리기 전)에 부른다 — 오가는 요청을 되돌리지는 않는다.
 */
export function forgetPlaySession(caseId: string = PLAY_CONTRACT.caseId): void {
  const record = readGuestPlay();
  if (record?.caseId === caseId && record.playSessionId) clearPlayId(record, caseId);
  if (status.playSessionId || status.caseId === caseId)
    update({
      phase: "idle",
      caseId: null,
      playSessionId: null,
      lastResult: null,
      savedState: null,
      stateSource: null,
      error: null,
    });
}

export function startPlaySession(caseId: string = PLAY_CONTRACT.caseId): Promise<string> {
  if (!isNonEmptyString(caseId)) return Promise.reject(new Error("caseId가 필요합니다."));
  if (status.playSessionId && status.caseId === caseId) return Promise.resolve(status.playSessionId);
  if (starting) {
    if (startingCaseId === caseId) return starting;
    return starting.then(() => startPlaySession(caseId));
  }

  update({ phase: "starting", caseId, error: null });
  let failedPhase: PlayPhase = "prepareFailed";
  startingCaseId = caseId;
  starting = (async () => {
    const issued = await issueAnonymousSession(caseId, readGuestPlay());
    if (issued.playSessionId) {
      failedPhase = "restoreFailed";
      update({ phase: "restoring", error: null });
      try {
        const play = await loadPlaySession(issued.playSessionId);
        if (play.data.case_id === caseId && play.data.completed_at === null) {
          const bundle = await loadCaseBundle(caseId);
          assertBundle(bundle, caseId);
          update({
            phase: "restored",
            caseId,
            playSessionId: play.data.play_session_id,
            savedState: play.data.state,
            stateSource: "restored",
            error: null,
          });
          return play.data.play_session_id;
        }
        clearPlayId(issued, caseId);
      } catch (error) {
        // 남의 세션 · 없는 세션 · 소유자 없는 옛 세션은 모두 404 다(#47) — 새로 연다
        if (errorStatus(error) !== 404) throw error;
        clearPlayId(issued, caseId);
      }
    }

    failedPhase = "prepareFailed";
    const bundle = await loadCaseBundle(caseId);
    assertBundle(bundle, caseId);
    const { anonymousSessionId, play } = await createFreshPlaySession(caseId, issued.anonymousSessionId);
    writeGuestPlay({ anonymousSessionId, playSessionId: play.data.play_session_id, caseId });
    update({
      phase: "ready",
      caseId,
      playSessionId: play.data.play_session_id,
      savedState: play.data.state,
      stateSource: "new",
      error: null,
    });
    return play.data.play_session_id;
  })()
    .catch((error: unknown) => {
      update({ phase: failedPhase, error: getErrorMessage(error) });
      throw error;
    })
    .finally(() => {
      starting = null;
      startingCaseId = null;
    });

  return starting;
}

/** 소화전 자물쇠 답을 서버 판정기에 낸다. 번호 자물쇠의 외부 제출 함수로 넘긴다. */
export function submitFireCabinetLock(answer: string): Promise<boolean> {
  if (submitting) return submitting;

  submitting = (async () => {
    const playSessionId = await startPlaySession();
    update({ phase: "judging", error: null });
    const result = await submitInteraction(playSessionId, {
      client_event_id: randomUuid(),
      client_timestamp: new Date().toISOString(),
      zone_id: PLAY_CONTRACT.zoneId,
      action: "input",
      target_type: "object",
      target_id: PLAY_CONTRACT.objectId,
      payload: { answer },
    });

    if (result.result_type === "correct" || result.result_type === "already_completed") {
      const persisted = await loadPlaySession(playSessionId);
      update({
        phase: "correct",
        lastResult: result,
        savedState: persisted.data.state,
        stateSource: "interaction",
        error: null,
      });
      return true;
    }

    update({ phase: "wrong", lastResult: result, error: null });
    return false;
  })()
    .catch((error: unknown) => {
      update({ phase: "requestFailed", error: getErrorMessage(error) });
      throw error;
    })
    .finally(() => {
      submitting = null;
    });

  return submitting;
}
