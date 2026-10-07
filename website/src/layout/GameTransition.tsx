import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { OPENING_FILM } from "@/data/videos";
import { prefersReducedMotion } from "@/lib/motionPreference";
import { FONT } from "@/lib/style";
import { GAME_TRANSITION_PARAM } from "@/navigation/routes";
import { closeGameTransition, useGameTransitionDestination } from "@/state/gameTransition";
import { COLOR } from "@/styles/tokens";

// 게임 설정 "배경음악" 기본값(10 중 6). 게임 쪽도 같은 값으로 잇는다.
const FILM_VOLUME = 0.6;
// 사이트에서 틀고 넘어갈 시간(초). 짧으면 번쩍으로 보이고 길면 기다리게 된다. 나머지는 게임이 이어 튼다.
const SITE_PLAY_SECONDS = 2.6;
// 영상이 안 읽혀도(느린 회선·파일 없음) 이 시간이 지나면 넘어간다.
const MAX_WAIT_SECONDS = 4.5;

/**
 * "게임 시작" 뒤 게임 본편으로 페이지째 옮겨 가기까지 덮는 영상 막. App 에 한 번만 놓는다.
 * 사이트가 오프닝 영상을 틀다가 본 초를 주소에 붙여 넘기면, 게임이 같은 영상을 그 초부터 잇는다.
 */
export default function GameTransition() {
  const destination = useGameTransitionDestination();
  if (!destination) return null;
  // 주소가 바뀌면 안쪽 시계·상태를 처음부터.
  return createPortal(<TransitionCurtain key={destination} destination={destination} />, document.body);
}

interface TransitionCurtainProps {
  destination: string;
}

function TransitionCurtain({ destination }: TransitionCurtainProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hasLeftRef = useRef(false);
  const [isCovered, setIsCovered] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // 본 초를 주소에 붙여 페이지째 옮긴다. 두 번 가지 않게 잠근다.
    const leave = () => {
      if (hasLeftRef.current) return;
      hasLeftRef.current = true;
      const seconds = videoRef.current?.currentTime || 0;
      const nextUrl = new URL(destination, window.location.href);
      nextUrl.searchParams.set(GAME_TRANSITION_PARAM, seconds.toFixed(2));
      window.location.assign(nextUrl.toString());
    };

    const isReducedMotion = prefersReducedMotion();
    // 덮인 뒤에 뒤 페이지가 굴러가면 안 된다.
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    const coverFrame = requestAnimationFrame(() => setIsCovered(true));
    const startedAt = performance.now();
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      const elapsed = (performance.now() - startedAt) / 1000;
      const videoSeconds = video && !video.paused ? video.currentTime : 0;
      setProgress(Math.min(1, Math.max(videoSeconds / SITE_PLAY_SECONDS, elapsed / MAX_WAIT_SECONDS)));
      // 동작 줄이기를 켠 사람은 영상 없이 짧게 덮고 바로 간다.
      if (videoSeconds >= SITE_PLAY_SECONDS || elapsed >= MAX_WAIT_SECONDS || (isReducedMotion && elapsed >= 0.5)) {
        leave();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // 옮겨 가는 순간 HTML 을 새로 기다리지 않게 미리 받아 둔다.
    const prefetch = document.createElement("link");
    prefetch.rel = "prefetch";
    prefetch.href = destination;
    document.head.appendChild(prefetch);

    // 아직 안 넘어갔으면 Esc 로 취소한다.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !hasLeftRef.current) closeGameTransition();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelAnimationFrame(coverFrame);
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      document.documentElement.style.overflow = previousOverflow;
      prefetch.remove();
    };
  }, [destination]);

  // 게임에서 뒤로 오면 bfcache 가 덮인 채로 얼려 둔 페이지를 보여 준다. 돌아온 걸 알아채면 걷는다.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) closeGameTransition();
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="게임으로 이동하는 중"
      style={{ ...curtainStyle, opacity: isCovered ? 1 : 0 }}
    >
      {/* 누른 바로 그 순간이라 브라우저가 소리 있는 재생을 막지 않는다. */}
      <video
        src={OPENING_FILM.src}
        poster={OPENING_FILM.poster}
        ref={(video) => {
          videoRef.current = video;
          if (video) video.volume = FILM_VOLUME;
        }}
        playsInline
        autoPlay
        preload="auto"
        aria-hidden="true"
        style={videoStyle}
      />
      {/* 게임 쪽 로딩 화면도 글 없이 영상만이라 같은 모습으로 이어진다. 가는 줄로만 넘어가는 중을 알린다. */}
      <div style={progressTrackStyle} aria-hidden="true">
        <div style={{ ...progressBarStyle, transform: `scaleX(${progress})` }} />
      </div>
      <span style={hintStyle}>Esc 로 취소</span>
    </div>
  );
}

const curtainStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000, // 머리띠·영상 모달보다 위
  background: COLOR.bg,
  transition: "opacity .28s ease",
  cursor: "progress",
};

const videoStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const progressTrackStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: "2px",
  background: "rgba(159,178,234,0.18)",
  overflow: "hidden",
};

const progressBarStyle: CSSProperties = {
  height: "100%",
  background: "linear-gradient(90deg, #3a58b4, #9fb2ea)",
  transformOrigin: "left",
  transition: "transform .12s linear",
};

const hintStyle: CSSProperties = {
  position: "absolute",
  right: "clamp(24px, 4vw, 56px)",
  bottom: "clamp(40px, 9vh, 96px)",
  fontFamily: FONT.mono,
  fontSize: "12px",
  letterSpacing: "0.1em",
  color: "rgba(201,210,238,0.55)",
};
