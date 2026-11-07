/**
 * 휴대폰 세로 판정 — 게임 시작 안내가 「가로로 돌리면 시작」을 고른다(11/7 미르 · 코덱스 13회차).
 * 게임 쪽(src/engine/input/landscape.ts)과 같은 기준: 화면 방향(screen.orientation.type)을 먼저 보고,
 * 없으면 창 비율(orientation 미디어 쿼리)로 본다 — 창 비율은 키보드가 뜨면 바뀌어 오판할 수 있다.
 */
import { useSyncExternalStore } from "react";

const PORTRAIT_QUERY = "(orientation: portrait)";

function readIsPortrait(): boolean {
  if (typeof window === "undefined") return false;
  const type = screen.orientation?.type;
  if (type) return type.startsWith("portrait");
  return window.matchMedia(PORTRAIT_QUERY).matches;
}

function subscribe(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const media = window.matchMedia(PORTRAIT_QUERY);
  screen.orientation?.addEventListener?.("change", onChange);
  media.addEventListener("change", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    screen.orientation?.removeEventListener?.("change", onChange);
    media.removeEventListener("change", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}

export function useIsPortrait(): boolean {
  return useSyncExternalStore(subscribe, readIsPortrait, () => false);
}
