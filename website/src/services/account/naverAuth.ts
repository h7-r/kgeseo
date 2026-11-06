import { AUTH_PAGE_PATHS, ROUTES, safeNextPath } from "@/navigation/routes";

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

/** 네이버로 떠나기 전에 남기는 값. 돌아갈 곳은 state 와 한 묶음이라 state 가 맞을 때만 쓴다. */
interface SavedOAuthState {
  state: string;
  returnTo: string | null;
}

// 공백·제어 문자가 섞인 주소는 브라우저마다 다르게 읽혀 우회에 쓰인다.
const hasUnsafeChar = (path: string) =>
  /\s/.test(path) || [...path].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);

/**
 * 로그인을 마치고 돌아갈 사이트 안 주소. 아니면 null(기본 경로로 간다).
 * safeNextPath 에 더해 로그인·가입 화면과 콜백 주소는 받지 않는다 — 돌아가면 다시 로그인 화면이거나 콜백이 헛돈다.
 */
function toReturnTo(value: string | null | undefined): string | null {
  const path = safeNextPath(value ?? null);
  if (!path || hasUnsafeChar(path)) return null;
  let pathname = path.split(/[?#]/)[0];
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (AUTH_PAGE_PATHS.includes(pathname) || pathname === ROUTES.socialCallback) return null;
  return path;
}

// CSRF 를 막는 한 번 쓰는 값. 돌아왔을 때 같은 값인지 확인한다.
function createState(returnTo: string | null): string {
  const saved: SavedOAuthState = { state: `${NAVER_STATE_PREFIX}${crypto.randomUUID()}`, returnTo };
  try {
    sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify(saved));
  } catch {
    // 저장이 막혀도 로그인은 시도하게 둔다. 돌아오면 state 확인에서 막힌다.
  }
  return saved.state;
}

/** 저장된 값을 꺼내면서 지운다. state 는 콜백 한 번에만 쓴다 — 실패·취소·새로고침 뒤에는 남지 않는다. */
function takeOAuthState(): SavedOAuthState | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(OAUTH_STATE_KEY);
    sessionStorage.removeItem(OAUTH_STATE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { state, returnTo } = value as Record<string, unknown>;
    if (typeof state !== "string" || !state) return null;
    // 저장소 값도 믿지 않고 다시 거른다.
    return { state, returnTo: typeof returnTo === "string" ? toReturnTo(returnTo) : null };
  } catch {
    return null;
  }
}

// Vite 는 import.meta.env.VITE_* 를 글자 그대로 써야 빌드 때 값을 넣어 준다.
const NAVER_CLIENT_ID: string | undefined = import.meta.env.VITE_NAVER_CLIENT_ID;

/**
 * 키가 있으면 네이버 인가 화면으로 보내고 "" 를, 없으면 못 가는 까닭을 돌려준다.
 * returnTo 는 로그인·가입을 마친 뒤 돌아갈 사이트 안 주소다. 쓸 수 없는 값이면 버리고 기본 경로로 간다.
 */
export function startNaverLogin(returnTo: string | null = null): string {
  // 키가 없다는 사실만 알린다. 환경변수 이름은 화면에 내지 않는다.
  if (!NAVER_CLIENT_ID) return socialNotReadyMessage("naver");
  const query = new URLSearchParams({
    client_id: NAVER_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    state: createState(toReturnTo(returnTo)),
  });
  window.location.href = `https://nid.naver.com/oauth2.0/authorize?${query}`;
  return "";
}

/** 콜백 결과와 로그인 전에 남겨 둔 돌아갈 곳. returnTo 가 null 이면 기본 경로로 간다. */
export interface NaverCallbackResult {
  result: SocialAuthResult;
  returnTo: string | null;
}

// 같은 콜백이 두 번 불려도(StrictMode) 요청은 한 번만 보낸다.
let pendingState = "";
let pendingLogin: Promise<NaverCallbackResult> | null = null;

function readCallbackParams(params: URLSearchParams) {
  const code = params.get("code") || "";
  const state = params.get("state") || "";
  if (params.get("error")) throw new Error("네이버 로그인이 취소되었거나 실패했습니다.");
  if (!code || !state) throw new Error(socialInvalidResponseMessage("naver"));
  return { code, state };
}

/**
 * 콜백 주소의 질의로 백엔드에 확인받는다. 기존 회원이면 로그인할 사용자, 처음이면 가입 안내를 돌려준다.
 * 같은 state 로 두 번 불려도(StrictMode) 요청은 한 번만 보낸다.
 */
export async function signInWithNaverCallback(params: URLSearchParams): Promise<NaverCallbackResult> {
  try {
    let callback: { code: string; state: string };
    try {
      callback = readCallbackParams(params);
    } catch (error) {
      // 취소·오류로 돌아왔어도 이번 시도는 끝났다. 남은 state 를 치운다.
      takeOAuthState();
      throw error;
    }
    const { code, state } = callback;
    if (pendingLogin && pendingState === state) return await pendingLogin;

    // 이 브라우저가 시작한 요청인지 확인한다(CSRF). 맞든 틀리든 꺼내면서 지운다 — 새로고침하면 여기서 막힌다.
    const saved = takeOAuthState();
    if (!saved || saved.state !== state || !state.startsWith(NAVER_STATE_PREFIX)) {
      throw new Error(socialInvalidResponseMessage("naver"));
    }
    pendingState = state;
    pendingLogin = postSocialAuth("naver", { code, state })
      .then((result) => ({ result, returnTo: saved.returnTo }))
      .finally(() => {
        pendingState = "";
        pendingLogin = null;
      });
    return await pendingLogin;
  } catch (error) {
    if (error instanceof BackendAuthError) throw new Error(socialAuthErrorMessage("naver", error), { cause: error });
    throw error;
  }
}
