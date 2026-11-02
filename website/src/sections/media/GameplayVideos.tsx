import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import playIcon from "@/assets/images/imgPlay2.svg";
import { openVideoModal } from "@/app/siteState";
import { GAMEPLAY_VIDEOS, type Video } from "@/data/videos";
import { depthRevealClass, useReveal, useScrollZoom, useTilt } from "@/hooks/motion";
import { prefersReducedMotion } from "@/lib/motionPreference";
import { FONT } from "@/lib/style";
import { sectionAnchor } from "@/navigation/subMenus";
import { COLOR } from "@/styles/tokens";

export const GALLERY_HEIGHT = 517;
export const FEATURED_HEIGHT = 715;

interface Challenge {
  video: Video;
  title: string;
  category: string;
  description: string;
}

// 나주 앙암바위를 처음부터 끝까지 푸는 차례대로 다섯 편. 위 갤러리에는 앞의 셋만 보인다.
// 끝(편지에 적힌 것)은 보여 주지 않는다.
const CHALLENGES: readonly Challenge[] = [
  {
    video: GAMEPLAY_VIDEOS.ferry,
    title: "꺼진 화톳불",
    category: "STAGE 01 · 나루터",
    description: "통발 셋 가운데 불씨가 든 하나를 끌어올려 화톳불을 다시 지펴라. 피어오른 연기가 길을 가리킨다.",
  },
  {
    video: GAMEPLAY_VIDEOS.ritual,
    title: "기우제",
    category: "STAGE 02 · 바위 아래",
    description: "돌탑을 마법진 홈에 맞추고 제물을 올리면 하늘이 열린다. 차오른 물 위의 돌 넷을 건져라.",
  },
  {
    video: GAMEPLAY_VIDEOS.cave,
    title: "강 밑 물굴",
    category: "STAGE 02 · 물굴",
    description: "갈라진 강 밑으로 내려간다. 숨이 다하기 전에 거품 자리를 찾아 고리문까지 가라.",
  },
  {
    video: GAMEPLAY_VIDEOS.curtain,
    title: "바람 장막",
    category: "STAGE 03 · 증언 능선",
    description: "능선에 바람 장막이 덮였다. 둥둥 뜨는 몸으로 날아간 것을 붙잡고, 기둥에 묶인 지게를 끌어 내려라.",
  },
  {
    video: GAMEPLAY_VIDEOS.birds,
    title: "깨어난 돌새",
    category: "STAGE 03 · 장승 문",
    description: "장승 고리를 새김대로 맞추면 횃불이 치솟고, 돌새가 껍질을 깨고 날아오른다.",
  },
];

const GALLERY_COUNT = 3;

interface GameplayVideosProps {
  top?: number;
  featuredTop?: number;
  pagerTop?: number;
}

/** 게임 영상 갤러리 · 고른 영상을 크게 보여 주는 카드 · 쪽번호. */
export default function GameplayVideos({ top = 0, featuredTop = 0, pagerTop = 0 }: GameplayVideosProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  // 사람이 직접 고르면 혼자 넘어가지 않는다. 보고 있는 걸 뺏으면 안 된다.
  const [hasInteracted, setHasInteracted] = useState(false);

  // 혼자 넘길 때는 시계 대신 큰 카드 영상이 끝나는 때에 넘긴다 — 퍼즐이 풀리는 장면을 끝까지 보여 준다.
  const advance = () => {
    if (!hasInteracted) setSelectedIndex((n) => (n + 1) % CHALLENGES.length);
  };

  const select = (n: number) => {
    setHasInteracted(true);
    setSelectedIndex(((n % CHALLENGES.length) + CHALLENGES.length) % CHALLENGES.length);
  };

  return (
    <>
      <section style={{ ...galleryStyle, top: `${top}px` }} {...sectionAnchor("videos")}>
        <div style={galleryLabelStyle}>
          <span>게임 영상</span>
        </div>
        <div style={{ display: "flex", gap: "16px", width: "100%", height: "260px" }}>
          {CHALLENGES.slice(0, GALLERY_COUNT).map((challenge, i) => (
            <GalleryCard
              key={challenge.title}
              {...challenge}
              order={i}
              isActive={selectedIndex === i}
              onSelect={() => select(i)}
            />
          ))}
        </div>
      </section>

      <FeaturedVideo
        top={featuredTop}
        challenge={CHALLENGES[selectedIndex]}
        shouldLoop={hasInteracted}
        onEnded={advance}
        onOpen={() => setHasInteracted(true)}
      />

      {/* 다섯 칸이 챌린지 다섯과 짝이다. 눌러 고를 수도, 두면 혼자 넘어간다. */}
      <div style={{ ...pagerStyle, top: `${pagerTop}px` }}>
        <button
          type="button"
          className="carousel-arrow carousel-arrow--prev"
          onClick={() => select(selectedIndex - 1)}
          aria-label="이전 챌린지"
        >
          ‹
        </button>
        {CHALLENGES.map((challenge, i) => (
          <button
            key={challenge.title}
            type="button"
            className={selectedIndex === i ? "pager__page is-active" : "pager__page"}
            style={{
              ...(selectedIndex === i ? activePageStyle : inactivePageStyle),
              border: "none",
              cursor: "pointer",
            }}
            onClick={() => select(i)}
            aria-label={`${i + 1}번째 챌린지 · ${challenge.title}`}
            aria-current={selectedIndex === i}
          >
            {i + 1}
          </button>
        ))}
        <button
          type="button"
          className="carousel-arrow carousel-arrow--next"
          onClick={() => select(selectedIndex + 1)}
          aria-label="다음 챌린지"
        >
          ›
        </button>
      </div>
    </>
  );
}

