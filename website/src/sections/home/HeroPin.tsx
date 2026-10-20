import { useEffect, useRef } from "react";

import { setHeroCovering } from "@/app/siteState";
import { HEADER_HEIGHT, useStageScale } from "@/lib/layout";
import { clamp01, smoothstep } from "@/lib/math";
import { prefersReducedMotion } from "@/lib/motionPreference";

import Hero from "./Hero";
import { INTRO_CENTER_Y } from "./homeLayout";

/** 설계 좌표에서 히어로 아래 끝(헤더 + 히어로 1149). 홈 무대가 이만큼 끌어올려진다. */
export const HERO_BOTTOM = HEADER_HEIGHT + 1149;

/** sticky 가 붙어 있는 스크롤 거리. 트랙 350svh − 화면 100svh. */
const SCRUB_LENGTH = "250svh";

/**
 * 영상을 스크롤에 묶을지. 끄면 히어로를 붙잡지 않고 영상이 혼자 반복 재생된다(줌·흔들림 연출도 같이 꺼진다).
 * 지금은 끈다 — 붙잡혀 있는 동안 히어로 아래로 다음 장면이 비쳐 보였다.
 */
const IS_SCROLL_SCRUB = false;

/**
 * 히어로 자리. IS_SCROLL_SCRUB 이면 화면에 붙은 채 스크롤한 만큼 영상이 흐르고 트랙 끝까지 내려야 풀린다.
 * 아니면 보통 구역처럼 올라가며 바탕으로 스며든다.
 * 무대 안은 전부 absolute 에 transform 이 걸려 sticky 를 못 거니 무대 앞 일반 흐름에 두고,
 * 히어로를 무대와 같은 배율로 줄여 똑같이 보이게 한다.
 * HeroVideo 는 data-pin-sticky 가 있을 때만 진행도를 읽어 스크럽하고, 없으면 반복 재생한다.
 * data-pin-track 은 늘 달아 둔다 — 머리글 스냅이 히어로 칸을 이걸로 잰다.
 */
export default function HeroPin() {
  const scale = useStageScale();
  const height = Math.round(HERO_BOTTOM * scale);
  const trackRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // 동작 줄이기 사용자는 붙잡지 않는다 — 트랙 = 히어로 높이 그대로.
  const isReduced = prefersReducedMotion();
  const isPinned = IS_SCROLL_SCRUB && !isReduced;

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
      // 끝 장면에서 살짝 어두워지고, 올라가며 바탕으로 스며든다. 붙잡지 않으면 진행도가 없어 어두워지지 않는다.
      const endDim = isPinned ? 0.2 * smoothstep(0.93, 1, progress) : 0;
      const opacity = (1 - endDim) * (1 - smoothstep(0, 0.8, leaving));
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
  }, [isReduced, isPinned]);

  return (
    <div
      ref={trackRef}
      data-pin-track=""
      style={{
        position: "relative",
        zIndex: 2, // 끌어올린 무대보다 위, 헤더(20)보다 아래.
        height: isPinned ? `calc(${height}px + ${SCRUB_LENGTH})` : `${height}px`,
      }}
    >
      {/* top 을 헤더만큼 음수로 — 처음엔 히어로가 헤더와 함께 올라가다 화면 맨 위에 딱 붙는다. */}
      <div
        ref={stickyRef}
        data-pin-sticky={isPinned ? "" : undefined}
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
