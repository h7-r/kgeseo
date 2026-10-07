import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { getSessionUser } from "@/services/session";
import { openGameTransition } from "@/state/gameTransition";

export const ROUTES = {
  home: "/",
  login: "/login",
  signup: "/signup",
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
  // 네이버 개발자센터·백엔드에 redirect_uri 로 등록된 주소라 한글 그대로 둔다. 바꾸면 양쪽 등록도 같이 바꿔야 한다.
  socialCallback: "/로그인/콜백",
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

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

// 본편과의 계약: 캐릭터 생성 화면에서 시작하고, 전환 영상을 이어 틀 초를 질의로 넘긴다.
const GAME_ENTRY_PATH = "/character-creation";
export const GAME_TRANSITION_PARAM = "transition";

/** 로그인·가입·비밀번호 찾기 화면들. */
export const AUTH_PAGE_PATHS: readonly string[] = [
  ROUTES.login,
  ROUTES.signup,
  ROUTES.forgotPassword,
  ROUTES.verifyCode,
  ROUTES.resetPassword,
];

// 게임 시작 주소로 돌아오면 로그인하자마자 게임이 열리므로 함께 뺀다.
const NON_RETURN_PATHS: readonly string[] = [...AUTH_PAGE_PATHS, ROUTES.play];

/** 로그인 뒤 돌아올 곳. 인증 화면끼리 오가며 빙빙 돌지 않게 인증 화면이면 홈으로. */
function currentReturnPath(): string {
  const { pathname, search } = window.location;
  return NON_RETURN_PATHS.includes(pathname) ? ROUTES.home : pathname + search;
}

/** 열린 리다이렉트를 막는다. 이 사이트 안의 절대 경로만 받는다. */
export function safeNextPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}

function loginPathReturningHere(): `${RoutePath}?${string}` {
  return withQuery(ROUTES.login, { [QUERY.next]: currentReturnPath() });
}

/** 게임으로 간다. 게임 주소가 없으면 게임 소개로 보낸다. */
export function launchGame(navigate: (path: RoutePath) => void) {
  if (GAME_URL) openGameTransition(GAME_URL.replace(/\/$/, "") + GAME_ENTRY_PATH);
  else navigate(ROUTES.about);
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
      else navigate(loginPathReturningHere());
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
  { label: "탐험", target: ROUTES.media },
  { label: "지역 맵", target: ROUTES.home },
  { label: "퀘스트", target: ROUTES.about },
  { label: "보상", target: ROUTES.pricing },
];
