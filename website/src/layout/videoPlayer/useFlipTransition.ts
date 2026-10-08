import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { closeVideoModal, type VideoModalRequest } from "@/app/siteState";
import { prefersReducedMotion } from "@/lib/motionPreference";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 화면 가운데 16:9 상자 — 가로·세로 둘 다 넘치지 않게. */
export function targetBox(): Box {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = vw < 700 ? 12 : 48;
  let width = Math.min(vw - margin * 2, 1440);
  let height = (width * 9) / 16;
  if (height > vh - margin * 2) {
    height = vh - margin * 2;
    width = (height * 16) / 9;
  }
  return { left: (vw - width) / 2, top: (vh - height) / 2, width, height };
}

export const toPx = (box: Box) => ({
  left: `${box.left}px`,
  top: `${box.top}px`,
  width: `${box.width}px`,
  height: `${box.height}px`,
});

const EXPAND_DURATION = 560;
const COLLAPSE_DURATION = 460;
const EASE_SMOOTH = "cubic-bezier(0.2, 0.8, 0.2, 1)";

interface FlipTransitionOptions {
  request: VideoModalRequest;
  backdropRef: RefObject<HTMLDivElement | null>;
  boxRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
}

/**
 * FLIP 으로 커진다 — 상자는 처음부터 마지막 자리에 그려 두고 element.animate 로 처음 자리에서 옮겨 온다.
 * fixed 상자 하나만 움직여 페이지 나머지는 다시 계산하지 않는다.
 */
export function useFlipTransition({ request, backdropRef, boxRef, videoRef }: FlipTransitionOptions) {
  const { origin, originRadius, startTime, onReturn } = request;
  const previousFocusRef = useRef<HTMLElement | SVGElement | null>(null);
  const isClosingRef = useRef(false);
  const [isExpanded, setIsExpanded] = useState(false); // 커지는 연출이 끝나야 조작 막대가 뜬다.
  const [isCollapsing, setIsCollapsing] = useState(false); // 제목·조작 막대를 먼저 걷어 영상만 줄어들게.

  const prefersReducedMotionRef = useRef(prefersReducedMotion());

  // 열기: 처음 자리에서 커진다.
  useLayoutEffect(() => {
    const active = document.activeElement;
    previousFocusRef.current = active instanceof HTMLElement || active instanceof SVGElement ? active : null;
    const end = targetBox();
    const start = origin.isConnected ? origin.getBoundingClientRect() : null;
    const element = boxRef.current;
    backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: "ease-out" });
    if (!element || !start || start.width < 2 || prefersReducedMotionRef.current) {
      element?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      setIsExpanded(true);
      return;
    }
    const animation = element.animate(
      [
        { ...toPx(start), borderRadius: originRadius },
        { ...toPx(end), borderRadius: "16px" },
      ],
      { duration: EXPAND_DURATION, easing: EASE_SMOOTH },
    );
    animation.onfinish = () => setIsExpanded(true);
    return () => animation.cancel();
  }, [origin, originRadius, backdropRef, boxRef]);

  // 닫기: 원래 자리로 줄어든 뒤 작은 자리가 모달이 보던 장면부터 이어서 흐른다.
  const close = useCallback(async () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    const element = videoRef.current;
    const watchedUntil = element?.currentTime ?? startTime;
    element?.pause();
    setIsCollapsing(true);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // 이미 전체 화면에서 나온 상태면 던진다. 무시해도 된다.
      }
    }
    const boxElement = boxRef.current;
    const end = origin.isConnected ? origin.getBoundingClientRect() : null;
    const isOnScreen = end && end.bottom > 0 && end.top < window.innerHeight && end.width > 2;
    const finish = () => {
      onReturn(watchedUntil);
      closeVideoModal();
    };
    backdropRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: prefersReducedMotionRef.current ? 150 : COLLAPSE_DURATION,
      easing: "ease-in",
      fill: "forwards",
    });
    if (!boxElement || !end || !isOnScreen || prefersReducedMotionRef.current) {
      const fade = boxElement?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" });
      if (fade) fade.onfinish = finish;
      else finish();
      return;
    }
    const current = boxElement.getBoundingClientRect();
    const animation = boxElement.animate(
      [
        { ...toPx(current), borderRadius: "16px" },
        { ...toPx(end), borderRadius: originRadius },
      ],
      { duration: COLLAPSE_DURATION, easing: EASE_SMOOTH, fill: "forwards" },
    );
    animation.onfinish = finish;
  }, [origin, originRadius, startTime, onReturn, backdropRef, boxRef, videoRef]);

  // 키보드 사용자가 길을 잃지 않게 원래 누른 자리로 초점을 돌려준다.
  const restoreFocus = useCallback(() => previousFocusRef.current?.focus({ preventScroll: true }), []);

  return { isExpanded, isCollapsing, close, restoreFocus };
}
