/**
 * 개발·검사용으로 window.__game 에 내보내는 값.
 * 도구/ 의 자동 검사 스크립트와 브라우저 콘솔이 쓴다. 게임 로직은 여기에 기대지 않는다.
 */
export interface DevHooks {
  [name: string]: unknown;
}

declare global {
  interface Window {
    __game?: DevHooks;
  }
}

export function exposeDevHook(name: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.__game ??= {};
  window.__game[name] = value;
}
