import { useSyncExternalStore } from "react";

import { readStorage, removeStorage, writeStorage } from "@/engine/storage";
import { createChangeSignal } from "@/lib/changeSignal";

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

/** 남아 있는 익명 세션이 있으면 그걸로, 서버가 모른다고 하면(404·410) 새로 만들어 플레이를 연다. */
async function createFreshPlaySession(caseId: string, record: GuestPlayRecord | null) {
  let anonymousSessionId = record?.anonymousSessionId ?? null;

  if (anonymousSessionId) {
    update({ phase: "creating", error: null });
    try {
      return { anonymousSessionId, play: await createPlaySession(anonymousSessionId, caseId) };
    } catch (error) {
      const code = errorStatus(error);
      if (code !== 404 && code !== 410) throw error;
      clearAnonymousId(caseId);
    }
  }

  update({ phase: "creating", error: null });
  const anonymous = await createAnonymousSession();
  anonymousSessionId = anonymous.data.anonymous_session_id;
  writeGuestPlay({ anonymousSessionId, playSessionId: null, caseId });

  return { anonymousSessionId, play: await createPlaySession(anonymousSessionId, caseId) };
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
    let record = readGuestPlay();
    if (record?.playSessionId && record.caseId === caseId) {
      failedPhase = "restoreFailed";
      update({ phase: "restoring", error: null });
      try {
        const play = await loadPlaySession(record.playSessionId);
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
        record = clearPlayId(record, caseId);
      } catch (error) {
        if (errorStatus(error) !== 404) throw error;
        record = clearPlayId(record, caseId);
      }
    } else if (record?.playSessionId) {
      record = clearPlayId(record, caseId);
    }

    failedPhase = "prepareFailed";
    const bundle = await loadCaseBundle(caseId);
    assertBundle(bundle, caseId);
    const { anonymousSessionId, play } = await createFreshPlaySession(caseId, record);
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
      client_event_id: crypto.randomUUID(),
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
