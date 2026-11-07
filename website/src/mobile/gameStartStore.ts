/**
 * 모바일 「게임 시작」 사전 안내 — 공통 시작 경로(launchGame)가 모바일이면 바로 넘기지 않고 이 안내를 먼저 띄운다
 * (로그인 뒤 /play 로 돌아온 경우도 같은 길을 지난다 — 코덱스 구현 05회차).
 */
import { useSyncExternalStore } from "react";

let pendingUrl: string | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function openGameStartGuide(url: string) {
  pendingUrl = url;
  notify();
}

export function closeGameStartGuide() {
  pendingUrl = null;
  notify();
}

export function useGameStartGuide(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pendingUrl,
    () => null,
  );
}

/**
 * 앱 안 브라우저(카카오톡 · 인스타그램 · 페이스북 · 네이버 · 라인 등) — 안내를 띄우는 보조 신호일 뿐이다.
 * 표준 판별 API 는 없고 UA 는 완전하지 않으므로, 못 잡은 사람도 안내 안의 「주소 복사」를 쓸 수 있게 늘 보여 준다.
 */
export function looksLikeInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(inapp|Line\/|DaumApps|everytimeApp/i.test(navigator.userAgent);
}
