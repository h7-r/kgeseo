import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

// 소지품(I)은 들고 쓰는 것, 힌트(H)는 다시 읽는 것이라 따로 둔다.
// 보관하는 순간 실물은 손에서 사라진다.

export interface Hint {
  id: string;
  name: string;
  description?: string;
  /** 캔버스에서 뽑은 data URL */
  image?: string | null;
  /** false 면 바닥에 떨어진 실물이 없어 버릴 수 없다(튜토리얼 첫 쪽지 등). */
  isPhysical?: boolean;
}

interface StoredHint extends Hint {
  acquiredAt: number;
}

const hints: StoredHint[] = [];
const signal = createChangeSignal();

const hasHint = (id: string) => hints.some((hint) => hint.id === id);

/** 새로 들어갔으면 true, 이미 있으면 false. */
export function addHint(hint: Hint | null | undefined) {
  if (!hint?.id || hasHint(hint.id)) return false;
  hints.push({ ...hint, acquiredAt: Date.now() });
  signal.notify();
  return true;
}

/**
 * 힌트함에서 도로 내놓는다([E]). 지우는 게 아니다 — 부르는 쪽이 실물 쪽지도 바닥에 다시 놓는다.
 * 영영 지우면 잘못 누른 사람이 되돌릴 길이 없다(GRD-01).
 */
export function removeHint(id: string) {
  const index = hints.findIndex((hint) => hint.id === id);
  if (index < 0) return null;
  const [removed] = hints.splice(index, 1);
  signal.notify();
  return removed ?? null;
}

// [H] 를 누를 때 왼쪽 표시가 같이 깜빡여야 저기가 힌트함이라는 게 눈에 박힌다.
let flashedAt = 0;
export const getHintFlashTime = () => flashedAt;
export function flashHints() {
  flashedAt = performance.now();
  signal.notify();
}

/** 개발·테스트용 */
function clearHints() {
  hints.length = 0;
  signal.notify();
}

// 판(숫자)만 구독한다. 배열을 돌려주면 같은 참조라 바뀐 걸 모른다.
export const useHintBox = (): readonly StoredHint[] => {
  useSyncExternalStore(signal.subscribe, signal.version);
  return hints;
};

exposeDevHook("hintBox", { hints, addHint, clearHints });
