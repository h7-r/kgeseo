/**
 * 개발·검사용으로 window.__game 에 내보내는 값.
 * 도구/ 의 자동 검사 스크립트와 브라우저 콘솔이 쓴다. 게임 로직은 여기에 기대지 않는다.
 *
 * 운영 빌드에서는 내보내지 않는다 — 열어 두면 누구나 개발자 도구로 물건을 만들거나 순간이동할 수 있다(11/10 미르).
 * 빌드한 판으로 재야 할 때만 `VITE_DEV_HOOKS=1` 을 붙여 빌드한다. 운영 배포에는 이 값을 넣지 않는다.
 */
interface DevHooks {
  [name: string]: unknown;
}

declare global {
  interface Window {
    __game?: DevHooks;
  }
}

/** 개발 서버이거나, 잴 목적으로 따로 켠 빌드에서만 */
const IS_EXPOSED = import.meta.env.DEV || import.meta.env.VITE_DEV_HOOKS === "1";

export function exposeDevHook(name: string, value: unknown) {
  if (!IS_EXPOSED || typeof window === "undefined") return;
  window.__game ??= {};
  window.__game[name] = value;
}
