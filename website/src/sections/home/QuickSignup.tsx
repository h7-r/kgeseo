import { useCallback, useState, type CSSProperties } from "react";

import ConsentGroup from "@/components/form/ConsentGroup";
import InputLine, { type FieldBinding } from "@/components/form/InputLine";
import { hairlineStyle, inputBoxStyle } from "@/components/form/formStyles";
import SubmitButton, { Honeypot } from "@/components/form/SubmitButton";
import TextField, { LabelRow, PasswordStrength } from "@/components/form/TextField";
import RegionPicker from "@/components/RegionPicker";
import {
  BOT_SUSPECTED_MESSAGE,
  describeBlockedSubmit,
  revealAlert,
  SIGNUP_DUPLICATE_CHECKS,
  submitOnEnter,
  useBotGuard,
  useConsents,
  useForm,
  useInputAlert,
  useSubmitLock,
} from "@/hooks/useForm";
import { SCRIM_ATTR } from "@/lib/layout";
import { FONT } from "@/lib/style";
import { suggestEmailTypo, type FieldName } from "@/lib/validation";
import { ROUTES, useSiteNavigate } from "@/navigation/routes";
import { signUp } from "@/services/account/authApi";
import { startNaverLogin } from "@/services/account/naverAuth";
import { readOnboarding, type OnboardingRequired } from "@/services/account/socialAuthApi";
import { signIn, useSessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

import { signupFormPanelStyle, signupPanelStyle, primaryButtonStyle, primaryLabelStyle } from "./quickSignupStyles";
import GoogleButton from "../auth/GoogleButton";
import SocialOnboardingForm from "../auth/SocialOnboardingForm";
import WelcomePanel from "./WelcomePanel";

const FIELDS: readonly FieldName[] = ["nickname", "region", "email", "password", "passwordConfirm"];

/** 홈 소개 오른쪽의 빠른 가입 폼. 로그인한 사람에게는 환영 판을 보여 준다. */
export default function QuickSignup() {
  const navigate = useSiteNavigate();
  // 훅은 늘 같은 순서로 불려야 해서 환영 판 갈림은 모든 훅을 부른 뒤에 한다.
  const user = useSessionUser();
  const form = useForm({ fields: FIELDS, asyncChecks: SIGNUP_DUPLICATE_CHECKS });
  const { values } = form;
  const consent = useConsents();
  const bot = useBotGuard();
  const [socialMessage, setSocialMessage] = useState("");
  const { isSubmitting, run: runSubmit } = useSubmitLock();
  const [alertMessage, setAlertMessage] = useInputAlert([values, consent.consents]);
  const [isDone, setIsDone] = useState(false);
  // 처음 온 소셜 계정은 페이지를 옮기지 않고 이 자리에서 가입을 마친다.
  const [onboarding, setOnboarding] = useState<OnboardingRequired | null>(readOnboarding);
  const handleOnboardingEnded = useCallback((message: string) => {
    setOnboarding(null);
    setSocialMessage(message);
  }, []);

  const handleSubmit = () =>
    runSubmit(async () => {
      consent.markSubmitted();
      setAlertMessage("");
      try {
        const fieldErrors = await form.validateAll();
        const consentPassed = consent.check();
        if (Object.keys(fieldErrors).length > 0 || !consentPassed) {
          setAlertMessage(describeBlockedSubmit("회원가입", fieldErrors, consent.problem));
          return;
        }
        if (bot.isLikelyBot()) {
          setAlertMessage(BOT_SUSPECTED_MESSAGE);
          return;
        }

        const result = await signUp({
          // 화면 검사는 앞뒤 공백을 떼고 본다 — 서버에도 뗀 값을 보내야 같은 판정이 난다(회원가입 화면과 같다).
          email: (values.email ?? "").trim(),
          password: values.password ?? "",
          nickname: values.nickname,
          region: values.region,
          consents: consent.consents,
        });
        if (!result.ok) {
          setAlertMessage(result.reason);
          return;
        }
        // 비밀번호는 화면 상태에 남기지 않는다.
        form.clearFields(["password", "passwordConfirm"]);
        signIn(result.user);
        setIsDone(true);
      } catch {
        // 사생활 보호 모드처럼 IndexedDB 가 막혀 저장소가 던질 때. 저장소가 가입 실패에 쓰는 말과 같다.
        setAlertMessage("가입 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.");
      }
    });

  const bind = (name: FieldName): FieldBinding => ({ ...form.fieldProps(name), onEnter: submitOnEnter(handleSubmit) });
  const typo = suggestEmailTypo(values.email);
  const regionProps = form.fieldProps("region");

  // 가입을 막 끝낸 사람도 signIn 으로 로그인되므로 바로 환영 판으로 바뀐다.
  if (user) return <WelcomePanel user={user} />;
  if (onboarding) {
    return (
      <div style={signupPanelStyle} {...SCRIM_ATTR}>
        <SocialOnboardingForm onboarding={onboarding} variant="home" onDone={signIn} onEnded={handleOnboardingEnded} />
      </div>
    );
  }

  // 제목부터 로그인 줄까지 한 덩이로 쌓는다. 아랫선은 왼쪽 숫자 지표에 맞추고 위로 자란다.
  return (
    <div style={signupFormPanelStyle} {...SCRIM_ATTR}>
      <div style={{ paddingTop: "5px" }}>
        <div style={titleStyle}>탈출을 시작하세요.</div>
      </div>

      {/* 부제를 뺀 자리도 비워 둔다 — 제목과 입력 칸 사이 간격은 부제가 있을 때와 같다(부제 30 + 16). */}
      <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "46px" }}>
        <div style={{ display: "flex", gap: "12px", height: "73px", alignItems: "flex-start" }}>
          <TextField
            variant="home"
            label="닉네임"
            placeholder="이름"
            grow
            autoComplete="nickname"
            {...bind("nickname")}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "9px",
              flex: "1 0 0",
              minWidth: 0,
              alignSelf: "stretch",
            }}
          >
            <LabelRow label="지역" name="region" error={regionProps.error} />
            <RegionPicker
              value={values.region ?? ""}
              onSelect={(region) => form.setField("region", region)}
              onBlur={regionProps.onBlur}
              error={regionProps.error}
              isValid={regionProps.isValid}
              fieldStyle={{ ...inputBoxStyle.home, paddingRight: 0, paddingBottom: "9px" }}
            />
          </div>
        </div>

        <TextField
          variant="home"
          label="이메일"
          placeholder="explorer@escape.kr"
          paddingBottom={11}
          autoComplete="email"
          inputMode="email"
          typo={typo}
          onFixTypo={() => form.setField("email", typo.replace(/^혹시 | 인가요\?$/g, ""))}
          {...bind("email")}
        />

        <div style={{ position: "relative", height: "65px" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
            <LabelRow label="비밀번호" name="password" error={form.fieldProps("password").error} />
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: "20px" }}>
            <InputLine
              variant="home"
              placeholder="8자 이상"
              type="password"
              autoComplete="new-password"
              {...bind("password")}
            />
          </div>
          <PasswordStrength password={values.password} style={strengthBarStyle} />
        </div>

        <TextField
          variant="home"
          label="비밀번호 확인"
          placeholder="비밀번호 재입력"
          type="password"
          autoComplete="new-password"
          {...bind("passwordConfirm")}
        />

        <ConsentGroup
          variant="home"
          consents={consent.consents}
          allAgreed={consent.allAgreed}
          error={consent.error}
          onChange={consent.update}
        />

        <Honeypot value={bot.honeypot} onChange={bot.setHoneypot} />

        {alertMessage && (
          <div
            ref={revealAlert}
            role="alert"
            style={{
              whiteSpace: "pre-line",
              // 위에 고정된 머리글에 가리지 않게
              scrollMarginTop: "120px",
              fontFamily: FONT.mono,
              fontSize: "15px",
              lineHeight: 1.5,
              color: COLOR.danger,
            }}
          >
            {alertMessage}
          </div>
        )}

        <div style={{ paddingTop: "6px" }}>
          <SubmitButton
            label={isSubmitting ? "가입하는 중…" : isDone ? "가입 완료 ✓" : "모험 시작하기"}
            isBusy={isSubmitting}
            onClick={handleSubmit}
            style={primaryButtonStyle}
            labelStyle={primaryLabelStyle}
          />
        </div>

        <div style={{ padding: "4px 0" }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <div style={hairlineStyle} />
            <span
              style={{
                fontFamily: FONT.mono,
                fontSize: "16px",
                color: COLOR.textSubtle,
                letterSpacing: "0.9px",
                whiteSpace: "nowrap",
              }}
            >
              간편 가입
            </span>
            <div style={hairlineStyle} />
          </div>
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center", justifyContent: "center" }}>
          <GoogleButton
            onBusyChange={(busy) => {
              if (busy) setSocialMessage("");
            }}
            onResult={(result) => {
              // 구글은 창에서 끝난다 — 로그인되면 세션이 바뀌어 이 자리가 환영 판으로 바뀐다
              if (result.kind === "signedIn") {
                signIn(result.user);
                return;
              }
              // 처음 온 계정은 로그인시키지 않고 이 자리를 가입 마무리로 바꾼다. 증표는 메모리로만 둔다.
              setOnboarding(result.onboarding);
            }}
            onError={setSocialMessage}
          />
          <button
            type="button"
            className="button"
            style={{ ...socialButtonStyle, background: "#03c75a", borderColor: "#03c75a" }}
            onClick={() => setSocialMessage(startNaverLogin(ROUTES.home))}
            title="네이버로 가입 (네이버 화면으로 이동)"
            aria-label="네이버로 가입 (네이버 화면으로 이동)"
          >
            <span style={naverMarkStyle}>N</span>
          </button>
          <span
            style={{
              fontFamily: FONT.mono,
              fontSize: "16px",
              color: COLOR.textSubtle,
              letterSpacing: "0.6px",
              whiteSpace: "nowrap",
            }}
          >
            이미 계정이 있으신가요?&nbsp;
          </span>
          <button type="button" className="text-link" onClick={() => navigate(ROUTES.login)} style={loginLinkStyle}>
            로그인
          </button>
        </div>
        {socialMessage && (
          <div style={{ fontFamily: FONT.mono, fontSize: "15px", color: COLOR.textMuted, textAlign: "center" }}>
            {socialMessage}
          </div>
        )}
      </div>
    </div>
  );
}

const strengthBarStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  top: "63px",
  justifyContent: "center",
};

const titleStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontWeight: 700,
  fontSize: "36px",
  color: "#f2f1fc",
  letterSpacing: "1.05px",
  whiteSpace: "nowrap",
};

// 구글 팝업이 떠 있는 동안 — 로그인 화면의 간편 로그인 단추와 같은 모양
const socialButtonStyle: CSSProperties = {
  width: "44px",
  height: "44px",
  borderRadius: "22px",
  background: "rgba(46,72,137,0.08)",
  border: "1px solid rgba(79,108,176,0.3)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};

const naverMarkStyle: CSSProperties = {
  fontFamily: "'Inter', system-ui, sans-serif",
  fontWeight: 800,
  fontSize: "18px",
  lineHeight: 1,
  color: "#fff",
  letterSpacing: "-0.5px",
};

const loginLinkStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "16px",
  color: COLOR.accent,
  letterSpacing: "0.6px",
  whiteSpace: "nowrap",
  cursor: "pointer",
};
