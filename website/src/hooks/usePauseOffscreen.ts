import { useEffect, type RefObject } from "react";

/*
 * background-position · stroke-dashoffset · conic-gradient 각도를 돌리는 끝없는 장식은
 * 합성만으로 안 돼 매 프레임 다시 칠한다. 화면 밖(여유 200px)에 있을 때만 멈춘다.
 */
const ANIMATED_SELECTOR = ".flow-text, .stripe-text, .arc-glow, .pulse-light, .pulse-glow, .ring, .photo-ring";

/** root 안의 끝없는 장식 애니메이션이 화면 밖이면 .is-paused 를 붙인다. resetKey 가 바뀌면 다시 건다. */
export function usePauseOffscreen(rootRef: RefObject<HTMLElement | null>, resetKey?: unknown): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) entry.target.classList.toggle("is-paused", !entry.isIntersecting);
      },
      { rootMargin: "200px 0px" },
    );
    const seen = new WeakSet<Element>();
    const scan = () => {
      for (const el of root.querySelectorAll(ANIMATED_SELECTOR)) {
        if (seen.has(el)) continue;
        seen.add(el);
        observer.observe(el);
      }
    };
    scan();
    // lazy 화면처럼 늦게 붙는 구간도 잡는다.
    const mutationObserver = new MutationObserver(scan);
    mutationObserver.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [rootRef, resetKey]);
}
