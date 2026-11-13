/**
 * 장면 인물(아비사 · 어부 · 동행 소개)이 지금 하는 말 — 동행 대화창(dialogue/DialogueLayer) 한 벌에 이름표와 함께 뜬다(미르 11/9, 계약 §10).
 * 인물이 차례를 잡은 동안 동행 말은 줄 서서 기다린다 — 두 말이 한 자리에 겹치지 않게(Codex 03회차). 차례가 바뀌면 바로 알린다(ownerSignal).
 * 넘기기는 누가 말하든 [F](터치 💬) 하나 — 겨누거나 다가가지 않아도 된다(미르 11/11 「말을 건 NPC 가까이 가지 않으면 E 로 안 넘어간다」,
 * 계약 v0.4.16 §10-2 「말 거는 키는 F 하나, E 는 물건 쓰기 전용」).
 */
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";
import { textLog } from "../../dialogue/textLog";

export interface NpcSpeech {
  speaker: string;
  text: string;
  /** 같은 글이 이어 나와도 다시 그리게 */
  key: number;
  /** 다음 줄로 — [F] · 터치 💬 · 대화창 「다음」(advanceNpcSpeech). 있으면 상자가 「다음」 안내를 띄운다 */
  onNext?: () => void;
}

/** 대화창 윗변 높이(px, 무대 아래끝에서) — DialogueLayer 가 적고 동행 소개 클로즈업 구도 · 겨냥 알림이 읽는다 */
export const NPC_SPEECH_TOP_VAR = "--npc-speech-top";

const signal = createChangeSignal();
/** 차례 주인이 바뀌었다 — 대화창이 동행 말을 바로 멈추고 잇게(0.5초 판정을 기다리지 않게, Codex 01회차) */
const ownerSignal = createChangeSignal();
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
  if (owner === id) return true;
  owner = id;
  ownerSignal.notify();
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
  ownerSignal.notify();
}

/** 다른 사람이 차례를 잡고 있다(id 를 주면 그 사람 자신은 빼고) */
export const isTalkTaken = (id?: string) => owner !== null && owner !== id;
export const subscribeTalkOwner = ownerSignal.subscribe;
export const useTalkTaken = () => useSyncExternalStore(ownerSignal.subscribe, () => owner !== null);
/** 지금 차례를 잡은 사람(없으면 null) */
export const talkOwner = () => owner;
export const useTalkOwner = () => useSyncExternalStore(ownerSignal.subscribe, () => owner);

/**
 * 끊을 수 있는 말 — 플레이어가 말을 거는 장면 인물(아비사 · 어부)만 등록한다. 말하는 중 다른 것과 상호작용하면(물건 [E] · 다른 인물 [F])
 * 그친다 — 「대사가 나오는 중이라도 다른 것과 상호작용해 대사가 나오면 이전 대화는 찍어눌러야 한다」(미르 11/11).
 * 그칠 때 띄운 줄은 들은 것으로 치지 않는다(다시 말을 걸면 그 줄부터). 동행 말(소개 · 한마디)은 등록하지 않아 끊기지 않는다
 */
const interrupters = new Map<string, () => void>();
export function registerTalkInterrupter(id: string, stop: () => void) {
  interrupters.set(id, stop);
  return () => {
    if (interrupters.get(id) === stop) interrupters.delete(id);
  };
}
/** 지금 말하는 사람이 끊을 수 있는 인물인가 */
export const isTalkInterruptible = () => owner !== null && interrupters.has(owner);
/** 지금 말하는 인물을 그친다(끊을 수 있을 때만). 그쳤으면 true */
export function interruptTalk(): boolean {
  const stop = owner === null ? undefined : interrupters.get(owner);
  if (!stop) return false;
  stop();
  return true;
}

/** 자막을 바꾼다 — 차례를 잡은 사람만(by). 차례가 비어 있으면 누구나 */
export function setNpcSpeech(next: Omit<NpcSpeech, "key"> | null, by?: string) {
  if (owner !== null && by !== undefined && owner !== by) return;
  speech = next ? { ...next, key: nextKey++ } : null;
  if (next) textLog.add(next.speaker, next.text);
  signal.notify();
}

export const isNpcSpeaking = () => speech !== null;

/** [F] — 장면 인물 말이 떠 있으면 한 줄 넘긴다(어디서든 · 겨누지 않아도). 넘겼으면 true */
export function advanceNpcSpeech(): boolean {
  if (!speech?.onNext) return false;
  speech.onNext();
  return true;
}
export const useNpcSpeech = () => useSyncExternalStore(signal.subscribe, () => speech);

/**
 * 대화창이 실제로 떠 있나(장면 인물 말이든 동행 말이든) — 터치 화면에서 빠른 칸 · 알림이 창에 자리를 내준다
 */
const boxSignal = createChangeSignal();
let isBoxShown = false;
export function setSpeechBoxShown(next: boolean) {
  if (isBoxShown === next) return;
  isBoxShown = next;
  boxSignal.notify();
}
export const useSpeechBoxShown = () => useSyncExternalStore(boxSignal.subscribe, () => isBoxShown);
/** 대화창이 떠 있나(훅 밖) — 알림 줄이 그동안 기다린다(puzzles/interaction.ts isStoryOnScreen) */
export const isSpeechBoxShown = () => isBoxShown;
