import { gameEntry } from "../../../shared/deploymentUrls.ts";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { openGameTransition } from "@/app/siteState";
import { openGameStartGuide } from "@/mobile/gameStartStore";
import { isMobileLayout } from "@/mobile/layoutMode";
import { getSessionUser } from "@/services/session";

export const ROUTES = {
  home: "/",
  login: "/login",
  signup: "/signup",
  // 처음 온 소셜 계정이 닉네임·동의를 마치는 곳. 가입 증표는 주소에 싣지 않는다.
  socialOnboarding: "/signup/social",
  forgotPassword: "/forgot-password",
  verifyCode: "/reset-password",
  resetPassword: "/reset-password/done",
  about: "/about",
  terms: "/terms",
  support: "/support",
  pricing: "/pricing",
  myPage: "/mypage",
  media: "/media",
  search: "/search",
  play: "/play",
  forbidden: "/error/403",
  serverError: "/error/500",
  maintenance: "/maintenance",
  offline: "/offline",
  admin: "/admin",
  // 네이버 개발자센터·백엔드에 redirect_uri 로 등록된 주소라 한글 그대로 둔다. 바꾸면 양쪽 등록도 같이 바꿔야 한다.
  socialCallback: "/로그인/콜백",
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

/** 서비스 이름. 회사·팀 이름(LATENT SPACE)과 구분해 탭 제목·푸터·저작권 표시에 쓴다. */
const SERVICE_NAME = "ESCAPE THE LEGEND";

const PAGE_TITLES: Readonly<Partial<Record<string, string>>> = {
  [ROUTES.login]: "로그인",
  [ROUTES.signup]: "회원가입",
  [ROUTES.socialOnboarding]: "가입 마무리",
  [ROUTES.forgotPassword]: "비밀번호 찾기",
  [ROUTES.verifyCode]: "비밀번호 재설정",
  [ROUTES.resetPassword]: "비밀번호 재설정",
  [ROUTES.about]: "게임 소개",
  [ROUTES.terms]: "약관 및 정책",
  [ROUTES.support]: "고객센터",
  [ROUTES.pricing]: "구독",
  [ROUTES.myPage]: "마이페이지",
  [ROUTES.media]: "게임 영상",
  [ROUTES.search]: "검색",
  [ROUTES.play]: "게임 시작",
  [ROUTES.forbidden]: "로그인이 필요합니다",
  [ROUTES.serverError]: "일시적인 오류",
  [ROUTES.maintenance]: "점검 중",
  [ROUTES.offline]: "인터넷 연결 없음",
  [ROUTES.socialCallback]: "로그인",
};

/** 브라우저 탭 제목. 모르는 주소는 404 화면이 뜨므로 그에 맞춘다. */
export function pageTitle(pathname: string): string {
  if (pathname === ROUTES.home) return `${SERVICE_NAME} — 지역 전설 방탈출`;
  const name = PAGE_TITLES[decodeURIComponent(pathname)] ?? "페이지를 찾을 수 없습니다";
  return `${name} · ${SERVICE_NAME}`;
}

/** 주소 질의 이름. 탭은 각 데이터 파일의 탭 id 를 값으로 쓴다. */
export const QUERY = {
  tab: "tab",
  next: "next",
  search: "q",
} as const;

export function withQuery(path: RoutePath, params: Record<string, string>): `${RoutePath}?${string}` {
  return `${path}?${new URLSearchParams(params)}`;
}

/** 게임을 시작하는 단추가 넘기는 값. 로그인 여부에 따라 게임 또는 로그인으로 간다. */
export const START_GAME = "start-game" as const;

export type NavTarget = RoutePath | `${RoutePath}?${string}` | typeof START_GAME;

// 게임 본편은 별도 앱이라 주소를 환경변수로 받는다. 개발 서버에서는 본편 개발 서버로 간다.
const GAME_URL = import.meta.env.VITE_GAME_URL || (import.meta.env.DEV ? "http://localhost:5173" : "");

// 본편과의 계약: 캐릭터 생성 화면에서 시작하고, 전환 영상을 이어 틀 초와 가입 닉네임을 질의로 넘긴다.
const GAME_ENTRY_PATH = import.meta.env.VITE_GAME_ENTRY_PATH || "/character-creation";
export const GAME_TRANSITION_PARAM = "transition";
const GAME_NICKNAME_PARAM = "nickname";

/** 로그인·가입·비밀번호 찾기 화면들. */
export const AUTH_PAGE_PATHS: readonly string[] = [
  ROUTES.login,
  ROUTES.signup,
  ROUTES.socialOnboarding,
  ROUTES.forgotPassword,
  ROUTES.verifyCode,
  ROUTES.resetPassword,
];

/** 열린 리다이렉트를 막는다. 이 사이트 안의 절대 경로만 받는다. */
export function safeNextPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}

/** 게임으로 간다. 게임 주소가 없으면 게임 소개로 보낸다. */
export function launchGame(navigate: (path: RoutePath) => void) {
  if (!GAME_URL) {
    navigate(ROUTES.about);
    return;
  }
  // gameEntry: 게임 출처 · 내부 경로만 받는다(운영은 HTTPS)
  const url = new URL(gameEntry(GAME_URL, GAME_ENTRY_PATH, import.meta.env.PROD));
  const nickname = getSessionUser()?.name;
  if (nickname) url.searchParams.set(GAME_NICKNAME_PARAM, nickname);
  // 모바일이면 사전 안내(가로 · 용량 · 앱 안 브라우저)를 먼저 — 확인하면 같은 전환으로 넘어간다
  if (isMobileLayout()) {
    openGameStartGuide(url.href);
    return;
  }
  openGameTransition(url.href);
}

/** 사이트 안 이동. START_GAME 은 누르는 순간의 로그인 여부로 갈라진다. */
export function useSiteNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (target: NavTarget) => {
      if (target !== START_GAME) {
        navigate(target);
        return;
      }
      if (getSessionUser()) launchGame(navigate);
      // 게임을 하려던 사람이다 — 로그인·가입을 마치면 지금 페이지가 아니라 게임으로 바로 잇는다.
      else navigate(withQuery(ROUTES.login, { [QUERY.next]: ROUTES.play }));
    },
    [navigate],
  );
}

/** 머리띠 메뉴. 어느 페이지에서나 같은 여섯 항목을 그린다. */
export const HEADER_MENU = [
  { id: "home", label: "홈", path: ROUTES.home },
  { id: "about", label: "소개", path: ROUTES.about },
  { id: "collection", label: "컬렉션", path: ROUTES.media },
  { id: "subscribe", label: "구독", path: ROUTES.pricing },
  { id: "brand", label: "브랜드", path: ROUTES.terms },
  { id: "support", label: "고객센터", path: ROUTES.support },
] as const;

/** 아직 계정이 없는 소셜 채널. 주소를 채우면 아이콘이 링크로 바뀐다. */
export const SOCIAL_LINKS = {
  x: "",
  youtube: "",
  twitter: "",
  instagram: "",
} as const;

/** 홈 푸터와 하위 페이지 푸터가 함께 쓰는 링크. */
export const FOOTER_LINKS: readonly { label: string; target: NavTarget }[] = [
  { label: "게임 소개", target: ROUTES.about },
  { label: "컬렉션", target: ROUTES.media },
  { label: "구독 혜택", target: ROUTES.pricing },
  { label: "고객센터", target: ROUTES.support },
];
