/**
 * PC 멈춤 메뉴가 떠 있나 — 떠 있는 동안 게임 단축키는 T(계속하기) · P(설정)만 받는다(나주입장 08회차 Codex 「메뉴 중 게임 단축키를 막는다」).
 * 메뉴(PauseMenu)가 붙고 떨어질 때 적고, 본편 useGameKeys · 나주 useGameHotkeys · 나주 대화창이 읽는다.
 * 같은 창 캡처 단계에서 먼저 걸린 듣기를 메뉴가 앞지를 수 없어(등록 순서대로 돈다) 각자 읽게 했다.
 */
let isOpen = false;
/** 저장 · 지우기 · 나가기를 하는 중 — 이때는 T · P 도 막는다 */
let isBusy = false;

export const setPauseMenuOpen = (next: boolean) => {
  isOpen = next;
  if (!next) isBusy = false;
};
export const setPauseMenuBusy = (next: boolean) => {
  isBusy = next;
};
export const isPauseMenuOpen = () => isOpen;

/** 메뉴에서 연 창(설정 · 다시 보기)을 닫고 돌아오면 초점을 그 단추로 — 메뉴가 다시 붙을 때 한 번 꺼내 쓴다(16회차 Codex) */
let returnFocusId: string | null = null;
export const rememberPauseFocus = (id: string) => {
  returnFocusId = id;
};
/** 읽기만(그리기 중에 불러도 되게 — 개발 모드 StrictMode 는 초기값 함수를 두 번 부른다) */
export const peekPauseFocus = () => returnFocusId;
export const clearPauseFocus = () => {
  returnFocusId = null;
};
// 메뉴로 돌아오지 않고 게임으로 갔으면(다시 보기 카드에서 바로 계속하기 등) 잊는다 — 한참 뒤 메뉴가 엉뚱한 단추에 초점을 두지 않게
if (typeof document !== "undefined")
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement) clearPauseFocus();
  });

/** 메뉴가 떠 있어도 게임으로 보내는 키 — T 는 예전처럼 게임으로 돌아가고, P 는 설정 창을 연다 */
const PASS_CODES: ReadonlySet<string> = new Set(["KeyT", "KeyP"]);
/**
 * 막을 키인가. 하는 중(종료 · 나가기 · 처음부터 다시)에는 전부 — T · P 로 메뉴가 내려가면 그 일이 뒤에서 끝나 게임 중에 페이지가 넘어가고,
 * 다시 연 메뉴에서 다른 일이 겹쳐 시작됐다(09회차 Codex)
 */
export const isBlockedByPauseMenu = (code: string) => code === heldCode || (isOpen && (isBusy || !PASS_CODES.has(code)));

/**
 * 메뉴를 닫는 데 쓴 키(E = 계속하기, 미르 11/12) — 뗄 때까지 게임이 받지 않는다. 누른 채 두면 메뉴가 내려간 뒤 자동 반복이
 * 상호작용(본편은 반복 E 도 물건 쓰기)으로 샌다(자리 다시 잡기 03회차 Codex). 떼거나 창 초점을 잃으면 풀린다.
 */
let heldCode: string | null = null;
export const holdKeyUntilRelease = (code: string) => {
  heldCode = code;
};
if (typeof window !== "undefined") {
  window.addEventListener(
    "keyup",
    (event) => {
      if (event.code === heldCode) heldCode = null;
    },
    true,
  );
  window.addEventListener("blur", () => {
    heldCode = null;
  });
}
