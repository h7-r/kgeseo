/**
 * 임시 프레임 상한 — 화면이 가려졌거나 창이 뒤로 갔을 때 잠깐 덜 그리게 한다(CPU · GPU 를 그만큼 덜 쓴다).
 * 까닭(reason)마다 하나씩 걸고, 여럿이면 가장 낮은 값을 쓴다. 설정의 프레임 제한과는 engine/frameLimit 의 activeFrameLimit 이 합친다.
 *
 * 멈춤(gamePause)과 다르다 — 게임 시간 · 소리 · 영상은 그대로 흐르고 그리는 횟수만 준다.
 */
import { useSyncExternalStore } from "react";

/** 영상(로딩 · 오프닝)이 화면을 다 덮은 동안 — 뒤 장면은 안 보인다. 아주 세우지는 않는다(준비 판정 · 배치가 프레임으로 돈다) */
export const COVERED_FPS = 10;
/** 창이 포커스를 잃은 동안(다른 창을 쓰는 중) — 화면은 보일 수 있어 반만 줄인다 */
export const UNFOCUSED_FPS = 30;

const caps = new Map<string, number>();
const listeners = new Set<() => void>();
let current = 0;

function refresh() {
  let lowest = 0;
  for (const fps of caps.values()) if (lowest === 0 || fps < lowest) lowest = fps;
  if (lowest === current) return;
  current = lowest;
  for (const listener of listeners) listener();
}

/** fps 가 null · 0 이면 그 까닭의 상한을 푼다 */
export function setRenderCap(reason: string, fps: number | null) {
  if (fps && fps > 0) caps.set(reason, fps);
  else caps.delete(reason);
  refresh();
}

/** 지금 걸린 임시 상한(0 = 없음) */
export const renderCap = () => current;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useRenderCap(): number {
  return useSyncExternalStore(subscribe, renderCap, () => 0);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  // 창이 뒤로 가면 덜 그린다. 탭이 아예 가려지면 브라우저가 rAF 를 세우므로 따로 할 일이 없다
  const sync = () => setRenderCap("unfocused", document.hasFocus() ? null : UNFOCUSED_FPS);
  window.addEventListener("blur", sync);
  window.addEventListener("focus", sync);
  sync();
}
