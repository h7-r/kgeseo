import { 소셜상태읽기, 소셜상태지우기 } from "./소셜로그인.js";

let 진행중상태 = "";
let 진행중로그인 = null;

function 백엔드오류메시지(오류) {
  if (오류.status === 401) return "Naver 인증에 실패했습니다. 다시 시도해 주세요.";
  if (오류.status === 502) return "Naver 프로필을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (오류.status === 503) return "Naver 로그인이 아직 서버에 설정되지 않았습니다.";
  if (오류.status) return `Naver 로그인 처리 중 문제가 생겼습니다. (${오류.status})`;
  return "Backend에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
}

function 쿼리값읽기(검색) {
  const code = 검색.get("code") || "";
  const state = 검색.get("state") || "";
  const error = 검색.get("error") || "";
  if (error) throw new Error("Naver 로그인이 취소되었거나 실패했습니다.");
  if (!code) throw new Error("Naver authorization code를 받지 못했습니다.");
  if (!state) throw new Error("Naver state를 받지 못했습니다.");
  return { code, state };
}

function 상태확인(state) {
  const 저장된상태 = 소셜상태읽기();
  if (!저장된상태 || 저장된상태 !== state || !state.startsWith("네이버.")) {
    throw new Error("Naver 로그인 요청을 확인할 수 없습니다. 처음부터 다시 시도해 주세요.");
  }
}

async function backend검증(code, state) {
  let 응답;
  try {
    응답 = await fetch("/api/v1/auth/naver", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code, state }),
    });
  } catch (원인) {
    const 오류 = new Error("Backend에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    오류.status = null;
    오류.cause = 원인;
    throw 오류;
  }

  const 본문 = await 응답.json().catch(() => null);
  if (!응답.ok) {
    const 오류 = new Error(본문?.detail || 응답.statusText || "Naver 인증에 실패했습니다.");
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
    제공자: "naver",
    사진: 사용자.picture,
  };
}

export async function Naver콜백으로로그인(검색) {
  try {
    const { code, state } = 쿼리값읽기(검색);
    if (진행중로그인 && 진행중상태 === state) return 진행중로그인;

    상태확인(state);
    소셜상태지우기();
    진행중상태 = state;
    진행중로그인 = backend검증(code, state)
      .then((사용자) => 로그인상태로바꾸기(사용자))
      .finally(() => {
        진행중상태 = "";
        진행중로그인 = null;
      });
    return 진행중로그인;
  } catch (오류) {
    if (오류.status !== undefined) throw new Error(백엔드오류메시지(오류), { cause: 오류 });
    throw 오류;
  }
}
