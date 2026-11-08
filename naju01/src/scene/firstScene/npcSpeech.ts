/**
 * 장면 인물(아비사)이 지금 하는 말 — 화면 아래 자막 띠(동행 자막과 같은 자리)에 이름표와 함께 뜬다.
 * 인물이 말하는 동안 동행 자막은 비켜 준다(CompanionHud) — 두 말이 한 자리에 겹치지 않게(Codex 03회차).
 */
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";

export interface NpcSpeech {
  speaker: string;
  text: string;
  /** 같은 글이 이어 나와도 다시 그리게 */
  key: number;
  /** [E] 로 넘길 수 있다 */
  canAdvance: boolean;
}

const signal = createChangeSignal();
let speech: NpcSpeech | null = null;
let nextKey = 1;

export function setNpcSpeech(next: Omit<NpcSpeech, "key"> | null) {
  speech = next ? { ...next, key: nextKey++ } : null;
  signal.notify();
}

export const isNpcSpeaking = () => speech !== null;
export const useNpcSpeech = () => useSyncExternalStore(signal.subscribe, () => speech);
