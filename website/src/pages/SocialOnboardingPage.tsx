import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import ConsentGroup from "@/components/form/ConsentGroup";
import SubmitButton, { Honeypot } from "@/components/form/SubmitButton";
import TextField from "@/components/form/TextField";
import { BOT_SUSPECTED_MESSAGE, submitOnEnter, useBotGuard, useConsents, useSubmitLock } from "@/hooks/useForm";
import { checkNickname } from "@/lib/nicknamePolicy";
import { FONT } from "@/lib/style";
import { MAX_LENGTH, normalizeInput } from "@/lib/validation";
import { ROUTES } from "@/navigation/routes";
import {
  BackendAuthError,
  ONBOARDING_RESTART_MESSAGE,
  clearOnboarding,
  completeSocialOnboarding,
  onboardingFailure,
  readOnboarding,
} from "@/services/account/socialAuthApi";
import { signIn } from "@/services/session";
import { COLOR, GRADIENT, SHADOW, surfaceFillStyle } from "@/styles/tokens";

const PROVIDER_LABEL = { google: "Google", naver: "네이버" } as const;

/** 처음 온 소셜 계정의 가입 마무리. 증표는 메모리에서만 받아 새로고침하면 로그인부터 다시 한다. */
export default function SocialOnboardingPage() {
  const navigate = useNavigate();
  const [onboarding] = useState(readOnboarding);
  // 안내에 쓰는 남은 분. 화면을 열 때 한 번만 센다 — 끝나는 순간은 아래 타이머가 따로 잡는다.
  const [minutesLeft] = useState(() =>
    onboarding ? Math.max(1, Math.ceil((onboarding.expiresAt - Date.now()) / 60_000)) : 0,
  );
  // 끝난 화면의 문구. 증표가 없거나 만료·사용됨이면 로그인부터 다시 하게 한다.
  const [endedMessage, setEndedMessage] = useState(onboarding ? "" : ONBOARDING_RESTART_MESSAGE);
  const [nickname, setNickname] = useState(onboarding?.suggestedNickname ?? "");
  const [isNicknameTouched, setIsNicknameTouched] = useState(false);
  const [serverNicknameError, setServerNicknameError] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const consent = useConsents();
  const bot = useBotGuard();
  const { isSubmitting, run: runSubmit } = useSubmitLock();

  const end = (message: string) => {
    clearOnboarding();
    setEndedMessage(message);
  };

  // 증표가 끝나는 순간 화면도 끝낸다. 늦게 눌러 서버에서 거절당하기 전에 알려 준다.
  useEffect(() => {
    if (!onboarding) return;
    const timer = window.setTimeout(
      () => {
        clearOnboarding();
        setEndedMessage(ONBOARDING_RESTART_MESSAGE);
      },
      Math.max(0, onboarding.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [onboarding]);

  // 회원가입과 같은 규칙(형식·예약어·금칙어). 쓸 수 있는지(중복)는 서버만 안다.
  const formatError = checkNickname(nickname);
  const isNicknameShown = isNicknameTouched || submitted;
  const nicknameError = isNicknameShown ? formatError || serverNicknameError : "";

  const handleSubmit = () =>
    runSubmit(async () => {
      if (!onboarding || endedMessage) return;
      consent.markSubmitted();
      setSubmitted(true);
      setAlertMessage("");
      const consentPassed = consent.check();
      if (formatError || !consentPassed) return;
      if (bot.isLikelyBot()) {
        setAlertMessage(BOT_SUSPECTED_MESSAGE);
        return;
      }
      if (Date.now() >= onboarding.expiresAt) {
        end(ONBOARDING_RESTART_MESSAGE);
        return;
      }
      try {
        const user = await completeSocialOnboarding(onboarding, nickname.normalize("NFKC").trim(), consent.consents);
        clearOnboarding();
        signIn(user);
        navigate(onboarding.returnTo ?? ROUTES.home, { replace: true });
      } catch (error) {
        const failure = onboardingFailure(error instanceof BackendAuthError ? error : new BackendAuthError(null));
        if (failure.action === "restart") end(failure.message);
        // 닉네임 문제는 증표를 그대로 두고 같은 화면에서 다시 고르게 한다.
        else if (failure.action === "nickname") setServerNicknameError(failure.message);
        else setAlertMessage(failure.message);
      }
    });

  if (!onboarding || endedMessage) {
    return (
      <main style={frameStyle}>
        <section style={{ ...cardStyle, alignItems: "center", textAlign: "center" }}>
          <h1 style={titleStyle}>소셜 가입</h1>
          <p style={subtitleStyle}>{endedMessage || ONBOARDING_RESTART_MESSAGE}</p>
          <button type="button" style={backButtonStyle} onClick={() => navigate(ROUTES.login, { replace: true })}>
            로그인으로 돌아가기
          </button>
        </section>
      </main>
    );
  }

  return (
    <main style={frameStyle}>
      <section style={cardStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
          <h1 style={titleStyle}>가입 마무리</h1>
          <p style={subtitleStyle}>
            {PROVIDER_LABEL[onboarding.provider]} 계정으로 처음 오셨네요. 닉네임을 정하고 약관에 동의하면 가입이
            끝납니다.
          </p>
          <p style={noticeStyle}>{minutesLeft}분 안에 마쳐 주세요. 시간이 지나면 소셜 로그인부터 다시 해야 합니다.</p>
        </div>

        <TextField
          variant="card"
          label="닉네임"
          placeholder="모험가 이름"
          autoComplete="nickname"
          name="nickname"
          value={nickname}
          maxLength={MAX_LENGTH.nickname}
          onChange={(event) => {
            setNickname(normalizeInput(event.target.value).slice(0, MAX_LENGTH.nickname));
            setServerNicknameError("");
          }}
          onBlur={() => {
            if (nickname) setIsNicknameTouched(true);
          }}
          onEnter={submitOnEnter(handleSubmit)}
          error={nicknameError}
          isValid={isNicknameShown && !formatError && !serverNicknameError}
          isChecking={false}
        />

        <ConsentGroup
          variant="card"
          consents={consent.consents}
          allAgreed={consent.allAgreed}
          error={consent.error}
          onChange={consent.update}
        />

        <Honeypot value={bot.honeypot} onChange={bot.setHoneypot} />

        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "14px" }}>
          {alertMessage && (
            <div style={alertStyle} role="alert">
              {alertMessage}
            </div>
          )}
          <SubmitButton
            label={isSubmitting ? "확인하는 중…" : "가입 완료"}
            isBusy={isSubmitting}
            onClick={handleSubmit}
            style={submitButtonStyle}
            labelStyle={submitLabelStyle}
          />
        </div>
      </section>
    </main>
  );
}

const frameStyle: CSSProperties = {
  minHeight: "70vh",
  display: "grid",
  placeItems: "center",
  padding: "140px 16px 80px",
  boxSizing: "border-box",
};

const cardStyle: CSSProperties = {
  width: "min(593px, 100%)",
  padding: "48px 24px 32px",
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

const noticeStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.mono,
  fontSize: "14px",
  color: COLOR.textSubtle,
};

const alertStyle: CSSProperties = {
  fontSize: "16px",
  lineHeight: 1.5,
  color: COLOR.danger,
  padding: "10px 14px",
  borderRadius: "10px",
  background: "rgba(248,113,113,0.08)",
  border: "1px solid rgba(248,113,113,0.3)",
};

const submitButtonStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  padding: "15px 24px",
  borderRadius: "100px",
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  backgroundImage: GRADIENT.navyButton("166.833deg"),
  boxShadow: SHADOW.pillGlowWide,
};

const submitLabelStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  color: COLOR.white,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
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
