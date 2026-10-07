import type { FieldName } from "@/lib/validation";
import { ROUTES, type RoutePath } from "@/navigation/routes";
import type { AuthMode } from "@/pages/AuthPage";

interface ModeConfig {
  /** 최소 높이. 내용이 넘치면 늘어난다. null 이면 내용만큼. */
  minHeight: number | null;
  paddingBottom: number;
  title: string;
  subtitle: string;
  submitLabel: string;
  /** 제출이 통과하면 갈 곳. 단추 글자로 찾으면 로그인 제출이 하단 「로그인」 링크와 같은 곳으로 간다. */
  next: RoutePath;
  /** 회원가입만 그림자가 카드 밖으로 나간다(drop-shadow). */
  hasOuterShadow?: boolean;
}

export const AUTH_MODES: Record<AuthMode, ModeConfig> = {
  login: {
    minHeight: 800,
    paddingBottom: 28,
    title: "로그인",
    subtitle: "계정에 로그인하고 탐험을 계속하세요.",
    submitLabel: "로그인",
    next: ROUTES.home,
  },
  signup: {
    minHeight: 800,
    paddingBottom: 32,
    title: "회원가입",
    subtitle: "계정을 만들고 전국의 방탈출 미션에 도전하세요.",
    submitLabel: "회원가입 완료",
    next: ROUTES.home,
    hasOuterShadow: true,
  },
  forgotPassword: {
    minHeight: 760,
    paddingBottom: 28,
    title: "비밀번호 찾기",
    subtitle: "가입한 이메일을 입력하면 재설정 링크를 보내드립니다.",
    submitLabel: "재설정 링크 보내기",
    next: ROUTES.verifyCode,
  },
  verifyCode: {
    minHeight: 495,
    paddingBottom: 28,
    title: "비밀번호 재설정",
    subtitle: "가입한 이메일을 입력하고 인증코드를 확인해주세요.",
    submitLabel: "인증 완료",
    next: ROUTES.resetPassword,
  },
  resetPassword: {
    minHeight: null,
    paddingBottom: 28,
    title: "비밀번호 재설정",
    subtitle: "인증이 완료되었습니다. 새 비밀번호를 설정해주세요.",
    submitLabel: "비밀번호 변경 완료",
    next: ROUTES.login,
  },
};

export const AUTH_FIELDS: Record<AuthMode, readonly FieldName[]> = {
  login: ["email", "password"],
  signup: ["nickname", "region", "email", "password", "passwordConfirm"],
  forgotPassword: ["email"],
  verifyCode: ["email", "code"],
  resetPassword: ["newPassword", "passwordConfirm"],
};
