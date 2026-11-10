import { ROUTES, safeNextPath } from "@/navigation/routes";

const base = ROUTES.admin;

/** 관리자 화면 주소. 운영 주소는 https://www.k-escape.com/admin 이다. */
export const ADMIN_PATHS = {
  dashboard: base,
  login: `${base}/login`,
  traffic: `${base}/traffic`,
  users: `${base}/users`,
  userStats: `${base}/user-stats`,
  gameData: `${base}/game-data`,
  activity: `${base}/activity`,
  notices: `${base}/notices`,
  contents: `${base}/contents`,
  support: `${base}/support`,
  subscriptions: `${base}/subscriptions`,
  settings: `${base}/settings`,
} as const;

export const userDetailPath = (userId: string) => `${ADMIN_PATHS.users}/${encodeURIComponent(userId)}`;

export const isAdminPath = (pathname: string) => pathname === base || pathname.startsWith(`${base}/`);

/** 로그인 뒤 돌아갈 곳. 관리자 안의 주소만 받는다 — 로그인 화면으로 다시 돌아가는 고리도 막는다. */
export function adminNextPath(value: string | null): string {
  const next = safeNextPath(value);
  if (!next || !isAdminPath(next.split("?")[0]) || next.startsWith(ADMIN_PATHS.login)) return ADMIN_PATHS.dashboard;
  return next;
}

export const adminLoginPath = (next: string) => `${ADMIN_PATHS.login}?next=${encodeURIComponent(next)}`;
