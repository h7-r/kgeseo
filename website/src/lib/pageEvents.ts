/** 주소가 바뀌어 새 쪽이 그려졌을 때 window 에 쏘는 이벤트. */
export const PAGE_CHANGE_EVENT = "site:pagechange";

export function dispatchPageChange() {
  window.dispatchEvent(new Event(PAGE_CHANGE_EVENT));
}

// 코드가 직접 부른 scrollTo 는 사용자의 스크롤로 치지 않는다(배경 깨우기·관성 계산에서 뺀다).
let programmaticScroll = false;

export function scrollToTopSilently() {
  if (window.scrollY !== 0) programmaticScroll = true;
  window.scrollTo({ top: 0, behavior: "auto" });
}

/** 방금 일어난 스크롤이 코드가 일으킨 것이면 true 를 돌려주고 표시를 지운다. */
export function consumeProgrammaticScroll(): boolean {
  const wasProgrammatic = programmaticScroll;
  programmaticScroll = false;
  return wasProgrammatic;
}
