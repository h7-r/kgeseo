/**
 * 구글·네이버 간편 로그인. 인가 코드를 토큰으로 바꾸는 일은 client_secret 이 필요해 서버 몫이고,
 * 여기서는 인가 화면으로 보내는 것까지만 한다. 키(.env)가 없으면 성공한 척하지 않고 무엇이 없는지 알려 준다.
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

const redirectUri = () => `${window.location.origin}/login/callback`;

// CSRF 를 막는 한 번 쓰는 값. 돌아왔을 때 같은 값인지 확인한다.
function createState(provider: SocialProvider): string {
  const state = `${provider}.${crypto.randomUUID()}`;
  try {
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
  } catch {
    // 저장이 막혀도 로그인은 시도하게 둔다.
  }
  return state;
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
