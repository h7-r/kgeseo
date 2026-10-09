import { useState, type CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import ConsentGroup from "@/components/form/ConsentGroup";
import InputLine, { type FieldBinding } from "@/components/form/InputLine";
import { hairlineStyle, inputBoxStyle } from "@/components/form/formStyles";
import SubmitButton, { Honeypot } from "@/components/form/SubmitButton";
import TextField, { LabelRow, PasswordStrength } from "@/components/form/TextField";
import RegionPicker from "@/components/RegionPicker";
import type { TermsTabId } from "@/data/terms";
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
import { QUERY, ROUTES, safeNextPath, withQuery, type RoutePath } from "@/navigation/routes";
import type { AuthMode } from "@/pages/AuthPage";
import { authenticate, signUp } from "@/services/account/authApi";
import { TEST_ACCOUNT_ENABLED, TEST_ACCOUNT_LOGIN } from "@/services/account/db";
import { resetPassword } from "@/services/account/manageAccount";
import { clearResetState, readResetState, issueResetCode, verifyResetCode } from "@/services/passwordReset";
import { signIn } from "@/services/session";
import { COLOR, GRADIENT, SHADOW, surfaceFillStyle } from "@/styles/tokens";

import { AUTH_FIELDS, AUTH_MODES } from "./authModes";
import CodeBoxes, { VerifiedCode } from "./CodeBoxes";
import SocialLogin from "./SocialLogin";

// 사생활 보호 모드처럼 IndexedDB 가 막혀 저장소 호출이 던질 때 보여 준다. 문구는 저장소가 같은 상황에 쓰는 말과 같다.
const STORAGE_ERROR_MESSAGE: Record<AuthMode, string> = {
  signup: "가입 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
  login: "이 브라우저에서는 계정을 읽을 수 없습니다.",
  forgotPassword: "저장소를 쓸 수 없습니다.",
  verifyCode: "저장소를 쓸 수 없습니다.",
  resetPassword: "저장소를 쓸 수 없습니다.",
};

interface AuthFormProps {
  mode: AuthMode;
  /** 동의 줄의 약관 링크. 인증 화면이 아래 약관 칸을 그 탭으로 바꾸고 스크롤한다. */
  onShowTerms: (tab: TermsTabId) => void;
}

/** 인증 카드. 디자인에서 모드 다섯 개짜리 한 컴포넌트라 바탕·단추·하단 링크를 한 벌로 둔다. */
export default function AuthForm({ mode, onShowTerms }: AuthFormProps) {
  const config = AUTH_MODES[mode];
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // 막혔던 화면으로 돌아가기. 사이트 안 주소만 받는다 — 아니면 열린 리다이렉트가 된다.
  const returnTo = safeNextPath(searchParams.get(QUERY.next));
  // 재설정 2·3단계는 1단계에서 적은 이메일을 이어받는다.
  const carriedEmail = mode === "verifyCode" || mode === "resetPassword" ? readResetState()?.email : "";

  // 시연용 테스트 계정은 미리 채워만 둔다. 로그인은 사람이 누른다. VITE_TEST_ACCOUNT=off 면 같이 꺼진다.
  const form = useForm({
    fields: AUTH_FIELDS[mode],
    isLogin: mode === "login",
    asyncChecks: mode === "signup" ? SIGNUP_DUPLICATE_CHECKS : {},
    initialValues: carriedEmail
      ? { email: carriedEmail }
      : mode === "login" && TEST_ACCOUNT_ENABLED
        ? TEST_ACCOUNT_LOGIN
        : null,
  });
  const { values } = form;

  const consent = useConsents();
  const bot = useBotGuard();
  // 서버 응답이나 PBKDF2 해시를 기다리는 동안 두 번 눌리지 않게 잠근다.
  const { isSubmitting, run: runSubmit } = useSubmitLock();
  const [alertMessage, setAlertMessage] = useState("");

  const handleSubmit = () =>
    runSubmit(async () => {
      consent.markSubmitted();
      setAlertMessage("");
      try {
        const fieldsPassed = await form.validateAll();
        const consentPassed = mode !== "signup" || consent.check();
        if (!fieldsPassed || !consentPassed) return;

        const email = (values.email ?? "").trim();
        if (mode === "signup") {
          if (bot.isLikelyBot()) {
            setAlertMessage(BOT_SUSPECTED_MESSAGE);
            return;
          }
          const result = await signUp({
            email,
            password: values.password ?? "",
            nickname: values.nickname,
            region: values.region,
            consents: consent.consents,
          });
          if (!result.ok) {
            setAlertMessage(result.reason);
            return;
          }
          form.clearFields(["password", "passwordConfirm"]);
          signIn(result.user);
        } else if (mode === "login") {
          const result = await authenticate(email, values.password ?? "");
          form.clearFields(["password"]);
          if (!result.ok) {
            setAlertMessage(result.reason);
            return;
          }
          signIn(result.user);
        } else if (mode === "forgotPassword") {
          // 가입 안 된 메일이어도 똑같이 진행한다. 가입 여부를 드러내지 않는다.
          issueResetCode(email);
        } else if (mode === "verifyCode") {
          const result = verifyResetCode(email, values.code ?? "");
          if (!result.ok) {
            setAlertMessage(result.reason);
            return;
          }
        } else {
          // 주소를 직접 쳐서 인증 단계를 건너뛰지 못하게 한다.
          const state = readResetState();
          if (!state?.verified) {
            setAlertMessage("인증이 끝나지 않았거나 시간이 지났습니다. 비밀번호 찾기부터 다시 해 주세요.");
            return;
          }
          const result = await resetPassword(state.email, values.newPassword ?? "");
          // 가입 안 된 메일이어도 바뀌었다고만 한다. 이 화면으로 가입 여부를 캐지 못하게.
          if (!result.ok && result.code !== "unknownEmail") {
            setAlertMessage(result.reason);
            return;
          }
          clearResetState();
        }
        navigate((mode === "login" || mode === "signup") && returnTo ? returnTo : config.next);
      } catch {
        setAlertMessage(STORAGE_ERROR_MESSAGE[mode]);
      }
    });

  // 로그인 ↔ 회원가입을 오가도 ?next= 를 들고 가야 가입을 마친 뒤 원래 가려던 곳으로 이어진다.
  const goTo = (route: RoutePath) => {
    const carriesNext = route === ROUTES.login || route === ROUTES.signup;
    navigate(returnTo && carriesNext ? withQuery(route, { [QUERY.next]: returnTo }) : route);
  };

  const bind = (name: FieldName): FieldBinding => ({ ...form.fieldProps(name), onEnter: submitOnEnter(handleSubmit) });
  const typo = mode !== "resetPassword" ? suggestEmailTypo(values.email) : "";
  const regionProps = form.fieldProps("region");
  const resetState = readResetState();

  return (
    <div
      style={{
        ...cardStyle,
        paddingBottom: `${config.paddingBottom}px`,
        // 내용이 넘칠 때 잘리지 않게 높이 대신 최소 높이로 둔다.
        ...(config.minHeight ? { minHeight: `${config.minHeight}px` } : {}),
        ...(config.hasOuterShadow ? outerShadowStyle : innerShadowStyle),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingBottom: "16px", width: "100%" }}>
        <div style={titleStyle}>{config.title}</div>
        <div style={subtitleStyle}>{config.subtitle}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "14px", width: "100%" }}>
        {mode === "signup" && (
          <div style={{ display: "flex", gap: "12px", width: "100%" }}>
            <TextField
              variant="card"
              label="닉네임"
              placeholder="모험가 이름"
              grow
              autoComplete="nickname"
              {...bind("nickname")}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "9px", flex: "1 0 0", minWidth: 0 }}>
              <LabelRow label="지역" name="region" error={regionProps.error} />
              <RegionPicker
                value={values.region ?? ""}
                onSelect={(region) => form.setField("region", region)}
                onBlur={regionProps.onBlur}
                error={regionProps.error}
                isValid={regionProps.isValid}
                fieldStyle={{ ...inputBoxStyle.card, paddingRight: 0 }}
              />
            </div>
          </div>
        )}

        {/* 재설정 마지막 단계에서는 이미 지나간 칸이라 흐리게 */}
        <TextField
          variant="card"
          label="이메일"
          placeholder="explorer@escape.kr"
          dimmed={mode === "resetPassword"}
          autoComplete={mode === "login" ? "username" : "email"}
          inputMode="email"
          typo={typo}
          onFixTypo={() => form.setField("email", typo.replace(/^혹시 | 인가요\?$/g, ""))}
          {...bind("email")}
        />

        {/* 로그인은 맞나 틀리나만 보므로 가입 규칙 목록을 보이지 않는다. */}
        {mode === "login" && (
          <TextField
            variant="card"
            label="비밀번호"
            placeholder="비밀번호 입력"
            type="password"
            autoComplete="current-password"
            hideRules
            {...bind("password")}
          />
        )}

        {mode === "signup" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "9px", width: "100%" }}>
              <LabelRow label="비밀번호" name="password" error={form.fieldProps("password").error} />
              <InputLine
                variant="card"
                placeholder="8자 이상"
                type="password"
                autoComplete="new-password"
                {...bind("password")}
              />
              <PasswordStrength password={values.password} />
            </div>
            <TextField
              variant="card"
              label="비밀번호 확인"
              placeholder="비밀번호 재입력"
              type="password"
              autoComplete="new-password"
              {...bind("passwordConfirm")}
            />
          </>
        )}

        {mode === "verifyCode" && (
          <>
            <CodeBoxes {...bind("code")} />
            {/* 메일 서버가 붙기 전까지만 받은 코드를 화면에 보여 준다. */}
            {resetState ? (
              <div style={testCodeBoxStyle} role="note">
                <span>메일 발송은 서버 연결 후 동작합니다 · 테스트용 인증코드</span>
                <b style={{ fontFamily: FONT.mono, fontSize: "20px", letterSpacing: "4px", color: "#fde68a" }}>
                  {resetState.code}
                </b>
              </div>
            ) : (
              <div style={testCodeBoxStyle} role="note">
                <span>받은 인증코드가 없거나 시간이 지났습니다. 비밀번호 찾기부터 다시 해 주세요.</span>
              </div>
            )}
          </>
        )}

        {mode === "resetPassword" && (
          <>
            <VerifiedCode code={resetState?.code} />
            <TextField
              variant="card"
              label="새 비밀번호"
              placeholder="8자 이상"
              type="password"
              autoComplete="new-password"
              {...bind("newPassword")}
            />
            <TextField
              variant="card"
              label="새 비밀번호 확인"
              placeholder="비밀번호 재입력"
              type="password"
              autoComplete="new-password"
              {...bind("passwordConfirm")}
            />
          </>
        )}
      </div>

      {mode === "signup" && (
        <ConsentGroup
          variant="card"
          consents={consent.consents}
          allAgreed={consent.allAgreed}
          error={consent.error}
          onChange={consent.update}
          onShowTerms={onShowTerms}
        />
      )}

      {mode === "signup" && <Honeypot value={bot.honeypot} onChange={bot.setHoneypot} />}

      <div style={{ paddingTop: "24px", width: "100%", display: "flex", flexDirection: "column", gap: "14px" }}>
        {alertMessage && (
          <div style={alertStyle} role="alert">
            {alertMessage}
          </div>
        )}
        <SubmitButton
          label={isSubmitting ? "확인하는 중…" : config.submitLabel}
          isBusy={isSubmitting}
          onClick={handleSubmit}
          style={submitButtonStyle}
          labelStyle={submitLabelStyle}
        />
      </div>

      {(mode === "login" || mode === "signup") && (
        <>
          <div style={{ padding: "12px 0 4px", width: "100%" }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", width: "100%" }}>
              <div style={hairlineStyle} />
              <span style={{ fontFamily: FONT.mono, fontSize: "16px", color: COLOR.textSubtle, whiteSpace: "nowrap" }}>
                {mode === "login" ? "간편 로그인" : "간편 가입"}
              </span>
              <div style={hairlineStyle} />
            </div>
          </div>
          <SocialLogin
            onSignedIn={(user) => {
              signIn(user);
              navigate(returnTo || config.next);
            }}
          />
        </>
      )}

      {/* 화면끼리 이어지는 자리. 회원가입 화면의 「로그인」만 Regular 이다(디자인 그대로). */}
      <div style={footerStyle}>
        {mode === "login" && (
          <>
            <span style={footerPromptStyle}>아직 모험가가 아닌가요?</span>
            <AuthLink label="회원가입" onClick={() => goTo(ROUTES.signup)} />
            <span style={footerPromptStyle}>&nbsp;·&nbsp;</span>
            <AuthLink label="비밀번호 찾기" onClick={() => goTo(ROUTES.forgotPassword)} />
          </>
        )}
        {mode === "signup" && (
          <>
            <span style={footerPromptStyle}>이미 모험가이신가요?</span>
            <AuthLink label="로그인" isBold={false} onClick={() => goTo(ROUTES.login)} />
            <span style={footerPromptStyle}>&nbsp;·&nbsp;</span>
            <AuthLink label="비밀번호 찾기" onClick={() => goTo(ROUTES.forgotPassword)} />
          </>
        )}
        {(mode === "forgotPassword" || mode === "verifyCode" || mode === "resetPassword") && (
          <>
            <span style={footerPromptStyle}>로그인으로 돌아가기</span>
            <AuthLink label="로그인" onClick={() => goTo(ROUTES.login)} />
          </>
        )}
      </div>
    </div>
  );
}

