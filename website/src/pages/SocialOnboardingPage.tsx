import { useCallback, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { FONT } from "@/lib/style";
import { ROUTES } from "@/navigation/routes";
import AuthStage from "@/sections/auth/AuthStage";
import SocialOnboardingForm from "@/sections/auth/SocialOnboardingForm";
import { useTermsAnchor } from "@/sections/auth/useTermsAnchor";
import { ONBOARDING_RESTART_MESSAGE, readOnboarding } from "@/services/account/socialAuthApi";
import { signIn, type SessionUser } from "@/services/session";
import { COLOR, surfaceFillStyle } from "@/styles/tokens";

/** 로그인 화면에서 온 소셜 가입 마무리. 증표는 메모리에서만 받아 새로고침하면 로그인부터 다시 한다. */
export default function SocialOnboardingPage() {
  const navigate = useNavigate();
  const [onboarding] = useState(readOnboarding);
  // 끝난 화면의 문구. 증표가 없거나 만료·사용됨이면 로그인부터 다시 하게 한다.
  const [endedMessage, setEndedMessage] = useState(onboarding ? "" : ONBOARDING_RESTART_MESSAGE);
  const terms = useTermsAnchor();

  const handleDone = (user: SessionUser) => {
    signIn(user);
    navigate(onboarding?.returnTo ?? ROUTES.home, { replace: true });
  };
  const handleEnded = useCallback((message: string) => setEndedMessage(message), []);

  return (
    <AuthStage terms={terms}>
      {!onboarding || endedMessage ? (
        <section style={{ ...cardStyle, alignItems: "center", textAlign: "center" }}>
          <h1 style={titleStyle}>소셜 가입</h1>
          <p style={subtitleStyle}>{endedMessage || ONBOARDING_RESTART_MESSAGE}</p>
          <button type="button" style={backButtonStyle} onClick={() => navigate(ROUTES.login, { replace: true })}>
            로그인으로 돌아가기
          </button>
        </section>
      ) : (
        <section style={cardStyle}>
          <SocialOnboardingForm
            onboarding={onboarding}
            variant="card"
            onShowTerms={terms.showTerms}
            onDone={handleDone}
            onEnded={handleEnded}
          />
        </section>
      )}
    </AuthStage>
  );
}

const cardStyle: CSSProperties = {
  width: "593px",
  // 로그인·회원가입 카드와 같은 자리·같은 높이로 둔다.
  minHeight: "800px",
  padding: "48px 24px",
  borderRadius: "16px",
  ...surfaceFillStyle,
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  boxShadow: "0px 8px 32px 0px rgba(47,62,112,0.13)",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  alignItems: "flex-start",
  boxSizing: "border-box",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.display,
  fontWeight: 700,
  fontSize: "36px",
  color: COLOR.textBright,
};

const subtitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.body,
  fontSize: "18px",
  lineHeight: 1.6,
  color: COLOR.textMuted,
};

const backButtonStyle: CSSProperties = {
  border: "1px solid rgba(111,134,191,0.55)",
  borderRadius: "999px",
  padding: "12px 20px",
  background: "rgba(50,82,150,0.14)",
  color: COLOR.textBright,
  fontFamily: FONT.mono,
  fontSize: "15px",
  cursor: "pointer",
};