interface GalleryCardProps extends Challenge {
  order: number;
  isActive: boolean;
  onSelect: () => void;
}

/** 마우스를 따라 기울고 차례로 안쪽에서 걸어 나오는 작은 영상 카드. 올려 두면 소리 없이 미리 흐른다. */
function GalleryCard({ order, isActive, onSelect, ...challenge }: GalleryCardProps) {
  const { ref: tiltRef, onMouseMove, onMouseLeave } = useTilt<HTMLDivElement>(5);
  const [revealRef, isVisible] = useReveal<HTMLDivElement>();
  const videoRef = useRef<HTMLVideoElement>(null);

  const preview = (isHovered: boolean) => {
    const video = videoRef.current;
    if (!video || prefersReducedMotion()) return;
    if (isHovered) video.play().catch(() => {});
    else video.pause();
  };

  return (
    <div
      ref={revealRef}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={() => preview(true)}
      onFocus={() => preview(true)}
      onBlur={() => preview(false)}
      className={`gallery-card${isActive ? " is-active" : ""} u-tilt-scene ${depthRevealClass(isVisible)}`}
      style={{ ...galleryCardStyle, transitionDelay: `${order * 30}ms` }}
    >
      <div
        ref={tiltRef}
        onMouseMove={onMouseMove}
        onMouseLeave={() => {
          onMouseLeave();
          preview(false);
        }}
        className="u-tilt"
        style={{ width: "100%", height: "100%" }}
      >
        <VideoCard {...challenge}>
          {/* 첫 장면·길이만 먼저 받고, 나머지는 올려 둘 때 받는다 */}
          <video
            ref={videoRef}
            src={challenge.video.src}
            poster={challenge.video.poster}
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
            style={cardMediaStyle}
          />
        </VideoCard>
      </div>
    </div>
  );
}

interface FeaturedVideoProps {
  top: number;
  challenge: Challenge;
  /** 사람이 고른 뒤에는 그 영상을 되풀이한다. 아니면 끝날 때 다음으로 넘긴다 */
  shouldLoop: boolean;
  onEnded: () => void;
  onOpen: () => void;
}

/**
 * 위 갤러리에서 고른 영상을 크게. 스크롤에 맞춰 안쪽에서 다가왔다 앞으로 지나간다.
 * 화면에 들어와 있는 동안 소리 없이 흐르고, 누르면 지금 장면에서 이어 큰 플레이어로 커진다.
 */
function FeaturedVideo({ top, challenge, shouldLoop, onEnded, onOpen }: FeaturedVideoProps) {
  const scrollZoomRef = useScrollZoom<HTMLDivElement>({ enterScale: 0.9, exitScale: 1.05, depth: 110 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVisibleRef = useRef(false);

  // 고른 영상이 바뀌면 처음부터. 화면 밖이면 멈춘다.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || prefersReducedMotion()) return;
    const sync = () => {
      if (isVisibleRef.current) video.play().catch(() => {});
      else video.pause();
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = Boolean(entry?.isIntersecting);
        sync();
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [challenge]);

  const open = () => {
    const video = videoRef.current;
    if (!video) return;
    onOpen();
    video.pause(); // 소리 있는 쪽은 모달이 튼다.
    openVideoModal({
      video: challenge.video,
      origin: video,
      originRadius: "12px",
      startTime: video.currentTime || 0,
      onReturn: (time) => {
        const current = videoRef.current;
        if (!current) return;
        try {
          current.currentTime = time;
        } catch {
          // 아직 못 읽었으면 처음부터.
        }
        if (isVisibleRef.current) current.play().catch(() => {});
      },
    });
  };

  return (
    <div ref={scrollZoomRef} className="u-scroll-zoom" style={{ ...featuredStyle, top: `${top}px` }}>
      {/* key 를 바꿔야 바뀌는 순간 카메라 전환이 다시 돈다 */}
      <div
        key={challenge.title}
        className="u-swap-in"
        role="button"
        tabIndex={0}
        aria-label={`${challenge.video.title} 영상 크게 보기`}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        }}
        style={{ width: "100%", height: "100%", cursor: "pointer" }}
      >
        <VideoCard {...challenge} large>
          <video
            ref={videoRef}
            src={challenge.video.src}
            poster={challenge.video.poster}
            muted
            loop={shouldLoop}
            playsInline
            preload="auto"
            aria-hidden="true"
            onEnded={onEnded}
            style={cardMediaStyle}
          />
        </VideoCard>
      </div>
    </div>
  );
}

