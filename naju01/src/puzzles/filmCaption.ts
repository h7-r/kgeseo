/**
 * 게임 속 영상(함의 그림자극 · 선바위 영상)의 자막 — 장면(컷)마다 한 줄씩, 영상의 시각에 맞춰 뜬다.
 * 영상이 끝난 뒤 서너 줄짜리 알림 한 덩이로 설명하던 것을 바꿨다(미르 11/11 「씬별로 자막이 뜨지 않고 한 번에 세네 줄로 떠서
 * 가독성 · 몰입감이 둘 다 떨어진다」). 알림 줄(interaction)과 따로 — 줄을 서지 않고 그 컷에 바로 뜬다.
 * 자막이 떠 있는 동안 다른 알림은 줄을 선다(isStoryOnScreen 이 본다).
 */
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";

/** 자막 한 줄 — from 초부터 to 초 전까지(영상을 튼 뒤 흐른 시간) */
export interface FilmCaption {
  from: number;
  to: number;
  text: string;
}

const signal = createChangeSignal();
let current: { text: string; key: number } | null = null;
let key = 0;

/** 지금 자막을 바꾼다(같은 글이면 그대로) — null 이면 내린다 */
export function setFilmCaption(text: string | null) {
  if ((current?.text ?? null) === text) return;
  key += 1;
  current = text === null ? null : { text, key };
  signal.notify();
}

/** 영상의 t 초에 뜰 자막(없으면 null) */
export const captionAt = (track: readonly FilmCaption[], t: number) =>
  track.find((caption) => t >= caption.from && t < caption.to)?.text ?? null;

export const isFilmCaptionOn = () => current !== null;
export const useFilmCaption = () => useSyncExternalStore(signal.subscribe, () => current);
