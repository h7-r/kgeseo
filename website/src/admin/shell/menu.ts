import { ROUTES } from "@/navigation/routes";

import { MENU_SCREENS, screenHref } from "../screens";

/** 사이드바 칸 — 화면 설정(screens.ts)에서 메뉴에 보일 것만 고른다. 이름 · 상태 · 주소를 여기 다시 적지 않는다. */
export const ADMIN_MENU = MENU_SCREENS.map((screen) => ({ screen, href: screenHref(ROUTES.admin, screen) }));
