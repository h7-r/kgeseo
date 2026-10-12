import {
  BackendAuthError,
  postSocialAuth,
  socialAuthErrorMessage,
  socialInvalidResponseMessage,
  socialNotReadyMessage,
  type SocialAuthResult,
} from "./socialAuthApi";

/**
 * 구글 로그인. Google Identity Services 창에서 credential(ID 토큰)을 받아
 * 백엔드(/auth/google)가 검증한다. 콘솔에는 redirect URI 가 아니라 JavaScript origin 을 등록한다.
 */
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

interface PromptMoment {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
}

interface GoogleIdentity {
  initialize: (config: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    auto_select: boolean;
    cancel_on_tap_outside: boolean;
  }) => void;
  prompt: (listener: (moment: PromptMoment) => void) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentity } };
  }
}

let scriptPromise: Promise<void> | null = null;
let credentialPromise: Promise<string> | null = null;

function requireClientId(): string {
  // 키가 없다는 사실만 알린다. 환경변수 이름은 화면에 내지 않는다.
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID")
    throw new Error(socialNotReadyMessage("google"));
  return GOOGLE_CLIENT_ID;
}

function loadScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const loadError = () => new Error("Google 스크립트를 불러오지 못했습니다.");
    const existing = document.querySelector(`script[src="${GOOGLE_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(loadError()), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // 다음 클릭에서 다시 받아 보게 비운다.
      scriptPromise = null;
      reject(loadError());
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// 창이 떠 있는 동안 또 누르면 같은 기다림을 돌려준다.
function requestCredential(clientId: string): Promise<string> {
  if (credentialPromise) return credentialPromise;

  credentialPromise = new Promise((resolve, reject) => {
    const identity = window.google?.accounts?.id;
    if (!identity) {
      credentialPromise = null;
      reject(new Error("Google 스크립트를 불러오지 못했습니다."));
      return;
    }
    const finish = (error: Error | null, credential?: string) => {
      credentialPromise = null;
      if (error) reject(error);
      else resolve(credential ?? "");
    };

    identity.initialize({
      client_id: clientId,
      callback: (response) => {
        if (!response?.credential) {
          finish(new Error(socialInvalidResponseMessage("google")));
          return;
        }
        finish(null, response.credential);
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    identity.prompt((moment) => {
      if (moment.isNotDisplayed?.() || moment.isSkippedMoment?.()) {
        finish(new Error("Google 로그인 창을 열 수 없습니다. 팝업 차단 또는 브라우저 설정을 확인해 주세요."));
      } else if (moment.isDismissedMoment?.()) {
        finish(new Error("Google 로그인이 취소되었습니다."));
      }
    });
  });
  return credentialPromise;
}

/**
 * 구글 창을 띄워 백엔드에 확인받는다. 기존 회원이면 로그인할 사용자, 처음이면 가입 안내를 돌려준다.
 * 실패하면 화면에 띄울 문구로 던진다.
 */
export async function signInWithGoogle(): Promise<SocialAuthResult> {
  try {
    const clientId = requireClientId();
    await loadScript();
    const credential = await requestCredential(clientId);
    return await postSocialAuth("google", { credential });
  } catch (error) {
    if (error instanceof BackendAuthError) throw new Error(socialAuthErrorMessage("google", error), { cause: error });
    throw error;
  }
}
