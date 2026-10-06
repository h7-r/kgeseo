const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let 스크립트준비 = null;
let credential대기 = null;

function 백엔드오류메시지(오류) {
  if (오류.status === 401) return "Google 인증에 실패했습니다. 다른 계정으로 다시 시도해 주세요.";
  if (오류.status === 409 && 오류.detail?.code === "account_link_required") return "이미 같은 이메일로 가입된 계정이 있습니다. 기존 로그인 후 Google 계정을 연결해 주세요.";
  if (오류.status === 503) return "Google 로그인이 아직 서버에 설정되지 않았습니다.";
  if (오류.status) return `Google 로그인 처리 중 문제가 생겼습니다. (${오류.status})`;
  return "Backend에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
}

function 설정확인() {
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID") {
    throw new Error("Google 로그인 키(VITE_GOOGLE_CLIENT_ID)가 아직 없습니다.");
  }
}

function 스크립트불러오기() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (스크립트준비) return 스크립트준비;

  스크립트준비 = new Promise((resolve, reject) => {
    const 이미있음 = document.querySelector(`script[src="${GOOGLE_SCRIPT_SRC}"]`);
    if (이미있음) {
      이미있음.addEventListener("load", () => resolve(), { once: true });
      이미있음.addEventListener("error", () => reject(new Error("Google 스크립트를 불러오지 못했습니다.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      스크립트준비 = null;
      reject(new Error("Google 스크립트를 불러오지 못했습니다."));
    };
    document.head.appendChild(script);
  });

  return 스크립트준비;
}

function credential받기() {
  if (credential대기) return credential대기;

  credential대기 = new Promise((resolve, reject) => {
    const 끝내기 = (오류, credential) => {
      credential대기 = null;
      if (오류) reject(오류);
      else resolve(credential);
    };

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (응답) => {
        if (!응답?.credential) {
          끝내기(new Error("Google credential을 받지 못했습니다."));
          return;
        }
        끝내기(null, 응답.credential);
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    window.google.accounts.id.prompt((알림) => {
      if (알림.isNotDisplayed?.() || 알림.isSkippedMoment?.()) {
        끝내기(new Error("Google 로그인 창을 열 수 없습니다. 팝업 차단 또는 브라우저 설정을 확인해 주세요."));
      } else if (알림.isDismissedMoment?.()) {
        끝내기(new Error("Google 로그인이 취소되었습니다."));
      }
    });
  });

  return credential대기;
}

async function backend검증(credential) {
  let 응답;
  try {
    응답 = await fetch("/api/v1/auth/google", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ credential }),
    });
  } catch (원인) {
    const 오류 = new Error("Backend에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    오류.status = null;
    오류.cause = 원인;
    throw 오류;
  }

  const 본문 = await 응답.json().catch(() => null);
  if (!응답.ok) {
    const 오류 = new Error(본문?.detail || 응답.statusText || "Google 인증에 실패했습니다.");
    오류.status = 응답.status;
    오류.detail = 본문?.detail;
    throw 오류;
  }

  return 본문;
}

function 로그인상태로바꾸기(사용자) {
  return {
    아이디: `${사용자.provider}:${사용자.subject}`,
    이메일: 사용자.email,
    이름: 사용자.name || 사용자.email,
    제공자: 사용자.provider,
    사진: 사용자.picture,
  };
}

export async function Google로로그인() {
  try {
    설정확인();
    await 스크립트불러오기();
    const credential = await credential받기();
    const 사용자 = await backend검증(credential);
    return 로그인상태로바꾸기(사용자);
  } catch (오류) {
    if (오류.status !== undefined) throw new Error(백엔드오류메시지(오류), { cause: 오류 });
    throw 오류;
  }
}
