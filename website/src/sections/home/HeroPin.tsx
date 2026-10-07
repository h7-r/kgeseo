import { useEffect, useRef } from "react";

import { HEADER_HEIGHT } from "@/layout/layoutMetrics";
import { clamp01 } from "@/lib/math";
import { prefersReducedMotion } from "@/lib/motionPreference";
import { useStageScale } from "@/lib/stage";
import { INTRO_CENTER_Y } from "@/pages/home/homeLayout";
import { setHeroCovering } from "@/state/heroCover";

import Hero from "./Hero";

/** 설계 좌표에서 히어로 아래 끝(헤더 + 히어로 1149). 홈 무대가 이만큼 끌어올려진다. */
export const HERO_BOTTOM = HEADER_HEIGHT + 1149;

/** sticky 가 붙어 있는 스크롤 거리. 트랙 350svh − 화면 100svh. */
const SCRUB_LENGTH = "250svh";

const smoothstep = (from: number, to: number, x: number) => {
  const t = clamp01((x - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/**
 * 화면에 붙은 채 스크롤한 만큼 히어로 영상이 흐르고, 트랙 끝까지 내려야 풀리는 핀.
 * 무대 안은 전부 absolute 에 transform 이 걸려 sticky 를 못 거니 무대 앞 일반 흐름에 두고,
 * 히어로를 무대와 같은 배율로 줄여 똑같이 보이게 한다. HeroVideo 가 data-pin-track 을 찾아 진행도를 읽는다.
 */
export default function HeroPin() {
  const scale = useStageScale();
  const height = Math.round(HERO_BOTTOM * scale);
  const trackRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // 동작 줄이기 사용자는 붙잡지 않는다 — 트랙 = 히어로 높이 그대로.
  const isReduced = prefersReducedMotion();

  useEffect(() => {
    const track = trackRef.current;
    const sticky = stickyRef.current;
    const inner = innerRef.current;
    if (!track || !sticky || !inner || isReduced) return;

    // 지금 창 크기에서 풀리는 자리와 소개가 화면 가운데 오는 자리(scrollY).
    const measure = () => {
      const s = window.innerWidth / 1920;
      const trackTop = track.getBoundingClientRect().top + window.scrollY;
      const distance = Math.max(1, track.offsetHeight - sticky.offsetHeight);
      const release = trackTop + distance + Math.round(HEADER_HEIGHT * s);
      // 무대는 HERO_BOTTOM 만큼 끌어올려져 trackTop + distance 에서 시작한다.
      const introCentered = Math.max(release, trackTop + distance + INTRO_CENTER_Y * s - window.innerHeight / 2);
      return { trackTop, distance, release, introCentered };
    };

    let frame = 0;
    // 멈춘 자리로 저절로 끌어가는 동작은 넣지 않는다 — 스크롤이 끊기는 느낌을 준다.
    const draw = () => {
      frame = 0;
      const { trackTop, distance, release, introCentered } = measure();
      const y = window.scrollY;
      const progress = clamp01((y - trackTop) / distance);
      const leaving = clamp01((y - release) / Math.max(1, introCentered - release));
      // 끝 장면에서 살짝 어두워지고, 올라가며 바탕으로 스며든다.
      const opacity = (1 - 0.2 * smoothstep(0.93, 1, progress)) * (1 - smoothstep(0, 0.8, leaving));
      inner.style.opacity = opacity.toFixed(3);
      // 불투명한 히어로가 창을 빈틈없이 덮고 있으면 뒤의 입체 배경을 재운다.
      const box = sticky.getBoundingClientRect();
      setHeroCovering(opacity >= 0.999 && box.top <= 0.5 && box.bottom >= window.innerHeight - 0.5);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    draw();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      setHeroCovering(false);
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [isReduced]);

  return (
    <div
      ref={trackRef}
      data-pin-track=""
      style={{
        position: "relative",
        zIndex: 2, // 끌어올린 무대보다 위, 헤더(20)보다 아래.
        height: isReduced ? `${height}px` : `calc(${height}px + ${SCRUB_LENGTH})`,
      }}
    >
      {/* top 을 헤더만큼 음수로 — 처음엔 히어로가 헤더와 함께 올라가다 화면 맨 위에 딱 붙는다. */}
      <div
        ref={stickyRef}
        data-pin-sticky=""
        style={{
          position: "sticky",
          top: `-${Math.round(HEADER_HEIGHT * scale)}px`,
          height: `${height}px`,
          overflow: "clip",
        }}
      >
        <div
          ref={innerRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "1920px",
            height: `${HERO_BOTTOM}px`,
            transformOrigin: "top left",
            transform: `scale(${scale})`,
            willChange: "opacity",
          }}
        >
          <Hero top={HEADER_HEIGHT} />
        </div>
      </div>
    </div>
  );
}
