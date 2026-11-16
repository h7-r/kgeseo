/**
 * 읽는 속도 — 설정 「대사 자동 넘김」이 꺼져 있으면(기본) 이야기 대사 · 퍼즐 설명 · 청한 대답은 [F] 를 눌러야 넘어간다.
 * 영영 기다리지는 않는다 — MANUAL_HOLD_MS 가 지나면 넘어간다(대사 끝에 묶인 연출 · 줄 선 말이 막히지 않게).
 */
import { settingsStore } from "@/settings/settings";

/** 수동 넘김에서 한 쪽이 머무는 가장 긴 시간(ms) */
export const MANUAL_HOLD_MS = 45_000;

export const isManualAdvance = () => !settingsStore.get().autoAdvance;

/** 장면 인물(아비사 · 어부 · 동행 소개)의 한 줄이 머무는 시간(초) — 자동이면 글 길이대로, 수동이면 [F] 를 기다린다 */
export const storyHoldSeconds = (autoSeconds: number) =>
  isManualAdvance() ? Math.max(autoSeconds, MANUAL_HOLD_MS / 1000) : autoSeconds;

let isReading = false;
/** 수동으로 넘기는 말이 떠 있나 — 물속에서는 읽는 동안 숨이 줄지 않게 한다(caveState) */
export const isReadingHeld = () => isReading;
export function setReadingHeld(next: boolean) {
  isReading = next;
}
