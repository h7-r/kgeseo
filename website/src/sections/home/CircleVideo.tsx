import { useEffect, useRef, type CSSProperties } from "react";

import { prefersReducedMotion } from "@/lib/motionPreference";

const MAX_PLAYBACK_RATE = 8;
// 스크롤 속도(px/ms) → 배속 환산. 클수록 민감하다.
const SCROLL_GAIN = 1.4;

interface CircleVideoProps {
  src: string;
  poster?: string;
  style?: CSSProperties;
}

/**
 * 앙암바위 링 안의 사건 콘셉트 필름. 1배로 반복하다가 스크롤하면 그 속도만큼 빨리 흐른다.
 * 동작 줄이기 사용자에겐 재생 없이 첫 장면만 보여 준다.
 */
export default function CircleVideo({ src, poster, style }: CircleVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // 첫 화면과 회선을 나눠 쓰지 않도록 가까이 왔을 때 주소를 붙인다.
    const attachSource = () => {
      if (video.getAttribute("src")) return;
      if (poster) video.poster = poster;
      video.src = src;
    };
    if (prefersReducedMotion()) {
      if (poster) video.poster = poster;
      return;
    }

    let isVisible = false;
    let lastY = window.scrollY;
    let lastTime = performance.now();
    let playbackRate = 1;
    let frame = 0;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const y = window.scrollY;
      const speed = Math.abs(y - lastY) / Math.max(1, now - lastTime);
      lastY = y;
      lastTime = now;
      if (!isVisible) return;
      const target = Math.min(MAX_PLAYBACK_RATE, 1 + speed * SCROLL_GAIN);
      playbackRate += (target - playbackRate) * 0.15; // 멈추면 서서히 1배로
      if (video.readyState > 0) {
        try {
          if (Math.abs(video.playbackRate - playbackRate) > 0.02) video.playbackRate = Math.max(0.5, playbackRate);
        } catch {
          // 배속을 못 바꾸는 브라우저는 1배로 둔다.
        }
      }
    };

    // 루프는 가까이 있을 때만 돈다. 켤 때 기준 자리를 새로 잡아 멀리서 한 번에 온 거리를 속도로 읽지 않게 한다.
    const startLoop = () => {
      if (frame) return;
      lastY = window.scrollY;
      lastTime = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const stopLoop = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    // 1500px 안으로 들어오면 붙이고 재생한다 — 화면에 닿을 땐 이미 흐르고 있다.
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisible = Boolean(entry?.isIntersecting);
        if (isVisible) {
          attachSource();
          video.play().catch(() => {});
          startLoop();
        } else {
          video.pause();
          stopLoop();
        }
      },
      { rootMargin: "1500px 0px" },
    );
    observer.observe(video);

    return () => {
      stopLoop();
      observer.disconnect();
    };
  }, [src, poster]);

  return <video ref={videoRef} muted loop playsInline preload="auto" aria-hidden="true" style={style} />;
}
