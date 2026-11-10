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

/** 메뉴가 떠 있어도 게임으로 보내는 키 — T 는 예전처럼 게임으로 돌아가고, P 는 설정 창을 연다 */
const PASS_CODES: ReadonlySet<string> = new Set(["KeyT", "KeyP"]);
/**
 * 막을 키인가. 하는 중(종료 · 나가기 · 처음부터 다시)에는 전부 — T · P 로 메뉴가 내려가면 그 일이 뒤에서 끝나 게임 중에 페이지가 넘어가고,
 * 다시 연 메뉴에서 다른 일이 겹쳐 시작됐다(09회차 Codex)
 */
export const isBlockedByPauseMenu = (code: string) => isOpen && (isBusy || !PASS_CODES.has(code));
