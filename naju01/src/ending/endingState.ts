/**
 * 나주 엔딩 진행 — 마지막 퍼즐(다섯 횃불)이 풀린 뒤(미르 11/10 · 11/11 「마지막 시네마틱인 만큼 전체 서사를 잘 마무리 · 전체화면 ·
 * 영상 뒤에 현장 방문 · 방문 보상 창」, 나주엔딩 01회차 Codex).
 *   off      평소
 *   finale   게임 안 끝 연출(불기둥 → 소반 → 가락지 → 새벽) — 일반 HUD 를 숨기고 연출 글은 아래 자막 띠로. 세계는 흐른다
 *   film     전체화면 엔딩 필름(되짚기 → 전해지는 이야기 → 마지막 물음) — DOM 덮개, 세계는 멈춘다(창 붙듦)
 *   clear    클리어 화면 + 현장 방문 · 보상 창 — 같은 덮개
 * 다시 보기는 감상만 한다 — 퍼즐 · 서버 보고 · 보상은 되풀이하지 않는다(여기서는 화면만 바꾼다).
 */
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

import { recall, remember } from "../save/puzzleMemory";

export type EndingPhase = "off" | "finale" | "film" | "clear";

/** 엔딩을 다 봤나(건너뛰기 포함) — 대본이 크게 바뀌면 판을 올려 한 번 더 보이게 */
const SEEN_KEY = "ending.seenVersion";
export const ENDING_VERSION = 1;

interface Caption {
  text: string;
  key: number;
}

const signal = createChangeSignal();
let phase: EndingPhase = "off";
let caption: Caption | null = null;
let captionTimer = 0;
let captionKey = 0;

function setPhase(next: EndingPhase) {
  if (phase === next) return;
  phase = next;
  if (next !== "finale") clearCaption();
  signal.notify();
}

function clearCaption() {
  window.clearTimeout(captionTimer);
  captionTimer = 0;
  if (!caption) return;
  caption = null;
  signal.notify();
}

export const ending = {
  phase: () => phase,
  subscribe: signal.subscribe,
  /** 굿이 풀렸다 — 게임 안 끝 연출 동안 HUD 를 걷고 자막 띠를 쓴다 */
  beginFinale() {
    if (phase === "off") setPhase("finale");
  },
  /**
   * 끝 연출 자막 한 줄 — 앞 줄은 바로 바뀐다(알림 줄을 안 거친다: 줄을 서면 장면보다 늦게 뜬다, 나주피드백 01회차 Codex).
   * seconds 뒤 내려간다. 실제 시각(연출이 게임 시계로 예약해 부르므로 뜬 뒤 길이만 잰다)
   */
  caption(text: string, seconds: number) {
    if (phase !== "finale") return;
    window.clearTimeout(captionTimer);
    captionKey += 1;
    caption = { text, key: captionKey };
    signal.notify();
    captionTimer = window.setTimeout(clearCaption, seconds * 1000);
  },
  /** 전체화면 엔딩 필름 */
  openFilm: () => setPhase("film"),
  /** 필름이 끝났거나 건너뛰었다 — 다 본 것으로 적고 클리어 화면으로 */
  finishFilm() {
    remember(SEEN_KEY, ENDING_VERSION);
    setPhase("clear");
  },
  /** 클리어 화면을 바로(필름 없이) */
  openClear: () => setPhase("clear"),
  /** 덮개를 걷고 새벽의 강가로 돌아간다 */
  close: () => setPhase("off"),
  isSeen: () => recall<number>(SEEN_KEY, 0) >= ENDING_VERSION,
};

export const useEndingPhase = () => useSyncExternalStore(signal.subscribe, () => phase);
export const useEndingCaption = () => useSyncExternalStore(signal.subscribe, () => caption);

exposeDevHook("najuEnding", {
  phase: () => phase,
  film: () => ending.openFilm(),
  clear: () => ending.openClear(),
  close: () => ending.close(),
  seen: () => ending.isSeen(),
  unsee: () => remember(SEEN_KEY, 0),
});
