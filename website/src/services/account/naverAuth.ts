import { clearOAuthState, readOAuthState, statePrefix } from "@/services/socialLogin";
import type { SessionUser } from "@/services/session";

import { BackendAuthError, postSocialAuth, toSessionUserFromProfile } from "./socialAuthApi";

/** 네이버 인가 화면에서 돌아온 code·state 를 백엔드(/auth/naver)에 넘겨 로그인한다. */
let pendingState = "";
let pendingLogin: Promise<SessionUser> | null = null;

function backendErrorMessage(error: BackendAuthError): string {
  if (error.status === 401) return "Naver 인증에 실패했습니다. 다시 시도해 주세요.";
  if (error.needsAccountLink) {
    return "이미 같은 이메일로 가입된 계정이 있습니다. 기존 로그인 후 Naver 계정을 연결해 주세요.";
  }
  if (error.status === 502) return "Naver 프로필을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.status === 503) return "Naver 로그인이 아직 서버에 설정되지 않았습니다.";
  if (error.status) return `Naver 로그인 처리 중 문제가 생겼습니다. (${error.status})`;
  return "Backend에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
}

function readCallbackParams(params: URLSearchParams) {
  const code = params.get("code") || "";
  const state = params.get("state") || "";
  if (params.get("error")) throw new Error("Naver 로그인이 취소되었거나 실패했습니다.");
  if (!code) throw new Error("Naver authorization code를 받지 못했습니다.");
  if (!state) throw new Error("Naver state를 받지 못했습니다.");
  return { code, state };
}

// 이 브라우저가 시작한 요청인지 확인한다(CSRF).
function verifyState(state: string) {
  const saved = readOAuthState();
  if (!saved || saved !== state || !state.startsWith(statePrefix("naver"))) {
    throw new Error("Naver 로그인 요청을 확인할 수 없습니다. 처음부터 다시 시도해 주세요.");
  }
}

/** 콜백 주소의 질의로 로그인한다. 같은 state 로 두 번 불려도(StrictMode) 요청은 한 번만 보낸다. */
export async function signInWithNaverCallback(params: URLSearchParams): Promise<SessionUser> {
  try {
    const { code, state } = readCallbackParams(params);
    if (pendingLogin && pendingState === state) return await pendingLogin;

    verifyState(state);
    // state 는 한 번만 쓴다. 지운 뒤라 새로고침하면 위 확인에서 막힌다.
    clearOAuthState();
    pendingState = state;
    pendingLogin = postSocialAuth("/naver", { code, state }, "Naver 인증에 실패했습니다.")
      .then((profile) => toSessionUserFromProfile(profile, "naver"))
      .finally(() => {
        pendingState = "";
        pendingLogin = null;
      });
    return await pendingLogin;
  } catch (error) {
    if (error instanceof BackendAuthError) throw new Error(backendErrorMessage(error), { cause: error });
    throw error;
  }
}
