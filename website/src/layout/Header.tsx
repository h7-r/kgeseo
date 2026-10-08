import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { preloadRoute } from "@/app/pageRegistry";
import { registerProximity } from "@/hooks/proximity";
import { HEADER_HEIGHT } from "@/lib/layout";
import { FONT, gradientText } from "@/lib/style";
import { HEADER_MENU, ROUTES, type RoutePath } from "@/navigation/routes";
import type { SessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

import HeaderSearch from "./HeaderSearch";

export type HeaderMenuId = (typeof HEADER_MENU)[number]["id"];

const MENU_FONT_SIZE = 19;
const UNDERLINE_WIDTH = 34;
const PILL_FONT_SIZE = 18;

interface HeaderProps {
  activeId: HeaderMenuId;
  user: SessionUser | null;
  onAccountClick: () => void;
  onSignOut: () => void;
  onSearch: (query: string) => void;
  onMenuNavigate: (path: RoutePath) => void;
}

type MenuPositions = Partial<Record<HeaderMenuId, { left: number; width: number }>>;

/**
 * 머리띠. 메뉴는 모든 페이지에서 여섯 항목이 같아야 밑줄이 옮겨 갈 자리가 있다.
 * 밑줄은 하나만 두고 켜진 항목 아래로 미끄러뜨린다.
 */
function Header({ activeId, user, onAccountClick, onSignOut, onSearch, onMenuNavigate }: HeaderProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Partial<Record<HeaderMenuId, HTMLButtonElement | null>>>({});
  // 애니메이션이 끝나면 꺼야 다음에 눌렀을 때 다시 돈다.
  const [isSweeping, setIsSweeping] = useState(false);
  const [positions, setPositions] = useState<MenuPositions | null>(null);

  // 메뉴 자리는 페이지가 바뀌어도 그대로라 처음·크기 변화·글꼴 도착 때만 잰다.
  // 페이지 전환 때 재면 새 페이지 전체의 배치를 억지로 계산시킨다.
  // 처음 한 번은 그리기 전에 재야 첫 장에 밑줄이 함께 그려진다. 늦추면 직접 들어온 페이지의 LCP 가 늦어진다.
  useLayoutEffect(() => {
    const measure = () => {
      const next: MenuPositions = {};
      for (const { id } of HEADER_MENU) {
        const el = itemRefs.current[id];
        if (el) next[id] = { left: el.offsetLeft, width: el.offsetWidth };
      }
      setPositions((previous) =>
        previous &&
        HEADER_MENU.every(({ id }) => previous[id]?.left === next[id]?.left && previous[id]?.width === next[id]?.width)
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (rowRef.current) observer.observe(rowRef.current);
    document.fonts?.ready?.then(measure);
    return () => observer.disconnect();
  }, []);

  const activePosition = positions?.[activeId];
  const underlineLeft = activePosition ? activePosition.left + (activePosition.width - UNDERLINE_WIDTH) / 2 : null;

  return (
    <nav style={navStyle}>
      <button
        type="button"
        onClick={() => {
          setIsSweeping(true);
          onMenuNavigate(ROUTES.home);
        }}
        onAnimationEnd={() => setIsSweeping(false)}
        aria-label="홈으로"
        className={isSweeping ? "logo-sweep" : "logo-flow"}
        style={logoStyle}
      >
        latent-Space
      </button>

      <div ref={rowRef} style={menuRowStyle}>
        {HEADER_MENU.map(({ id, label, path }) => {
          const active = id === activeId;
          return (
            <button
              key={id}
              type="button"
              ref={(el) => {
                itemRefs.current[id] = el;
                registerProximity(el, 150);
              }}
              aria-current={active ? "page" : undefined}
              className="link proximity-text"
              style={{
                ...menuItemStyle,
                color: active ? "#4f6cb0" : COLOR.white,
                textShadow: active ? "0px 0px 8px rgba(46, 72, 137, 0.7)" : undefined,
              }}
              onClick={() => onMenuNavigate(path)}
              // 누르기까지 보통 0.1~0.3초 — 그 사이 화면 코드를 받아 둔다.
              onPointerEnter={() => void preloadRoute(path)}
            >
              {label}
            </button>
          );
        })}

        {underlineLeft != null && (
          <div style={{ ...underlineStyle, transform: `translate3d(${underlineLeft}px, 0, 0)` }} />
        )}
      </div>

      <div style={rightGroupStyle}>
        <HeaderSearch size={22} onSubmit={onSearch} />
        <button
          type="button"
          className="btn"
          style={pillStyle}
          onClick={onAccountClick}
          title={user ? `${user.name} 님 · 마이페이지` : undefined}
          aria-label={user ? `${user.name} 님, 마이페이지로 이동` : undefined}
        >
          {user ? (
            <span className="btn__label" style={userLabelStyle}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                aria-hidden="true"
                style={{ flexShrink: 0, opacity: 0.85 }}
              >
                <circle cx="8" cy="5.2" r="2.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M2.6 14c.6-2.9 2.8-4.4 5.4-4.4s4.8 1.5 5.4 4.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <span style={{ fontWeight: 700 }}>{user.name}</span>
              {/* 한글 글자 몸이 영문 대문자보다 커서 같은 크기면 「님」이 더 커 보인다. */}
              <span style={{ fontWeight: 500, opacity: 0.8, fontSize: "0.88em" }}>님</span>
            </span>
          ) : (
            <span className="btn__label">로그인 · 회원가입</span>
          )}
        </button>
        {user && (
          <button
            type="button"
            className="link"
            onClick={(event) => {
              event.stopPropagation();
              onSignOut();
            }}
            style={signOutStyle}
          >
            로그아웃
          </button>
        )}
      </div>
    </nav>
  );
}

// HeaderLayer 의 useCallback 과 짝 — 스크롤 문턱마다 머리띠가 다시 그려져도 메뉴는 건너뛴다.
export default memo(Header);

const navStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "1920px",
  height: `${HEADER_HEIGHT}px`,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 80px",
  // 뒤 흐림은 스크롤마다 GPU 를 크게 먹어 빼고, 대신 조금 더 짙게 칠한다.
  background: "rgba(1, 4, 10, 0.88)",
  borderBottom: "1px solid rgba(150, 163, 182, 0.45)",
  boxShadow: "0 1px 0 0 rgba(50,82,150,0.12), 0 6px 18px -8px rgba(0,0,0,0.9)",
  boxSizing: "border-box",
  zIndex: 10,
};

const logoStyle: CSSProperties = {
  cursor: "pointer",
  fontFamily: FONT.mono,
  fontWeight: 700,
  lineHeight: "normal",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  // 흰→남→흰 한 주기를 2배 폭으로 깔아 100% 밀 때마다 같은 모습으로 이어진다.
  ...gradientText("linear-gradient(90deg, #f4f6fc 0%, #4a68ae 30%, #f4f6fc 50%, #4a68ae 80%, #f4f6fc 100%)"),
  backgroundSize: "200% 100%",
  backgroundPosition: "0% 50%",
  fontSize: "32px",
};

const menuRowStyle: CSSProperties = { position: "relative", display: "flex", gap: "48px", alignItems: "center" };

const menuItemStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 400,
  lineHeight: "normal",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  letterSpacing: "1px",
  transition: "color .18s ease",
  fontSize: `${MENU_FONT_SIZE}px`,
  cursor: "pointer",
};

// left 대신 transform 으로 옮긴다 — 배치를 다시 재지 않고 합성 단계에서만 움직인다.
const underlineStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: "calc(100% + 8px)",
  width: `${UNDERLINE_WIDTH}px`,
  height: "2px",
  borderRadius: "1px",
  background: "linear-gradient(90deg, #2e4889 0%, #395ca7 100%)",
  transition: "transform .42s var(--ease-smooth)",
  willChange: "transform",
  pointerEvents: "none",
};

