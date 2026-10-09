import { ROUTES } from "@/navigation/routes";
import type { SessionUser } from "@/services/session";

import { BackendAuthError, postSocialAuth, toSessionUserFromProfile } from "./socialAuthApi";

/**
 * 네이버 로그인. 인가 화면으로 보냈다가 콜백 주소로 돌아온 code·state 를 백엔드(/auth/naver)에 넘긴다.
 * 코드를 토큰으로 바꾸는 일은 client_secret 이 필요해 백엔드 몫이다.
 * 키(.env)가 없으면 성공한 척하지 않고 무엇이 없는지 알려 준다.
 */
const OAUTH_STATE_KEY = "waegok.oauthState";

// 네이버 개발자센터·백엔드 NAVER_REDIRECT_URI 에 등록한 주소와 글자까지 같아야 한다.
const redirectUri = () => `${window.location.origin}${ROUTES.socialCallback}`;

/** state 앞머리. 콜백이 네이버가 시작한 요청인지 가린다. */
const NAVER_STATE_PREFIX = "naver.";

// CSRF 를 막는 한 번 쓰는 값. 돌아왔을 때 같은 값인지 확인한다.
function createState(): string {
  const state = `${NAVER_STATE_PREFIX}${crypto.randomUUID()}`;
  try {
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
  } catch {
    // 저장이 막혀도 로그인은 시도하게 둔다.
  }
  return state;
}

function readOAuthState(): string {
  try {
    return sessionStorage.getItem(OAUTH_STATE_KEY) || "";
  } catch {
    return "";
  }
}

function clearOAuthState() {
  try {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
  } catch {
    // 사생활 보호 모드 등에서 막힐 수 있다.
  }
}

// Vite 는 import.meta.env.VITE_* 를 글자 그대로 써야 빌드 때 값을 넣어 준다.
const NAVER_CLIENT_ID: string | undefined = import.meta.env.VITE_NAVER_CLIENT_ID;

/** 키가 있으면 네이버 인가 화면으로 보내고 "" 를, 없으면 못 가는 까닭을 돌려준다. */
export function startNaverLogin(): string {
  if (!NAVER_CLIENT_ID) return "네이버 로그인 키(VITE_NAVER_CLIENT_ID)가 아직 없습니다.";
  const query = new URLSearchParams({
    client_id: NAVER_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    state: createState(),
  });
  window.location.href = `https://nid.naver.com/oauth2.0/authorize?${query}`;
  return "";
}

// 같은 콜백이 두 번 불려도(StrictMode) 요청은 한 번만 보낸다.
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
  if (!saved || saved !== state || !state.startsWith(NAVER_STATE_PREFIX)) {
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
