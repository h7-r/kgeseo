import { ROUTES } from "@/navigation/routes";

import { safeAdminNext } from "./lib/nextPath";
import { buildAdminPaths, findScreen, menuScreenOf, type AdminScreen } from "./screens";

/** 관리자 주소. 운영 주소는 https://www.k-escape.com/admin 이다. 첫 주소는 ROUTES.admin 하나에서 온다. */
export const ADMIN_PATHS = buildAdminPaths(ROUTES.admin);

export const findAdminScreen = (pathname: string): AdminScreen | undefined => findScreen(pathname, ROUTES.admin);

/** 탭 제목 · 메뉴 강조에 쓰는 이름 — 회원 상세는 「회원 관리」를 따른다. */
export const menuLabelFor = (pathname: string): string | undefined => {
  const screen = findAdminScreen(pathname);
  return screen && menuScreenOf(screen).label;
};

export const adminNextPath = (value: string | null) => safeAdminNext(value, ADMIN_PATHS.dashboard, ADMIN_PATHS.login);

export const adminLoginPath = (next: string) => `${ADMIN_PATHS.login}?next=${encodeURIComponent(next)}`;
