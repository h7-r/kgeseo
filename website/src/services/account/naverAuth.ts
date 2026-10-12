import { ROUTES } from "@/navigation/routes";

import {
  BackendAuthError,
  postSocialAuth,
  socialAuthErrorMessage,
  socialInvalidResponseMessage,
  socialNotReadyMessage,
  type SocialAuthResult,
} from "./socialAuthApi";

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
  // 키가 없다는 사실만 알린다. 환경변수 이름은 화면에 내지 않는다.
  if (!NAVER_CLIENT_ID) return socialNotReadyMessage("naver");
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
let pendingLogin: Promise<SocialAuthResult> | null = null;

function readCallbackParams(params: URLSearchParams) {
  const code = params.get("code") || "";
  const state = params.get("state") || "";
  if (params.get("error")) throw new Error("네이버 로그인이 취소되었거나 실패했습니다.");
  if (!code || !state) throw new Error(socialInvalidResponseMessage("naver"));
  return { code, state };
}

// 이 브라우저가 시작한 요청인지 확인한다(CSRF).
function verifyState(state: string) {
  const saved = readOAuthState();
  if (!saved || saved !== state || !state.startsWith(NAVER_STATE_PREFIX)) {
    throw new Error(socialInvalidResponseMessage("naver"));
  }
}

/**
 * 콜백 주소의 질의로 백엔드에 확인받는다. 기존 회원이면 로그인할 사용자, 처음이면 가입 안내를 돌려준다.
 * 같은 state 로 두 번 불려도(StrictMode) 요청은 한 번만 보낸다.
 */
export async function signInWithNaverCallback(params: URLSearchParams): Promise<SocialAuthResult> {
  try {
    const { code, state } = readCallbackParams(params);
    if (pendingLogin && pendingState === state) return await pendingLogin;

    verifyState(state);
    // state 는 한 번만 쓴다. 지운 뒤라 새로고침하면 위 확인에서 막힌다.
    clearOAuthState();
    pendingState = state;
    pendingLogin = postSocialAuth("naver", { code, state }).finally(() => {
      pendingState = "";
      pendingLogin = null;
    });
    return await pendingLogin;
  } catch (error) {
    if (error instanceof BackendAuthError) throw new Error(socialAuthErrorMessage("naver", error), { cause: error });
    throw error;
  }
}