interface VideoCardProps extends Challenge {
  large?: boolean;
  /** 카드 바탕에 깔리는 영상 */
  children: ReactNode;
}

function VideoCard({ title, category, description, large = false, children }: VideoCardProps) {
  return (
    <div className="interactive-card" style={cardStyle}>
      {children}
      <div style={playButtonStyle}>
        <img
          loading="lazy"
          decoding="async"
          src={playIcon}
          alt=""
          style={{ width: "24px", height: "24px", display: "block" }}
        />
      </div>
      {/* 아래쪽 설명은 바탕색으로 녹여 내린다 */}
      <div style={captionStyle}>
        <div style={{ fontFamily: FONT.display, fontSize: large ? "32px" : "24px", color: COLOR.textBright }}>
          {title}
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span style={{ fontFamily: FONT.mono, fontSize: "16px", color: COLOR.accent, textTransform: "uppercase" }}>
            {category}
          </span>
          {large && <span style={nowPlayingStyle}>NOW PLAYING</span>}
        </div>
        <div style={{ fontFamily: FONT.body, fontSize: "16px", lineHeight: 1.5, color: COLOR.textSubtle }}>
          {description}
        </div>
      </div>
    </div>
  );
}

const galleryStyle: CSSProperties = {
  position: "absolute",
  left: "220px",
  width: "1480px",
  height: `${GALLERY_HEIGHT}px`,
  padding: "24px 32px",
  borderRadius: "16px",
  border: "1.5px solid rgba(46,72,137,0.6)",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  overflow: "hidden",
  boxSizing: "border-box",
};

const galleryLabelStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  fontFamily: FONT.mono,
  fontSize: "16px",
  color: COLOR.accent,
};

const galleryCardStyle: CSSProperties = {
  flex: "1 0 0",
  minWidth: 0,
  height: "335px",
  cursor: "pointer",
  outlineOffset: "2px",
  borderRadius: "12px",
};

const featuredStyle: CSSProperties = {
  position: "absolute",
  left: "220px",
  width: "1480px",
  height: `${FEATURED_HEIGHT}px`,
  willChange: "transform",
};

// 큰 카드에만 붙는다. 위 목록과 같은 제목이 두 번 보이는 까닭을 알려 준다.
const nowPlayingStyle: CSSProperties = {
  fontFamily: "inherit",
  fontSize: "15px",
  fontWeight: 700,
  letterSpacing: "1px",
  color: COLOR.accent,
  padding: "3px 9px",
  borderRadius: "999px",
  border: "1px solid rgba(50,82,150,0.45)",
  background: "rgba(46,72,137,0.12)",
  whiteSpace: "nowrap",
};

const cardStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  borderRadius: "12px",
  border: `1px solid ${COLOR.border}`,
  overflow: "hidden",
  boxSizing: "border-box",
};

const cardMediaStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const playButtonStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "calc(50% + 0.5px)",
  transform: "translate(-50%, -50%)",
  width: "56px",
  height: "56px",
  borderRadius: "28px",
  background: "rgba(255,255,255,0.1)",
  border: `1px solid ${COLOR.navy}`,
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};

const captionStyle: CSSProperties = {
  position: "absolute",
  left: "-1px",
  right: "-1px",
  bottom: "-1px",
  // 높이를 못 박으면 큰 카드에서 설명 줄이 잘린다. 최소 높이만 준다.
  minHeight: "96px",
  padding: "22px 16px 16px",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(1,4,10,0.85) 45%, #01040a 100%)",
  boxSizing: "border-box",
};

const pagerStyle: CSSProperties = {
  position: "absolute",
  left: "772px",
  display: "flex",
  gap: "16px",
  alignItems: "center",
};

const pageBaseStyle: CSSProperties = {
  width: "40px",
  height: "40px",
  borderRadius: "20px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: FONT.mono,
  fontSize: "16px",
  boxSizing: "border-box",
};

// 흰 글자가 6.3:1 로 또렷하게 읽히는 진한 남색을 바탕으로 쓴다.
const activePageStyle: CSSProperties = {
  ...pageBaseStyle,
  background: COLOR.navyDeep,
  color: COLOR.white,
  fontWeight: 700,
};
const inactivePageStyle: CSSProperties = {
  ...pageBaseStyle,
  background: "rgba(9,14,31,0.8)",
  border: `1px solid ${COLOR.border}`,
  color: COLOR.textMuted,
};
