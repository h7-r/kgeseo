import { useEffect, useRef, type RefObject } from "react";

/**
 * 가로로 밀리는 탭 줄(모바일)에서 고른 탭을 줄 안에 보인다 — 누를 때만이 아니라 주소 · 뒤로 가기로 바뀔 때,
 * 줄 폭이 바뀔 때(회전 · 늦게 들어온 웹폰트 · 글자 확대)도. 탭 줄의 scrollLeft 만 움직이고 문서 세로 위치는
 * 건드리지 않는다(scrollIntoView 는 문서까지 끌고 간다). 줄이 넘치지 않으면(PC) 아무것도 하지 않는다. 코덱스 구현 08 · 09회차
 */
export function useActiveTabInView(listRef: RefObject<HTMLElement | null>, activeId: string) {
  const lastIdRef = useRef<string | null>(null);
  /** 마지막으로 사용자가 탭을 바꾼 때 — 그 직후의 크기 변화(고른 탭 모양이 바뀌며 폭이 달라짐)는 같은 부드러운 이동으로 잇는다 */
  const changedAtRef = useRef(-Infinity);

  // 탭이 바뀌면 — 사용자가 바꿨을 때(첫 그림 뒤)만 부드럽게, 첫 그림은 바로.
  // StrictMode 의 두 번 실행에도 같은 탭이면 바꾼 것으로 치지 않는다
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const isTabChange = lastIdRef.current !== null && lastIdRef.current !== activeId;
    lastIdRef.current = activeId;
    if (isTabChange) changedAtRef.current = performance.now();
    revealActiveTab(list, isTabChange);
  }, [listRef, activeId]);

  // 크기 변화 · 늦게 들어온 글꼴 — 바로(탭을 막 바꾼 직후면 부드럽게 이어서). 탭 변경 효과와 떼어 두어야
  // 탭을 바꿀 때마다 이미 끝난 fonts.ready 가 「바로」로 부드러운 이동을 덮지 않는다(코덱스 구현 10회차).
  // 줄 상자뿐 아니라 탭 하나하나도 본다 — 글꼴이 바뀌거나 글자가 커지면 줄 폭은 그대로고 탭만 넓어진다
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let isAlive = true;
    const reveal = () => revealActiveTab(list, performance.now() - changedAtRef.current < 600);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => reveal());
    observer?.observe(list);
    list.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab) => observer?.observe(tab));
    if (document.fonts && document.fonts.status !== "loaded") {
      document.fonts.ready.then(() => isAlive && reveal());
    }
    return () => {
      isAlive = false;
      observer?.disconnect();
    };
  }, [listRef]);
}

/** 고른 탭이 줄 안(양옆 16px 여백)에 들어오게 탭 줄만 가로로 민다. 줄이 넘치지 않으면(PC) 아무것도 안 한다 */
function revealActiveTab(list: HTMLElement, isSmooth: boolean) {
  if (list.scrollWidth <= list.clientWidth) return;
  const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (!tab) return;
  const listBox = list.getBoundingClientRect();
  const tabBox = tab.getBoundingClientRect();
  const margin = 16;
  let delta = 0;
  if (tabBox.left < listBox.left + margin) delta = tabBox.left - listBox.left - margin;
  else if (tabBox.right > listBox.right - margin) delta = tabBox.right - listBox.right + margin;
  if (delta === 0) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  list.scrollTo({ left: list.scrollLeft + delta, behavior: isSmooth && !reduceMotion ? "smooth" : "auto" });
}
