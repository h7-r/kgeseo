import { ADMIN_PATHS } from "../paths";

/** live = 서버와 연결됨 · partial = 일부만 연결 · pending = 서버 API 전(준비 중) */
export type MenuStatus = "live" | "partial" | "pending";

export interface AdminMenuItem {
  path: string;
  label: string;
  status: MenuStatus;
}

/** 사이드바 순서 그대로. 서버 API 가 생기면 status 만 바꾼다. */
export const ADMIN_MENU: readonly AdminMenuItem[] = [
  { path: ADMIN_PATHS.dashboard, label: "대시보드", status: "partial" },
  { path: ADMIN_PATHS.traffic, label: "접속 통계", status: "pending" },
  { path: ADMIN_PATHS.users, label: "회원 관리", status: "live" },
  { path: ADMIN_PATHS.userStats, label: "회원 통계", status: "pending" },
  { path: ADMIN_PATHS.gameData, label: "게임 데이터", status: "pending" },
  { path: ADMIN_PATHS.activity, label: "활동 로그", status: "pending" },
  { path: ADMIN_PATHS.notices, label: "공지사항", status: "pending" },
  { path: ADMIN_PATHS.contents, label: "콘텐츠", status: "pending" },
  { path: ADMIN_PATHS.support, label: "CS 관리", status: "pending" },
  { path: ADMIN_PATHS.subscriptions, label: "구독 관리", status: "pending" },
  { path: ADMIN_PATHS.settings, label: "설정", status: "pending" },
];

/** 주소에 맞는 메뉴. 회원 상세처럼 아래 주소는 위 메뉴를 따른다. */
export function menuItemFor(pathname: string): AdminMenuItem | undefined {
  return [...ADMIN_MENU]
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
}
