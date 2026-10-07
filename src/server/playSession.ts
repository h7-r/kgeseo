import { useSyncExternalStore } from "react";

import {
  createAnonymousSession,
  createPlaySession,
  getCaseBundle,
  getPlaySession,
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

export type PlayPhase =
  "idle" | "preparing" | "ready" | "prepareFailed" | "judging" | "correct" | "wrong" | "requestFailed";

/** 개발용 상태판에 그대로 보이는 글자 */
export const PLAY_PHASE_LABELS: Record<PlayPhase, string> = {
  idle: "대기",
  preparing: "세션 준비 중",
  ready: "준비됨",
  prepareFailed: "준비 실패",
  judging: "판정 중",
  correct: "정답",
  wrong: "오답",
  requestFailed: "요청 실패",
};

export interface PlaySessionStatus {
  phase: PlayPhase;
  playSessionId: string | null;
  lastResult: InteractionResult | null;
  savedState: PlaySessionState | null;
  error: string | null;
}

let status: PlaySessionStatus = {
  phase: "idle",
  playSessionId: null,
  lastResult: null,
  savedState: null,
  error: null,
};
let starting: Promise<string> | null = null;
let submitting: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

const update = (patch: Partial<PlaySessionStatus>) => {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const usePlaySession = () => useSyncExternalStore(subscribe, () => status);

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function assertBundle(bundle: CaseBundleResponse) {
  const zone = bundle.data.zones.find((item) => item.zone_id === PLAY_CONTRACT.zoneId);
  const object = zone?.objects.find((item) => item.object_id === PLAY_CONTRACT.objectId);
  if (bundle.data.entry_zone_id !== PLAY_CONTRACT.zoneId || object?.interaction?.type !== "input") {
    throw new Error("case_001 bundle에 소화전 자물쇠 계약이 없습니다.");
  }
}

export function startPlaySession(): Promise<string> {
  if (status.playSessionId) return Promise.resolve(status.playSessionId);
  if (starting) return starting;

  update({ phase: "preparing", error: null });
  starting = (async () => {
    const anonymous = await createAnonymousSession();
    const bundle = await getCaseBundle(PLAY_CONTRACT.caseId);
    assertBundle(bundle);
    const play = await createPlaySession(anonymous.data.anonymous_session_id, PLAY_CONTRACT.caseId);
    update({
      phase: "ready",
      playSessionId: play.data.play_session_id,
      savedState: play.data.state,
      error: null,
    });
    return play.data.play_session_id;
  })().catch((error: unknown) => {
    update({ phase: "prepareFailed", error: errorMessage(error) });
    starting = null;
    throw error;
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
      const persisted = await getPlaySession(playSessionId);
      update({ phase: "correct", lastResult: result, savedState: persisted.data.state, error: null });
      return true;
    }

    update({ phase: "wrong", lastResult: result, error: null });
    return false;
  })()
    .catch((error: unknown) => {
      update({ phase: "requestFailed", error: errorMessage(error) });
      throw error;
    })
    .finally(() => {
      submitting = null;
    });

  return submitting;
}