function AuthLink({ label, isBold = true, onClick }: { label: string; isBold?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="text-link"
      style={{ ...accentLinkStyle, fontWeight: isBold ? 700 : 400, cursor: "pointer" }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

const cardStyle: CSSProperties = {
  width: "593px",
  padding: "48px 24px 0",
  borderRadius: "16px",
  ...surfaceFillStyle,
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  alignItems: "flex-start",
  boxSizing: "border-box",
};

const outerShadowStyle: CSSProperties = { filter: "drop-shadow(0px 8px 16px rgba(47,62,112,0.13))" };

const innerShadowStyle: CSSProperties = { overflow: "hidden", boxShadow: "0px 8px 32px 0px rgba(47,62,112,0.13)" };

const titleStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontWeight: 700,
  fontSize: "36px",
  color: COLOR.textBright,
  width: "100%",
};

const subtitleStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 400,
  fontSize: "18px",
  color: COLOR.textMuted,
  width: "100%",
};

const testCodeBoxStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "12px 16px",
  borderRadius: "10px",
  border: "1px dashed rgba(251,191,36,0.45)",
  background: "rgba(251,191,36,0.06)",
  fontFamily: FONT.mono,
  fontSize: "14px",
  color: COLOR.warning,
};

// 칸 하나가 아니라 폼 전체에 걸린 문제(「이메일 또는 비밀번호가 올바르지 않습니다」)를 보여 준다.
const alertStyle: CSSProperties = {
  fontFamily: "inherit",
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

const footerStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  fontSize: "16px",
  whiteSpace: "nowrap",
};

const footerPromptStyle: CSSProperties = { fontFamily: FONT.mono, fontWeight: 400, color: COLOR.textSubtle };

const accentLinkStyle: CSSProperties = { fontFamily: FONT.mono, color: COLOR.accent };
