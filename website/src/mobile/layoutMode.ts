/**
 * 웹사이트 모바일 배치 판정 — 계획서 5.1 · 코덱스 01회차.
 * 화면 크기가 아니라 기기로 고른다(11/8 미르 · 해랑 검토): 주 입력이 손가락인 기기(pointer: coarse — 휴대폰 · 태블릿)이고
 * 폭 1400 미만(아이패드 가로 1180 포함)이면 모바일 배치. PC 는 창을 좁혀도 · 세로 모니터여도 · 터치 노트북이어도 PC 배치다
 * (예전엔 폭 1024 미만이면 PC 도 모바일 배치였다). 1400 이상은 큰 터치 화면(전시용 등)이라 PC 배치로 둔다.
 * PC 배치는 지금 그대로(1920 디자인을 창 폭에 맞춰 축소). 두 배치를 함께 그리고 CSS 로 숨기지 않는다 — 3D · 영상이 겹쳐 돈다.
 * 시험용: ?layout=mobile · ?layout=desktop
 */
import { useSyncExternalStore } from "react";

const MOBILE_QUERY = "(pointer: coarse) and (max-width: 1399.98px)";
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
