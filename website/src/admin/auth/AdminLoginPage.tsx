import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { toAdminError } from "../api/client";
import { ADMIN_ROLE, fetchMe, loginWithPassword, logout, type LoginResult } from "../api/session";
import { lockedLoginMessage } from "../lib/loginLock";
import { adminNextPath } from "../paths";

type FieldErrors = { email?: string; password?: string };
type FailedLogin = Extract<LoginResult, { ok: false }>;

function loginMessage(result: FailedLogin): string {
  switch (result.failure) {
    case "invalid":
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    case "locked":
      return lockedLoginMessage(result.retryAfterSeconds);
    case "input":
      return "이메일 형식을 다시 확인해 주세요.";
    case "offline":
      return "서버에 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.";
    default:
      return `서버 오류가 났습니다. (오류 ${result.status})`;
  }
}

/** 관리자 로그인. 로그인이 되더라도 /me 의 역할이 관리자일 때만 안으로 들인다. */
export default function AdminLoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const hasNext = params.has("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordShown, setIsPasswordShown] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nonAdminName, setNonAdminName] = useState<string | null>(null);

  useEffect(() => {
    document.title = "관리자 로그인 · ESCAPE THE LEGEND";
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: FieldErrors = {
      email: email.trim() ? undefined : "이메일을 입력해 주세요.",
      password: password ? undefined : "비밀번호를 입력해 주세요.",
    };
    setErrors(next);
    if (next.email || next.password) return;

    setIsSubmitting(true);
    try {
      const result = await loginWithPassword(email.trim(), password);
      if (!result.ok) {
        setErrors({ password: loginMessage(result) });
        return;
      }
      const me = await fetchMe();
      if (me.role !== ADMIN_ROLE) {
        setNonAdminName(me.nickname);
        return;
      }
      navigate(adminNextPath(params.get("next")), { replace: true });
    } catch (error) {
      const kind = toAdminError(error).kind;
      setErrors({
        password: kind === "offline" ? "서버에 연결할 수 없습니다." : "로그인 확인 중 서버 오류가 났습니다.",
      });
    } finally {
      setIsSubmitting(false);
      setPassword("");
    }
  };

  const signOutAndRetry = () => {
    logout();
    setNonAdminName(null);
    setEmail("");
  };

  return (
    <main className="adm-login">
      <section className="adm-login__card" aria-labelledby="adm-login-title">
        <p className="adm-login__brand">ESCAPE THE LEGEND</p>
        <h1 id="adm-login-title" className="adm-login__title">
          관리자 로그인
        </h1>

        {nonAdminName ? (
          <div className="adm-login__denied" role="alert">
            <p className="adm-login__denied-title">관리자 권한이 없는 계정입니다</p>
            <p className="adm-login__denied-desc">
              {nonAdminName} 계정은 관리자 화면에 들어올 수 없습니다. 로그아웃한 뒤 관리자 계정으로 로그인해 주세요.
            </p>
            <button
              type="button"
              className="adm-button adm-button--primary adm-button--block"
              onClick={signOutAndRetry}
            >
              로그아웃하고 다른 계정으로
            </button>
          </div>
        ) : (
          <form className="adm-login__form" onSubmit={handleSubmit} noValidate>
            {hasNext && <p className="adm-login__note">로그인하면 보던 화면으로 돌아갑니다.</p>}
            <div className="adm-field">
              <label htmlFor="adm-email" className="adm-field__label">
                이메일
              </label>
              <input
                id="adm-email"
                type="email"
                autoComplete="username"
                className="adm-input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "adm-email-error" : undefined}
              />
              {errors.email && (
                <p id="adm-email-error" className="adm-field__error" role="alert">
                  {errors.email}
                </p>
              )}
            </div>
            <div className="adm-field">
              <label htmlFor="adm-password" className="adm-field__label">
                비밀번호
              </label>
              <div className="adm-input-group">
                <input
                  id="adm-password"
                  type={isPasswordShown ? "text" : "password"}
                  autoComplete="current-password"
                  className="adm-input"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? "adm-password-error" : undefined}
                />
                <button
                  type="button"
                  className="adm-input-group__toggle"
                  aria-pressed={isPasswordShown}
                  onClick={() => setIsPasswordShown((value) => !value)}
                >
                  {isPasswordShown ? "숨기기" : "보기"}
                </button>
              </div>
              {errors.password && (
                <p id="adm-password-error" className="adm-field__error" role="alert">
                  {errors.password}
                </p>
              )}
            </div>
            <button type="submit" className="adm-button adm-button--primary adm-button--block" disabled={isSubmitting}>
              {isSubmitting ? "확인하는 중…" : "로그인"}
            </button>
          </form>
        )}
      </section>
      <p className="adm-login__footer">관리자 전용 화면입니다. 회원 정보 열람은 서버에 기록됩니다.</p>
    </main>
  );
}
