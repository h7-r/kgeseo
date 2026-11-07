/**
 * 모바일 머리띠 — 로고 · 게임 시작 · ☰. 메뉴는 화면을 덮는 시트로 연다(머리 메뉴 여섯 · 계정 · 검색).
 * 데스크톱 HeaderLayer(1920 무대 배율 · 구간 스크롤 측정)는 모바일에서 그리지 않는다.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { FONT } from "@/lib/style";
import { HEADER_MENU, QUERY, ROUTES, START_GAME, useSiteNavigate, withQuery } from "@/navigation/routes";
import { signOut, useSessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

import { GUTTER, MOBILE_HEADER_HEIGHT, primaryButtonStyle, safeTop } from "./mobileStyles";

export default function MobileHeader() {
  const siteNavigate = useSiteNavigate();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // 메뉴를 연 페이지를 적어 둔다 — 다른 페이지로 옮기면 저절로 닫힌다
  const [menuOpenAt, setMenuOpenAt] = useState<string | null>(null);
  // 다른 페이지로 옮기면 열린 기록을 지운다 — 뒤로 가기로 돌아와도 메뉴가 다시 열리지 않게
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setMenuOpenAt(null);
  }
  const isMenuOpen = menuOpenAt === pathname;
  const user = useSessionUser();
  const [query, setQuery] = useState("");

  // 메뉴가 열린 동안 뒤 페이지가 스크롤되지 않게
  useEffect(() => {
    if (!isMenuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isMenuOpen]);

  return (
    <>
      <header style={barStyle}>
        <button type="button" style={logoStyle} aria-label="LATENT SPACE 홈으로" onClick={() => navigate(ROUTES.home)}>
          latent-Space
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button type="button" style={startStyle} onClick={() => siteNavigate(START_GAME)}>
            게임 시작
          </button>
          <button
            type="button"
            style={menuButtonStyle}
            aria-label={isMenuOpen ? "메뉴 닫기" : "메뉴 열기"}
            aria-expanded={isMenuOpen}
            onClick={() => setMenuOpenAt(isMenuOpen ? null : pathname)}
          >
            {isMenuOpen ? "✕" : "☰"}
          </button>
        </div>
      </header>

      {isMenuOpen && (
        <div style={sheetStyle} role="dialog" aria-label="사이트 메뉴">
          <form
            style={searchRowStyle}
            onSubmit={(event) => {
              event.preventDefault();
              const text = query.trim();
              if (text) navigate(withQuery(ROUTES.search, { [QUERY.search]: text }));
            }}
          >
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="검색"
              enterKeyHint="search"
              aria-label="사이트 검색"
              style={searchInputStyle}
            />
          </form>
          <nav style={{ display: "grid" }}>
            {HEADER_MENU.map(({ id, label, path }) => (
              <button
                key={id}
                type="button"
                style={{ ...menuItemStyle, color: pathname === path ? "#7f97d6" : COLOR.textBright }}
                aria-current={pathname === path ? "page" : undefined}
                onClick={() => {
                  setMenuOpenAt(null);
                  navigate(path);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <div style={accountRowStyle}>
            {user ? (
              <>
                <button type="button" style={accountButtonStyle} onClick={() => navigate(ROUTES.myPage)}>
                  {user.name} 님 · 마이페이지
                </button>
                <button
                  type="button"
                  style={accountButtonStyle}
                  onClick={() => {
                    signOut();
                    navigate(ROUTES.home);
                  }}
                >
                  로그아웃
                </button>
              </>
            ) : (
              <>
                <button type="button" style={accountButtonStyle} onClick={() => navigate(ROUTES.login)}>
                  로그인
                </button>
                <button type="button" style={accountButtonStyle} onClick={() => navigate(ROUTES.signup)}>
                  회원가입
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const barStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  top: 0,
  right: 0,
  zIndex: 40,
  height: `calc(env(safe-area-inset-top, 0px) + ${MOBILE_HEADER_HEIGHT}px)`,
  paddingTop: safeTop(),
  paddingLeft: `calc(env(safe-area-inset-left, 0px) + ${GUTTER}px)`,
  paddingRight: `calc(env(safe-area-inset-right, 0px) + 12px)`,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: "rgba(1,4,10,0.86)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  borderBottom: `1px solid ${COLOR.border}`,
};

const logoStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "17px",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: COLOR.textBright,
  minHeight: "44px",
  cursor: "pointer",
  // 글자 크기를 키운 기기에서 로고가 ☰ 를 화면 밖으로 밀지 않게 — 로고가 줄어들고 말줄임
  minWidth: 0,
  flexShrink: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  textAlign: "left",
};

const startStyle: CSSProperties = { ...primaryButtonStyle, minHeight: "40px", padding: "0 16px", fontSize: "14px" };

const menuButtonStyle: CSSProperties = {
  width: "44px",
  height: "44px",
  fontSize: "22px",
  color: COLOR.textBright,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const sheetStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  top: `calc(env(safe-area-inset-top, 0px) + ${MOBILE_HEADER_HEIGHT}px)`,
  zIndex: 39,
  overflowY: "auto",
  overscrollBehavior: "contain",
  padding: `12px ${GUTTER}px calc(env(safe-area-inset-bottom, 0px) + 24px)`,
  boxSizing: "border-box",
  background: COLOR.bg,
};

const searchRowStyle: CSSProperties = { margin: "8px 0 12px" };

const searchInputStyle: CSSProperties = {
  width: "100%",
  height: "48px",
  padding: "0 16px",
  boxSizing: "border-box",
  borderRadius: "12px",
  border: `1px solid ${COLOR.border}`,
  background: COLOR.surface,
  color: COLOR.textBright,
  fontFamily: FONT.body,
  fontSize: "16px",
};

const menuItemStyle: CSSProperties = {
  minHeight: "56px",
  textAlign: "left",
  fontFamily: FONT.body,
  fontWeight: 600,
  fontSize: "18px",
  borderBottom: `1px solid ${COLOR.border}`,
  cursor: "pointer",
};

const accountRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20 };

const accountButtonStyle: CSSProperties = {
  minHeight: "48px",
  borderRadius: "12px",
  border: `1px solid ${COLOR.border}`,
  background: COLOR.surface,
  color: COLOR.textBright,
  fontFamily: FONT.body,
  fontSize: "15px",
  textAlign: "center",
  cursor: "pointer",
};
