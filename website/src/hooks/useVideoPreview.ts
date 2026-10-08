import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type RefObject,
} from "react";

import { openVideoModal } from "@/app/siteState";
import type { Video } from "@/data/videos";
import { prefersReducedMotion } from "@/lib/motionPreference";

interface VideoPreviewVideoProps {
  ref: RefObject<HTMLVideoElement | null>;
  src: string | undefined;
  poster: string | undefined;
  muted: true;
  loop: true;
  playsInline: true;
  preload: "metadata";
  "aria-hidden": true;
}

interface VideoPreviewTriggerProps {
  role: "button";
  tabIndex: number;
  "aria-label": string;
  onMouseEnter: MouseEventHandler<HTMLElement>;
  onMouseLeave: MouseEventHandler<HTMLElement>;
  onFocus: FocusEventHandler<HTMLElement>;
  onBlur: FocusEventHandler<HTMLElement>;
  onClick: MouseEventHandler<HTMLElement>;
  onKeyDown: KeyboardEventHandler<HTMLElement>;
}

interface VideoPreview {
  hasVideo: boolean;
  /** <video> 에 그대로 펼친다. 영상이 없으면 null. */
  videoProps: VideoPreviewVideoProps | null;
  /** 호버·클릭을 받는 칸(카드 전체 등)에 펼친다. 영상이 없으면 빈 객체. */
  triggerProps: Partial<VideoPreviewTriggerProps>;
}

/**
 * 작은 자리(경주 원 · 시나리오 카드)의 영상 한 편.
 * 호버하면 소리 없이 재생하고, 누르면 지금 장면과 화면 속 자리를 넘겨 큰 모달을 연다.
 * 모달에서 돌아오면 모달이 보던 장면부터 계속 흐른다(마우스가 떠나도 안 멈춘다).
 *
 * @param originRadius 모달이 커지기 시작할 때의 모서리 반경.
 */
export function useVideoPreview(video: Video | null | undefined, originRadius = "16px"): VideoPreview {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isFlowingRef = useRef(false); // 모달에서 돌아온 뒤 = 계속 재생
  const isHoveredRef = useRef(false);
  const isVisibleRef = useRef(true);
  const prefersReducedMotionRef = useRef(false);
  // 첫 화면과 회선을 나눠 쓰지 않도록 1500px 안으로 다가와야 영상·포스터 주소를 붙인다.
  const [isNear, setIsNear] = useState(() => typeof IntersectionObserver === "undefined");

  const syncPlayback = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    const shouldPlay =
      isVisibleRef.current && (isHoveredRef.current || isFlowingRef.current) && !prefersReducedMotionRef.current;
    if (shouldPlay)
      element.play().catch(() => {}); // 자동 재생이 막히면 포스터가 보인다.
    else if (!element.paused) element.pause();
  }, []);

  // 원에서 다른 갈래를 고르면 처음 상태로.
  useEffect(() => {
    isFlowingRef.current = false;
    isHoveredRef.current = false;
  }, [video]);

  useEffect(() => {
    const element = videoRef.current;
    if (isNear || !element || !video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "1500px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [video, isNear]);

  // 화면 밖이면 흐름 상태라도 멈춘다.
  useEffect(() => {
    prefersReducedMotionRef.current = prefersReducedMotion();
    const element = videoRef.current;
    if (!element || !video || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = Boolean(entry?.isIntersecting);
        syncPlayback();
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [video, syncPlayback]);

  const handleOpen = () => {
    const element = videoRef.current;
    if (!element || !video) return;
    element.pause(); // 소리 있는 쪽은 모달이 튼다.
    openVideoModal({
      video,
      origin: element,
      originRadius,
      startTime: element.currentTime || 0,
      onReturn: (time) => {
        const current = videoRef.current;
        if (!current) return;
        try {
          current.currentTime = time;
        } catch {
          // 아직 못 읽었으면 처음부터.
        }
        isFlowingRef.current = true;
        syncPlayback();
      },
    });
  };

  const setHovered = (hovered: boolean) => {
    isHoveredRef.current = hovered;
    syncPlayback();
  };

  return {
    hasVideo: Boolean(video),
    videoProps: video
      ? {
          ref: videoRef,
          src: isNear ? video.src : undefined,
          poster: isNear ? video.poster : undefined,
          muted: true, // 작은 자리는 늘 소리 없이.
          loop: true,
          playsInline: true,
          preload: "metadata", // 첫 장면·길이만 먼저, 나머지는 호버할 때.
          "aria-hidden": true,
        }
      : null,
    triggerProps: video
      ? {
          role: "button",
          tabIndex: 0,
          "aria-label": `${video.title} 영상 크게 보기`,
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
          onFocus: () => setHovered(true),
          onBlur: () => setHovered(false),
          onClick: handleOpen,
          onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleOpen();
            }
          },
        }
      : {},
  };
}
