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
  /** 「정답 보기」를 눌러야 보이는 글(밸브 자물쇠 정답 확인하기 — 새 쪽지는 자동으로 펼쳐져 설명에 적으면 바로 보인다) */
  spoiler?: string;
}

interface StoredHint extends Hint {
  acquiredAt: number;
}

const hints: StoredHint[] = [];
const signal = createChangeSignal();

/**
 * 아직 펼쳐 보지 않은 쪽지. 저절로 들어오는 쪽지(튜토리얼 완료 · 캔음료 · 밸브 도움)는 얻은 줄 모르고 지나치기 쉬워
 * 힌트 칩 · 힌트함 목록에 「새 쪽지」 점을 남긴다(미르 11/9 「획득한 사실도 알 수가 없다」, 튜토피드백 09회차).
 * 창을 열기만 해서는 안 지운다 — 힌트함이 그 쪽지를 펼쳐 보인 때만(markHintSeen). 창이 열린 채 새 쪽지가 들어와도 읽던 것은 그대로다.
 */
const unseen = new Set<string>();

const hasHint = (id: string) => hints.some((hint) => hint.id === id);

/** 새로 들어갔으면 true, 이미 있으면 false. */
export function addHint(hint: Hint | null | undefined) {
  if (!hint?.id || hasHint(hint.id)) return false;
  hints.push({ ...hint, acquiredAt: Date.now() });
  unseen.add(hint.id);
  signal.notify();
  return true;
}

export const isHintUnseen = (id: string) => unseen.has(id);
export const hasUnseenHints = () => unseen.size > 0;

/** 힌트함이 그 쪽지를 펼쳐 보였다 — 이미 본 것이면 아무 일도 안 한다 */
export function markHintSeen(id: string) {
  if (!unseen.delete(id)) return;
  signal.notify();
}

/**
 * 힌트함에서 도로 내놓는다([E]). 지우는 게 아니다 — 부르는 쪽이 실물 쪽지도 바닥에 다시 놓는다.
 * 영영 지우면 잘못 누른 사람이 되돌릴 길이 없다(GRD-01).
 */
export function removeHint(id: string) {
  const index = hints.findIndex((hint) => hint.id === id);
  if (index < 0) return null;
  const [removed] = hints.splice(index, 1);
  unseen.delete(id);
  signal.notify();
  return removed ?? null;
}

/**
 * 쪽지들을 힌트함에서 아주 지운다(실물을 되놓지 않는다). 본부실에 들어서면 튜토리얼 공간 쪽지를 정리할 때 쓴다(tutorial/tutorialHints).
 * 지운 개수를 돌려준다.
 */
export function discardHints(ids: readonly string[]) {
  const drop = new Set(ids);
  const before = hints.length;
  for (let i = hints.length - 1; i >= 0; i--) if (drop.has(hints[i].id)) hints.splice(i, 1);
  for (const id of ids) unseen.delete(id);
  if (hints.length !== before) signal.notify();
  return before - hints.length;
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
  unseen.clear();
  signal.notify();
}

// 판(숫자)만 구독한다. 배열을 돌려주면 같은 참조라 바뀐 걸 모른다.
export const useHintBox = (): readonly StoredHint[] => {
  useSyncExternalStore(signal.subscribe, signal.version);
  return hints;
};

exposeDevHook("hintBox", { hints, addHint, clearHints, unseen: () => [...unseen] });
