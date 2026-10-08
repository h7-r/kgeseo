import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

// 백엔드 계약(USR-051)용으로 남겨 둔 조사 상태. 아직 아무 화면도 쓰지 않는다.
// 캔버스 안 3D 와 캔버스 밖 UI 가 같은 값을 봐야 해서 바깥 상자에 둔다.

/** 판정 상수(S7-015). 1 유닛 ≈ 0.30m */
export const INVESTIGATION_RANGE = {
  // 6 ≈ 1.8m. 멀리서부터 표식이 뜨면 방이 아이콘 밭이 된다(S7-002).
  distance: 6,
  /** 광선을 쏘는 주기(초). 매 프레임은 낭비다. */
  interval: 0.08,
};

export interface InvestigationState {
  /** 지금 조준 중인 물건 id */
  aimedId: string | null;
  /** 조사창에 띄운 물건 id */
  openedId: string | null;
  /** id → 조사한 횟수. 한 번 본 물건은 표식을 약하게 한다(S7-016). */
  history: Record<string, number>;
}

/** 이 모양을 지키면 백엔드 응답을 그대로 꽂을 수 있다. */
export interface InvestigationTarget {
  id: string;
  name: string;
  category?: string;
  description?: string;
  clue?: unknown;
}

let state: InvestigationState = {
  aimedId: null,
  openedId: null,
  history: {},
};

const signal = createChangeSignal();

function setState(patch: Partial<InvestigationState>) {
  state = { ...state, ...patch };
  signal.notify();
}

export const investigationStore = {
  get: () => state,
  subscribe: signal.subscribe,
  set: setState,
};

exposeDevHook("investigation", investigationStore);

// 단순값만 돌려준다. 객체를 새로 만들어 돌려주면 무한 렌더가 된다.
export const useAimedId = () => useSyncExternalStore(investigationStore.subscribe, () => state.aimedId);
export const useOpenedId = () => useSyncExternalStore(investigationStore.subscribe, () => state.openedId);
export const useInvestigationCount = (id: string) =>
  useSyncExternalStore(investigationStore.subscribe, () => state.history[id] || 0);

export const setAimedId = (id: string | null) => {
  if (state.aimedId !== id) setState({ aimedId: id });
};

/** 조사하면 이력을 남긴다(S7-017). */
export function openInvestigation(id: string) {
  const history = { ...state.history };
  history[id] = (history[id] || 0) + 1;
  setState({ openedId: id, aimedId: null, history });
}

export const closeInvestigation = () => setState({ openedId: null });

const targets = new Map<string, InvestigationTarget>();

export function registerTarget(target: InvestigationTarget) {
  targets.set(target.id, target);
}

export function registerTargets(list: InvestigationTarget[]) {
  for (const target of list) registerTarget(target);
}

export const findTarget = (id: string) => targets.get(id) ?? null;
