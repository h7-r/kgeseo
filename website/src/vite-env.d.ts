/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 게임 본편 주소. 비어 있으면 게임 시작 단추가 게임 소개로 보낸다. */
  readonly VITE_GAME_URL?: string;
  /** 로비 서버 주소(wss://…) — 관리자 서버 상태 칸이 닿는지만 본다 */
  readonly VITE_LOBBY_URL?: string;
  /** "off" 면 테스트 계정을 만들지 않는다. */
  readonly VITE_TEST_ACCOUNT?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_NAVER_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
