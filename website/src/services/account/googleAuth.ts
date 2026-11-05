import {
  BackendAuthError,
  postSocialAuth,
  socialAuthErrorMessage,
  socialInvalidResponseMessage,
  socialNotReadyMessage,
  type SocialAuthResult,
} from "./socialAuthApi";

/**
 * 구글 로그인. Google Identity Services 단추의 창에서 credential(ID 토큰)을 받아
 * 백엔드(/auth/google)가 검증한다. 콘솔에는 redirect URI 가 아니라 JavaScript origin 을 등록한다.
 */
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

interface GoogleIdentity {
  initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
  renderButton: (
    parent: HTMLElement,
    options: { type: "icon"; shape: "circle"; size: "large"; theme: "outline"; locale: string },
  ) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentity } };
  }
}

let scriptPromise: Promise<void> | null = null;

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

export interface GoogleButtonHandlers {
  /** 구글 창에서 계정을 고른 뒤 서버 확인을 기다리는 동안 */
  onBusyChange: (isBusy: boolean) => void;
  /** 기존 회원이면 로그인할 사용자, 처음이면 가입 안내 */
  onResult: (result: SocialAuthResult) => void;
  /** 화면에 띄울 문구 */
  onError: (message: string) => void;
}

/** 구글은 초기화를 한 번만 받으므로 지금 화면의 단추로 답을 넘긴다. */
let activeHandlers: GoogleButtonHandlers | null = null;
let isInitialized = false;

async function finishGoogleLogin(credential: string | undefined, handlers: GoogleButtonHandlers) {
  handlers.onBusyChange(true);
  try {
    if (!credential) throw new Error(socialInvalidResponseMessage("google"));
    handlers.onResult(await postSocialAuth("google", { credential }));
  } catch (error) {
    const message = error instanceof BackendAuthError ? socialAuthErrorMessage("google", error) : "";
    handlers.onError(message || (error instanceof Error && error.message) || "Google 로그인에 실패했습니다.");
  } finally {
    handlers.onBusyChange(false);
  }
}

/**
 * 구글 공식 단추를 그린다. 브라우저에 구글 계정이 로그인돼 있지 않아도 창에서 로그인할 수 있다.
 * 키가 없거나 스크립트를 못 받으면 까닭을 던진다. 돌려준 함수로 이 화면의 답 받기를 끝낸다.
 */
export async function mountGoogleButton(parent: HTMLElement, handlers: GoogleButtonHandlers): Promise<() => void> {
  const clientId = requireClientId();
  await loadScript();
  const identity = window.google?.accounts?.id;
  if (!identity) throw new Error("Google 스크립트를 불러오지 못했습니다.");
  if (!isInitialized) {
    identity.initialize({
      client_id: clientId,
      callback: ({ credential }) => {
        if (activeHandlers) void finishGoogleLogin(credential, activeHandlers);
      },
    });
    isInitialized = true;
  }
  activeHandlers = handlers;
  identity.renderButton(parent, { type: "icon", shape: "circle", size: "large", theme: "outline", locale: "ko" });
  return () => {
    if (activeHandlers === handlers) activeHandlers = null;
  };
}
