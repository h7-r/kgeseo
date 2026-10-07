import { useSyncExternalStore } from "react";

import { server, type Progress } from "@/server/api";

import { isCaseSession, SESSIONS, type Session } from "./sessions";

// 세션·진행 상태 상자(USR-110). 백엔드 계약용으로 남겨 두었고 아직 아무 화면도 쓰지 않는다.

export interface GameState {
  session: Session;
  /** 서버가 준 진행 상태. null = 아직 모름 */
  progress: Progress | null;
  /** 조회에 실패하면 게스트 신규로 취급한다(USR-110 예외). */
  fetchFailed: boolean;
  /** 게이트에 막혔을 때 띄울 문구(전역-003) */
  notice: string | null;
}

let state: GameState = {
  session: SESSIONS.boot,
  progress: null,
  fetchFailed: false,
  notice: null,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<GameState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export const gameStateStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set: setState,
};

// 같은 값이면 같은 참조를 돌려줘야 해서 상태를 통째로 하나만 돌려준다.
export const useGameState = () => useSyncExternalStore(gameStateStore.subscribe, gameStateStore.get);

/**
 * 진행 상태로 첫 세션을 정한다(전역-002). 아바타가 없으면 캐릭터 생성, 있으면 로비.
 * 로비의 잠금 여부는 canEnterCase() 가 따로 판단한다.
 */
export function resolveDestination(progress: Progress | null): Session {
  if (!progress || !progress.hasAvatar) return SESSIONS.characterCreation;
  return SESSIONS.lobby;
}

/** 케이스(S6·S7)에 들어갈 수 있는지. 반드시 서버 값 기준이다(전역-003). */
export function canEnterCase(progress: Progress | null) {
  return !!progress?.tutorialDone;
}

export const GATE_MESSAGE = "훈련실을 먼저 마쳐야 사건 현장에 들어갈 수 있습니다.";

export async function boot() {
  try {
    const progress = await server.getProgress();
    setState({ progress, fetchFailed: false, session: resolveDestination(progress) });
  } catch (error) {
    // 막아 세우면 아무것도 못 하므로 새 사람인 셈 치고 캐릭터 생성부터 보낸다.
    console.warn("[진행 상태] 조회 실패 → 게스트 신규로 취급합니다.", error);
    setState({ progress: null, fetchFailed: true, session: SESSIONS.characterCreation });
  }
}

/** 세션은 반드시 여기로 바꾼다. 게이트 검사를 한 곳에만 두어 우회 경로가 생기지 않게. */
export function moveToSession(target: Session) {
  if (isCaseSession(target) && !canEnterCase(state.progress)) {
    setState({ notice: GATE_MESSAGE });
    return false;
  }
  setState({ session: target, notice: null });
  return true;
}

export const dismissNotice = () => setState({ notice: null });

/** 튜토리얼을 마쳤을 때 등 진행 상태를 서버에서 다시 받는다. */
export async function reloadProgress() {
  try {
    const progress = await server.getProgress();
    setState({ progress, fetchFailed: false });
    return progress;
  } catch {
    setState({ fetchFailed: true });
    return null;
  }
}
