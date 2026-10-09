import { useState, type CSSProperties } from "react";

import googleIcon from "@/assets/images/imgComponent1.svg";
import ConsentGroup from "@/components/form/ConsentGroup";
import InputLine, { type FieldBinding } from "@/components/form/InputLine";
import { hairlineStyle, inputBoxStyle } from "@/components/form/formStyles";
import SubmitButton, { Honeypot } from "@/components/form/SubmitButton";
import TextField, { LabelRow, PasswordStrength } from "@/components/form/TextField";
import RegionPicker from "@/components/RegionPicker";
import {
  BOT_SUSPECTED_MESSAGE,
  SIGNUP_DUPLICATE_CHECKS,
  submitOnEnter,
  useBotGuard,
  useConsents,
  useForm,
  useSubmitLock,
} from "@/hooks/useForm";
import { FONT } from "@/lib/style";
import { suggestEmailTypo, type FieldName } from "@/lib/validation";
import { ROUTES, useSiteNavigate } from "@/navigation/routes";
import { signUp } from "@/services/account/authApi";
import { signInWithGoogle } from "@/services/account/googleAuth";
import { startNaverLogin } from "@/services/account/naverAuth";
import { signIn, useSessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

import { signupPanelStyle, primaryButtonStyle, primaryLabelStyle } from "./quickSignupStyles";
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
  const [isGoogleBusy, setIsGoogleBusy] = useState(false);
  const { isSubmitting, run: runSubmit } = useSubmitLock();
  const [alertMessage, setAlertMessage] = useState("");
  const [isDone, setIsDone] = useState(false);

  // 구글은 팝업에서 끝난다 — 로그인되면 세션이 바뀌어 이 자리가 환영 판으로 바뀐다
  const handleGoogle = async () => {
    if (isGoogleBusy) return;
    setSocialMessage("");
    setIsGoogleBusy(true);
    try {
      signIn(await signInWithGoogle());
    } catch (error) {
      setSocialMessage((error instanceof Error && error.message) || "Google 로그인에 실패했습니다.");
    } finally {
      setIsGoogleBusy(false);
    }
  };

  const handleSubmit = () =>
    runSubmit(async () => {
      consent.markSubmitted();
      setAlertMessage("");
      try {
        const fieldsPassed = await form.validateAll();
        const consentPassed = consent.check();
        if (!fieldsPassed || !consentPassed) return;
        if (bot.isLikelyBot()) {
          setAlertMessage(BOT_SUSPECTED_MESSAGE);
          return;
        }

        const result = await signUp({
          email: values.email ?? "",
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

  return (
    <div style={signupPanelStyle}>
      <div style={{ position: "absolute", left: 0, right: 0, top: "64px", padding: "5px 0 3px" }}>
        <div style={titleStyle}>탈출을 시작하세요.</div>
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, top: "115px", padding: "1px 0 2px" }}>
        <div style={subtitleStyle}>계정을 만들고 전국의 방탈출 미션에 도전하세요.</div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "161px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <div style={{ display: "flex", gap: "12px", height: "73px", alignItems: "flex-start" }}>
          <TextField
            variant="home"
            label="닉네임"
            placeholder="모험가 이름"
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
          <div role="alert" style={{ fontFamily: FONT.mono, fontSize: "15px", lineHeight: 1.5, color: COLOR.danger }}>
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
          <button
            type="button"
            className="button"
            style={{ ...socialButtonStyle, background: COLOR.white, ...(isGoogleBusy ? busyStyle : {}) }}
            onClick={handleGoogle}
            title="Google 로 가입"
            aria-busy={isGoogleBusy}
          >
            <img
              loading="lazy"
              decoding="async"
              src={googleIcon}
              alt="Google"
              style={{ width: "17px", height: "17px", display: "block" }}
            />
          </button>
          <button
            type="button"
            className="button"
            style={{ ...socialButtonStyle, background: "#03c75a", borderColor: "#03c75a" }}
            onClick={() => setSocialMessage(startNaverLogin())}
            title="네이버로 가입"
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
            이미 모험가이신가요?&nbsp;
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

const subtitleStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 400,
  fontSize: "18px",
  color: COLOR.textMuted,
  whiteSpace: "nowrap",
};

// 구글 팝업이 떠 있는 동안 — 로그인 화면의 간편 로그인 단추와 같은 모양
const busyStyle: CSSProperties = { opacity: 0.65, cursor: "progress" };
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
