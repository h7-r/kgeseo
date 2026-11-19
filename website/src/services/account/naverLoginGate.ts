/**
 * 네이버 로그인 문지기. 새 「왜곡」 네이버 앱은 검수가 끝날 때까지 「개발 중」 상태라
 * 멤버로 등록한 계정만 로그인된다(미르 11/19). 그동안 일반 사용자에게는 「준비 중」으로 보이고,
 * 시험하는 사람만 주소에 `?naver=preview` 를 붙여 이 탭에서 단추를 연다.
 *
 * 검수가 끝나면 Vercel 환경변수 `VITE_NAVER_LOGIN=open` 으로 모두에게 열린다(코드 수정 없음).
 */

/** 이 탭에서 시험용으로 열어 둔 표식(sessionStorage). 탭을 닫으면 사라진다. */
const PREVIEW_KEY = "waegok.naverPreview";
const PREVIEW_QUERY = "naver";
const PREVIEW_VALUE = "preview";

// Vite 는 import.meta.env.VITE_* 를 글자 그대로 써야 빌드 때 값을 넣어 준다.
const isOpenForEveryone = import.meta.env.VITE_NAVER_LOGIN === "open";

function hasPreviewQuery(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get(PREVIEW_QUERY) === PREVIEW_VALUE;
}

function readPreviewFlag(): boolean {
  try {
    return sessionStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

function writePreviewFlag() {
  try {
    sessionStorage.setItem(PREVIEW_KEY, "1");
  } catch {
    // 저장소가 막혀도 이번 화면에서는 주소의 표식으로 열린다.
  }
}

/** 지금 이 탭에서 네이버 단추를 눌러도 되는가. */
export function isNaverLoginOpen(): boolean {
  if (isOpenForEveryone) return true;
  if (hasPreviewQuery()) {
    writePreviewFlag();
    return true;
  }
  return readPreviewFlag();
}

/** 닫혀 있을 때 단추를 누르면 보이는 안내. */
export const NAVER_LOGIN_PENDING_MESSAGE = "네이버 로그인은 검수가 끝나면 열립니다. 지금은 Google 이나 이메일로 이용해 주세요.";
