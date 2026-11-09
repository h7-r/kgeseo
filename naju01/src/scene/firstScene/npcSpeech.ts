/**
 * 장면 인물(아비사 · 어부 · 동행 소개)이 지금 하는 말 — 화면 아래 대사 상자(NpcSpeechHud)에 이름표와 함께 뜬다.
 * 인물이 말하는 동안 동행 자막은 비켜 준다(CompanionHud) — 두 말이 한 자리에 겹치지 않게(Codex 03회차).
 */
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";

export interface NpcSpeech {
  speaker: string;
  text: string;
  /** 같은 글이 이어 나와도 다시 그리게 */
  key: number;
  /** [E] 로 넘길 수 있다(그 인물을 겨누고) */
  canAdvance: boolean;
  /** 겨누지 않고 넘긴다(E · 터치 ✋) — 화면 고정 중처럼 겨눌 수 없는 연출. 있으면 상자가 「다음」 안내를 띄운다 */
  onNext?: () => void;
}

const signal = createChangeSignal();
let speech: NpcSpeech | null = null;
let nextKey = 1;
/**
 * 지금 대화 차례를 잡은 사람(아비사 · 어부 · 동행 소개). 자막이 비어 있는 첫 줄 전 대기 · 창 때문에 멈춘 동안에도
 * 차례는 잡은 채로 둔다 — 자막 유무(isNpcSpeaking)만 보면 그 틈에 다른 사람이 말을 시작한다(Codex 06회차).
 */
let owner: string | null = null;

/** 차례를 잡는다. 다른 사람이 잡고 있으면 false */
export function claimTalk(id: string): boolean {
  if (owner !== null && owner !== id) return false;
  owner = id;
  return true;
}

/** 차례를 놓는다 — 제 차례일 때만, 제 자막도 함께 내린다 */
export function releaseTalk(id: string) {
  if (owner !== id) return;
  owner = null;
  if (speech) {
    speech = null;
    signal.notify();
  }
}

/** 다른 사람이 차례를 잡고 있다(id 를 주면 그 사람 자신은 빼고) */
export const isTalkTaken = (id?: string) => owner !== null && owner !== id;

/** 자막을 바꾼다 — 차례를 잡은 사람만(by). 차례가 비어 있으면 누구나 */
export function setNpcSpeech(next: Omit<NpcSpeech, "key"> | null, by?: string) {
  if (owner !== null && by !== undefined && owner !== by) return;
  speech = next ? { ...next, key: nextKey++ } : null;
  signal.notify();
}

export const isNpcSpeaking = () => speech !== null;
export const useNpcSpeech = () => useSyncExternalStore(signal.subscribe, () => speech);

/**
 * 대사 상자가 실제로 떠 있나(동행 입력칸이 뜨면 대사가 있어도 내려 둔다) — 터치 화면에서 빠른 칸 · 알림이 상자에 자리를 내준다
 */
const boxSignal = createChangeSignal();
let isBoxShown = false;
export function setSpeechBoxShown(next: boolean) {
  if (isBoxShown === next) return;
  isBoxShown = next;
  boxSignal.notify();
}
export const useSpeechBoxShown = () => useSyncExternalStore(boxSignal.subscribe, () => isBoxShown);
