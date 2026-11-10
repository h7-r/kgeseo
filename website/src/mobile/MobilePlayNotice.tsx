/**
 * 「모바일 버전 준비 중」 안내 시트 — 모바일 배치(손가락 기기)에서 플레이 단추를 누르면 게임 대신 이것을 띄운다(미르 11/10).
 * 사이트 둘러보기 · 로그인 · 가입은 막지 않는다 — 로그인하지 않았으면 로그인으로 가는 단추를 함께 둔다(PC 에서 같은 계정으로 이어 하게).
 * 모양은 게임 시작 안내(GameStartGuide)와 같은 바닥 시트. 준비되면 gameStartStore 의 IS_MOBILE_PLAY_READY 를 켠다.
 * 공용 Modal 대신 시트를 쓴다 — Modal 의 닫기(×)는 32px 로 손가락 기기 기준 44 보다 작다. 초점 · Esc · Tab 가두기는 Modal 과 같게(Codex 리뷰 11/10).
 */
import { useEffect, useEffectEvent, useRef, type CSSProperties } from "react";
import { useMatch, useNavigate } from "react-router-dom";

import { FONT } from "@/lib/style";
import { ROUTES } from "@/navigation/routes";
import { useSessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

import { closeMobilePlayNotice, useMobilePlayNotice } from "./gameStartStore";
import { GUTTER, primaryButtonStyle, safeBottom, secondaryButtonStyle } from "./mobileStyles";

const TITLE_ID = "mobile-play-notice-title";

export default function MobilePlayNotice() {
  const isOpen = useMobilePlayNotice();
  const user = useSessionUser();
  const navigate = useNavigate();
  // 라우터와 같은 기준으로 /play 를 본다(/play/ · /PLAY 도 PlayRedirect 다)
  const isPlayRoute = useMatch(ROUTES.play) !== null;
  const sheetRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    closeMobilePlayNotice();
    // 로그인 뒤 /play 로 돌아와 안내가 뜬 경우 — 「게임으로 이동하고 있습니다」 화면에 남지 않게 홈으로
    if (isPlayRoute) navigate(ROUTES.home, { replace: true });
  };
  const handleClose = useEffectEvent(close);

  // 열리면 「확인」에 초점, Esc 로 닫기, Tab 은 시트 안에서만 돈다. 닫히면 누른 단추로 초점을 돌려준다
  useEffect(() => {
    if (!isOpen) return undefined;
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() => confirmRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
        return;
      }
      const sheet = sheetRef.current;
      if (event.key !== "Tab" || !sheet) return;
      const buttons = [...sheet.querySelectorAll<HTMLElement>("button")];
      if (!buttons.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!sheet.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div style={backdropStyle} role="dialog" aria-modal="true" aria-labelledby={TITLE_ID}>
      <div ref={sheetRef} style={sheetStyle}>
        <h2 id={TITLE_ID} style={titleStyle}>
          모바일 버전 준비 중입니다
        </h2>
        <p style={bodyStyle}>
          지금은 <b style={strongStyle}>PC</b>에서만 플레이할 수 있습니다.
        </p>
        <p style={bodyStyle}>
          PC 브라우저에서 <b style={strongStyle}>{window.location.host}</b>에 접속해 같은 계정으로 로그인하면 바로
          시작할 수 있습니다.
        </p>

        <div style={actionsStyle}>
          {!user && (
            <button
              type="button"
              style={{ ...secondaryButtonStyle, flex: 1 }}
              onClick={() => {
                closeMobilePlayNotice();
                navigate(ROUTES.login);
              }}
            >
              로그인
            </button>
          )}
          <button ref={confirmRef} type="button" style={{ ...primaryButtonStyle, flex: user ? 1 : 2 }} onClick={close}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  background: "rgba(1,4,10,0.7)",
};

const sheetStyle: CSSProperties = {
  width: "100%",
  maxWidth: "560px",
  maxHeight: "92dvh",
  overflowY: "auto",
  padding: `22px ${GUTTER}px ${safeBottom(20)}`,
  boxSizing: "border-box",
  borderRadius: "20px 20px 0 0",
  background: COLOR.surface,
  borderTop: `1px solid ${COLOR.border}`,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.display,
  fontSize: "24px",
  lineHeight: 1.3,
  color: COLOR.textBright,
  wordBreak: "keep-all",
};

const bodyStyle: CSSProperties = {
  margin: "10px 0 0",
  fontFamily: FONT.body,
  fontSize: "15px",
  lineHeight: 1.55,
  color: COLOR.textMuted,
  wordBreak: "keep-all",
  overflowWrap: "anywhere",
};

const strongStyle: CSSProperties = { color: COLOR.textBright };

const actionsStyle: CSSProperties = { display: "flex", gap: 10, marginTop: 18 };
