import type { CSSProperties } from "react";

import { startNaverLogin } from "@/services/account/naverAuth";
import { isNaverLoginOpen, NAVER_LOGIN_PENDING_MESSAGE } from "@/services/account/naverLoginGate";
import { COLOR } from "@/styles/tokens";

interface NaverButtonProps {
  /** 네이버에서 돌아온 뒤 갈 곳. 없으면 기본 경로. */
  returnTo: string | null;
  /** 단추 아래에 보일 안내. 네이버로 떠나면 "" 가 온다. */
  onMessage: (message: string) => void;
  /** 「로그인」 화면과 「가입」 화면의 말이 다르다. */
  action: "로그인" | "가입";
}

/**
 * 네이버 단추. 열려 있으면 네이버 인가 화면으로 보내고, 검수 전(닫힘)이면 회색 「준비 중」으로 서서
 * 누르면 까닭만 알려 준다. 열림·닫힘은 naverLoginGate 가 정한다.
 */
export default function NaverButton({ returnTo, onMessage, action }: NaverButtonProps) {
  const isOpen = isNaverLoginOpen();
  const label = isOpen ? `네이버로 ${action} (네이버 화면으로 이동)` : `네이버로 ${action} · 준비 중`;

  const handleClick = () => {
    onMessage(isOpen ? startNaverLogin(returnTo) : NAVER_LOGIN_PENDING_MESSAGE);
  };

  return (
    <button
      type="button"
      className="button"
      style={isOpen ? openStyle : pendingStyle}
      onClick={handleClick}
      title={label}
      aria-label={label}
      aria-disabled={isOpen ? undefined : true}
    >
      <span style={markStyle}>N</span>
    </button>
  );
}

const baseStyle: CSSProperties = {
  width: "44px",
  height: "44px",
  borderRadius: "22px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  cursor: "pointer",
};
// 초록 바탕에 흰 굵은 N 이 네이버 공식 모양이다.
const openStyle: CSSProperties = { ...baseStyle, background: "#03c75a", border: "1px solid #03c75a" };
// 준비 중에는 색을 빼고 흐리게 — 눌리긴 하되 안내만 나온다.
const pendingStyle: CSSProperties = {
  ...baseStyle,
  background: "rgba(46,72,137,0.08)",
  border: "1px solid rgba(79,108,176,0.3)",
  opacity: 0.55,
  cursor: "default",
};
const markStyle: CSSProperties = {
  fontFamily: "'Inter', system-ui, sans-serif",
  fontWeight: 800,
  fontSize: "19px",
  lineHeight: 1,
  color: COLOR.white,
  letterSpacing: "-0.5px",
  transform: "translateY(-0.5px)",
};
