/**
 * 웹사이트 첫 화면 주소 — PC 전용 안내의 「홈페이지로」 · 멈춤 메뉴 「게임 종료」가 간다(나주입장 02 · 08회차).
 * 운영은 VITE_SITE_URL(없으면 www.k-escape.com — 게임은 play., 웹사이트는 www.), 개발 서버는 웹사이트 개발 서버(5175).
 * 다른 것을 가져오지 않는다 — 기기 판정 입구(main.tsx)가 게임 모듈보다 먼저 읽는다.
 */
export const SITE_URL: string =
  import.meta.env.VITE_SITE_URL || (import.meta.env.DEV ? "http://localhost:5175" : "https://www.k-escape.com");
