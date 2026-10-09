import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { DESIGN_WIDTH, HEADER_HEIGHT, useStageScale } from "@/lib/layout";
import { AUTH_PAGE_PATHS, QUERY, ROUTES, withQuery, type RoutePath } from "@/navigation/routes";
import { measureSectionPositions } from "@/navigation/sectionGeometry";
import { SUB_NAV_HEIGHT, getSubMenu } from "@/navigation/subMenus";
import { signOut, useSessionUser } from "@/services/session";

import Header, { type HeaderMenuId } from "./Header";
import {
  cancelSectionScroll,
  scrollToSection,
  useCurrentSection,
  useHeaderScrollState,
  useSectionSnapMarkers,
} from "./headerScroll";
import SubNav from "./SubNav";

/*
 * 머리띠를 라우트 바깥에 한 번만 그린다. 화면마다 그리면 주소가 바뀔 때 새로 만들어져
 * 밑줄이 미끄러지지 않고 도착 자리로 순간이동한다. 무대와 같은 배율로 줄여야 화면과 어긋나지 않는다.
 */

const ACTIVE_MENU: Readonly<Record<string, HeaderMenuId | undefined>> = {
  [ROUTES.home]: "home",
  [ROUTES.about]: "about",
  [ROUTES.media]: "collection",
  [ROUTES.myPage]: "collection",
  [ROUTES.pricing]: "subscribe",
  [ROUTES.terms]: "brand",
  [ROUTES.support]: "support",
};

function activeMenuFor(path: string): HeaderMenuId {
  return ACTIVE_MENU[path] ?? (AUTH_PAGE_PATHS.includes(path) ? "about" : "home");
}

export default function HeaderLayer() {
  const scale = useStageScale();
  const { isSolid, isHidden: wantsHidden } = useHeaderScrollState();
  const user = useSessionUser();
  const navigate = useNavigate();
  const { pathname: path } = useLocation();
  const menu = getSubMenu(path);

  // 하위 메뉴는 머리 메뉴를 눌러서 온 페이지에서만 연다. 본문 링크·주소 입력으로 오면 닫혀 있다.
  const [subMenuPath, setSubMenuPath] = useState<string | null>(null);
  const subMenu = subMenuPath === path && menu?.showBar !== false ? menu : undefined;

  // 구간 맞춤 페이지에서 머리띠가 숨으면 「머리띠 아래 한가운데」 맞춤 자리 위에 빈 틈이 생긴다.
  const isHidden = wantsHidden && !menu;
  const headerHeight = Math.round((HEADER_HEIGHT + (subMenu ? SUB_NAV_HEIGHT : 0)) * scale);

  useSectionSnapMarkers(path, scale, headerHeight);
  const currentSection = useCurrentSection(path, scale, Boolean(subMenu), headerHeight);

  // 다른 페이지로 가면 굴리던 것을 멈춘다. 안 그러면 새 페이지를 이전 페이지의 구간 자리로 끌고 간다.
  useEffect(() => cancelSectionScroll, [path]);

  // 함수를 같은 것으로 유지해야 memo 된 Header 가 스크롤 문턱마다 다시 그려지지 않는다.
  const handleMenuNavigate = useCallback(
    (target: RoutePath) => {
      setSubMenuPath(target);
      navigate(target);
    },
    [navigate, setSubMenuPath],
  );

  const handleSubSelect = useCallback(
    (id: string) => {
      if (!getSubMenu(path)) return;
      // 스크롤로 잡힐 때와 같은 자리(머리띠 아래 한가운데)로 간다.
      scrollToSection(
        () => measureSectionPositions(path, scale, headerHeight).find((section) => section.id === id)?.snapTop,
      );
    },
    [path, scale, headerHeight],
  );

  const handleAccountClick = useCallback(() => navigate(user ? ROUTES.myPage : ROUTES.login), [navigate, user]);
  const handleSignOut = useCallback(() => {
    signOut();
    navigate(ROUTES.home);
  }, [navigate]);
  const handleSearch = useCallback(
    (query: string) => navigate(withQuery(ROUTES.search, { [QUERY.search]: query })),
    [navigate],
  );

  return (
    // fixed 는 변형이 없는 바깥 칸에 건다. scale 이 걸린 안쪽에 주면 창이 아니라 그 칸이 기준이 된다.
    <div
      className={["site-header", isSolid && "is-solid", isHidden && "is-hidden"].filter(Boolean).join(" ")}
      style={{ position: "fixed", left: 0, top: 0, width: "100%", height: `${headerHeight}px`, zIndex: 20 }}
    >
      <div style={{ width: `${DESIGN_WIDTH}px`, transformOrigin: "top left", transform: `scale(${scale})` }}>
        <Header
          activeId={activeMenuFor(path)}
          user={user}
          onAccountClick={handleAccountClick}
          onSignOut={handleSignOut}
          onSearch={handleSearch}
          onMenuNavigate={handleMenuNavigate}
        />
        {subMenu && <SubNav items={subMenu.items} activeId={currentSection} onSelect={handleSubSelect} />}
      </div>
    </div>
  );
}
