/**
 * 모바일 「게임 시작」 사전 안내 시트 — 가로 플레이 · 첫 다운로드 · 소리 · 앱 안 브라우저(계획서 5.4).
 * 세로면 「시작하기」를 막고 「가로로 돌리면 시작」을 보인다 — 게임 첫 로딩부터 가로로 들어가게(11/7 미르).
 * 확인하면 PC 의 전환막(GameTransition, 사이트에서 오프닝 2.6초)을 거치지 않고 게임 문서로 바로 옮긴다(?transition=0).
 * 게임이 오프닝을 처음부터, 첫 탭 안에서 소리와 함께 튼다 — 문서를 옮기면 전체 화면이 풀리고 새 문서엔 몸짓이 없어서,
 * 첫 탭 · 소리 · 전체 화면을 게임 한곳이 맡는 편이 단순하다(코덱스 13회차).
 * 주소 복사는 실제 클릭 안에서 clipboard 로 하고, 성공했을 때만 「복사했습니다」. 실패하면 주소를 골라 복사할 수 있게 보여 준다.
 * 복사하는 주소는 로그인부터 다시 시작하는 주소다(소셜 로그인 증표는 브라우저를 옮기면 이어지지 않는다).
 */
import { useEffect, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { FONT } from "@/lib/style";
import { GAME_TRANSITION_PARAM, ROUTES } from "@/navigation/routes";
import { COLOR } from "@/styles/tokens";

import { closeGameStartGuide, useGameStartGuide } from "./gameStartStore";
import InAppNotice from "./InAppNotice";
import { GUTTER, primaryButtonStyle, safeBottom, secondaryButtonStyle } from "./mobileStyles";
import { useIsPortrait } from "./orientation";

export default function GameStartGuide() {
  const url = useGameStartGuide();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isPortrait = useIsPortrait();
  const [isLeaving, setIsLeaving] = useState(false);

  // 게임에서 뒤로 오면 bfcache 가 「이동하는 중」으로 얼려 둔 시트를 보여 준다 — 알아채면 닫는다.
  // 로그인 뒤 /play 에서 떠났다면 「게임으로 이동하고 있습니다」 중간 화면에 남지 않게 홈으로(취소와 같다, 코덱스 13b회차)
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setIsLeaving(false);
      closeGameStartGuide();
      if (pathname === ROUTES.play) navigate(ROUTES.home, { replace: true });
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [pathname, navigate]);

  if (!url) return null;
  const isStartDisabled = isPortrait || isLeaving;

  return (
    <div style={backdropStyle} role="dialog" aria-modal="true" aria-label="게임 시작 안내">
      <div style={sheetStyle}>
        <h2 style={titleStyle}>휴대폰으로 시작하기</h2>
        <ul style={listStyle}>
          <li>
            휴대폰을 <b>가로로</b> 돌려서 플레이합니다.
          </li>
          <li>
            처음 한 번 3D 파일을 받습니다. 용량이 커서 <b>Wi-Fi</b>를 권장합니다.
          </li>
          <li>아이폰은 무음 스위치를 켜 두면 소리가 나지 않습니다.</li>
          <li>진행은 로그인한 계정에 저장되어 PC에서도 이어 할 수 있습니다.</li>
        </ul>

        <div style={{ marginTop: 14 }}>
          <InAppNotice />
        </div>

        <div style={actionsStyle}>
          <button
            type="button"
            style={{ ...secondaryButtonStyle, flex: 1 }}
            onClick={() => {
              closeGameStartGuide();
              // 로그인 뒤 /play 로 돌아와 안내가 뜬 경우 — 「이동하고 있습니다」 화면에 남지 않게 홈으로
              if (pathname === ROUTES.play) navigate(ROUTES.home, { replace: true });
            }}
          >
            취소
          </button>
          <button
            type="button"
            style={{
              ...primaryButtonStyle,
              flex: 2,
              opacity: isStartDisabled ? 0.55 : 1,
              cursor: isStartDisabled ? "default" : "pointer",
            }}
            disabled={isStartDisabled}
            onClick={() => {
              setIsLeaving(true);
              const next = new URL(url);
              next.searchParams.set(GAME_TRANSITION_PARAM, "0");
              window.location.assign(next.href);
            }}
          >
            {isLeaving ? "이동하는 중…" : isPortrait ? "⟲ 가로로 돌리면 시작" : "시작하기"}
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

const titleStyle: CSSProperties = { margin: 0, fontFamily: FONT.display, fontSize: "24px", color: COLOR.textBright };

const listStyle: CSSProperties = {
  margin: "12px 0 0",
  paddingLeft: "18px",
  display: "grid",
  gap: 6,
  fontFamily: FONT.body,
  fontSize: "15px",
  lineHeight: 1.55,
  color: COLOR.textMuted,
};

const actionsStyle: CSSProperties = { display: "flex", gap: 10, marginTop: 18 };
