/**
 * 홈 히어로 위 한 번짜리 안내 — 휴대폰에서 가입을 막 마치고 왔을 때만(signedUpState.ts).
 * 닫으면 라우터 state 를 비워 뒤로 · 앞으로 와도 다시 뜨지 않는다.
 */
import type { CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

import { IS_MOBILE_PLAY_READY } from "./gameStartStore";
import { isSignedUpState } from "./signedUpState";

export default function SignedUpNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  if (!isSignedUpState(location.state)) return null;

  const dismiss = () => navigate(`${location.pathname}${location.search}`, { replace: true, state: null });

  return (
    <div role="status" style={noticeStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={titleStyle}>가입을 마쳤습니다</strong>
        <p style={bodyStyle}>
          {IS_MOBILE_PLAY_READY
            ? "휴대폰을 가로로 돌린 뒤 「플레이하기」를 누르면 게임이 시작됩니다."
            : "모바일 버전은 준비 중입니다. PC에서 같은 계정으로 로그인하면 바로 시작할 수 있습니다."}
        </p>
      </div>
      <button type="button" aria-label="안내 닫기" style={closeStyle} onClick={dismiss}>
        ✕
      </button>
    </div>
  );
}

const noticeStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  marginBottom: 20,
  padding: "12px 6px 12px 14px",
  borderRadius: 12,
  background: COLOR.surface,
  border: `1px solid ${COLOR.border}`,
};

const titleStyle: CSSProperties = {
  display: "block",
  fontFamily: FONT.body,
  fontSize: "15px",
  fontWeight: 700,
  color: COLOR.textBright,
};

const bodyStyle: CSSProperties = {
  margin: "4px 0 0",
  fontFamily: FONT.body,
  fontSize: "14px",
  lineHeight: 1.5,
  color: COLOR.textMuted,
  wordBreak: "keep-all",
};

const closeStyle: CSSProperties = {
  flexShrink: 0,
  width: 44,
  height: 44,
  marginTop: -8,
  border: "none",
  background: "transparent",
  color: COLOR.textMuted,
  fontSize: "16px",
  cursor: "pointer",
};
