import { ROUTES } from "@/navigation/routes";

/**
 * 구글·네이버 인가 화면으로 보내는 간편 로그인 앞단. 돌아온 코드를 토큰으로 바꾸는 일은
 * client_secret 이 필요해 백엔드 몫이다(네이버는 naverAuth 가 넘긴다).
 * 로그인 화면의 구글 단추는 팝업 방식(googleAuth)을 쓰고, 여기 구글 경로는 홈 빠른 가입 단추만 쓴다.
 * 키(.env)가 없으면 성공한 척하지 않고 무엇이 없는지 알려 준다.
 */
export type SocialProvider = "google" | "naver";

interface ProviderConfig {
  /** 안내 문구에 들어가는 이름 */
  label: string;
  envName: string;
  clientId: string | undefined;
  authorizeUrl: (clientId: string) => string;
}

const OAUTH_STATE_KEY = "waegok.oauthState";

// 네이버 개발자센터·백엔드 NAVER_REDIRECT_URI 에 등록한 주소와 글자까지 같아야 한다.
const redirectUri = () => `${window.location.origin}${ROUTES.socialCallback}`;

/** state 앞머리. 콜백에서 어느 제공자가 시작한 요청인지 가린다. */
export const statePrefix = (provider: SocialProvider) => `${provider}.`;

// CSRF 를 막는 한 번 쓰는 값. 돌아왔을 때 같은 값인지 확인한다.
function createState(provider: SocialProvider): string {
  const state = `${statePrefix(provider)}${crypto.randomUUID()}`;
  try {
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
  } catch {
    // 저장이 막혀도 로그인은 시도하게 둔다.
  }
  return state;
}

export function readOAuthState(): string {
  try {
    return sessionStorage.getItem(OAUTH_STATE_KEY) || "";
  } catch {
    return "";
  }
}

export function clearOAuthState() {
  try {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
  } catch {
    // 사생활 보호 모드 등에서 막힐 수 있다.
  }
}

// Vite 는 import.meta.env.VITE_* 를 글자 그대로 써야 빌드 때 값을 넣어 준다.
const PROVIDERS: Record<SocialProvider, ProviderConfig> = {
  google: {
    label: "구글",
    envName: "VITE_GOOGLE_CLIENT_ID",
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    authorizeUrl: (clientId) => {
      const query = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri(),
        response_type: "code",
        scope: "openid email profile",
        state: createState("google"),
        prompt: "select_account",
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
    },
  },
  naver: {
    label: "네이버",
    envName: "VITE_NAVER_CLIENT_ID",
    clientId: import.meta.env.VITE_NAVER_CLIENT_ID,
    authorizeUrl: (clientId) => {
      const query = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri(),
        response_type: "code",
        state: createState("naver"),
      });
      return `https://nid.naver.com/oauth2.0/authorize?${query}`;
    },
  },
};

/** 키가 있으면 인가 화면으로 보내고 "" 를, 없으면 못 가는 까닭을 돌려준다. */
export function startSocialLogin(provider: SocialProvider): string {
  const config = PROVIDERS[provider];
  if (!config.clientId) return `${config.label} 로그인 키(${config.envName})가 아직 없습니다.`;
  window.location.href = config.authorizeUrl(config.clientId);
  return "";
}
