/**
 * 웹사이트 모바일 배치 판정 — 계획서 5.1 · 코덱스 01회차.
 * 폭 1024 미만이거나, 손가락으로 누를 수 있는 기기(any-pointer: coarse — 태블릿에 마우스를 붙여도)의 폭 1400 미만
 * (아이패드 가로 1180 포함)이면 모바일 배치를 그린다. 터치 노트북도 여기에 들어간다(코덱스 구현 05회차 — 의도적으로 수용).
 * 그 밖은 지금 그대로(1920 디자인을 창 폭에 맞춰 축소). 두 배치를 함께 그리고 CSS 로 숨기지 않는다 — 3D · 영상이 겹쳐 돈다.
 * 시험용: ?layout=mobile · ?layout=desktop
 */
import { useSyncExternalStore } from "react";

const MOBILE_QUERY = "(max-width: 1023.98px), ((any-pointer: coarse) and (max-width: 1399.98px))";
const FORCED = typeof location !== "undefined" ? new URLSearchParams(location.search).get("layout") : null;

function subscribe(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function isMobileLayout(): boolean {
  if (FORCED === "mobile") return true;
  if (FORCED === "desktop") return false;
  return typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobileLayout(): boolean {
  return useSyncExternalStore(subscribe, isMobileLayout, () => false);
}