const rightGroupStyle: CSSProperties = {
  display: "flex",
  gap: "20px",
  alignItems: "center",
  border: `1px solid ${COLOR.black}`,
};

const signOutStyle: CSSProperties = {
  padding: "0 2px",
  marginLeft: "12px",
  fontFamily: FONT.mono,
  fontSize: "16px",
  color: COLOR.textSubtle,
  whiteSpace: "nowrap",
  cursor: "pointer",
};

// 모노 글꼴엔 한글이 없어 닉네임과 「님」이 다른 글꼴로 그려지므로 본문 글꼴 하나로 맞추고 대문자 변환을 끈다.
const userLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  fontFamily: FONT.body,
  textTransform: "none",
  letterSpacing: "0.2px",
};

const pillStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 700,
  lineHeight: "normal",
  color: COLOR.white,
  textTransform: "uppercase",
  whiteSpace: "pre",
  padding: "11px 26px",
  borderRadius: "22px",
  border: "0.5px solid #284176",
  background: "linear-gradient(90deg, #2f427b 0%, #2f3e70 100%)",
  boxShadow: "0px 0px 32px 0px rgba(50,82,150,0.19), 0px 4px 16px 0px rgba(46,72,137,0.38)",
  fontSize: `${PILL_FONT_SIZE}px`,
  cursor: "pointer",
};
