import AuthForm from "@/sections/auth/AuthForm";
import AuthStage from "@/sections/auth/AuthStage";
import { useTermsAnchor } from "@/sections/auth/useTermsAnchor";

export type AuthMode = "login" | "signup" | "forgotPassword" | "verifyCode" | "resetPassword";

interface AuthPageProps {
  mode: AuthMode;
}

/** 인증 화면. 소개 글이 없으면 오른쪽 절반이 비어 네 화면 모두 AuthStage 를 쓴다. */
export default function AuthPage({ mode }: AuthPageProps) {
  const terms = useTermsAnchor();
  return (
    <AuthStage terms={terms}>
      {/* 모드가 바뀌면 폼을 새로 만든다. 안 그러면 로그인에 치던 비밀번호가 회원가입 칸에 남는다. */}
      <AuthForm key={mode} mode={mode} onShowTerms={terms.showTerms} />
    </AuthStage>
  );
}
