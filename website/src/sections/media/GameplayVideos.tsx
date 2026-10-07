import { useEffect, useState, type CSSProperties } from "react";

import backgroundImage1 from "@/assets/images/imgBg.webp";
import backgroundImage2 from "@/assets/images/imgBg1.webp";
import playIcon from "@/assets/images/imgPlay2.svg";
import videoCard1 from "@/assets/images/imgVideoCard1.webp";
import videoCard2 from "@/assets/images/imgVideoCard2.webp";
import videoCard3 from "@/assets/images/imgVideoCard3.webp";
import { approachClass, usePassBy, useReveal, useTilt } from "@/hooks/motion";
import { prefersReducedMotion } from "@/lib/motionPreference";
import { FONT } from "@/lib/style";
import { sectionAnchor } from "@/navigation/subMenus";
import { COLOR } from "@/styles/tokens";

export const GALLERY_HEIGHT = 517;
export const FEATURED_HEIGHT = 715;

interface Challenge {
  image: string;
  title: string;
  category: string;
  description: string;
}

// 아래 쪽번호가 다섯 칸이라 챌린지도 다섯으로 맞춘다. 위 갤러리에는 앞의 셋만 보인다.
const CHALLENGES: readonly Challenge[] = [
  {
    image: videoCard1,
    title: "탈출의 시작",
    category: "GAMEPLAY",
    description: "첫 번째 방에서의 긴장감 넘치는 탈출 시퀀스. 숨겨진 단서를 찾아 퍼즐을 풀어라.",
  },
  {
    image: videoCard2,
    title: "암호 해독 챌린지",
    category: "PUZZLE",
    description: "고대 문자와 현대 암호가 뒤섞인 난이도 최상의 퍼즐. 당신의 두뇌를 시험하라.",
  },
  {
    image: videoCard3,
    title: "최후의 대결",
    category: "CLIMAX",
    description: "모든 단서가 하나로 모이는 클라이막스. 진실을 밝혀낼 수 있는가?",
  },
  {
    image: backgroundImage1,
    title: "지워진 기록 복원",
    category: "RESTORE",
    description: "누군가 지운 실험 일지. 남은 자국만으로 사라진 문장을 되살려라.",
  },
  {
    image: backgroundImage2,
    title: "멈춘 시계 탈출",
    category: "TIME ATTACK",
    description: "시계가 다시 움직이기 전까지. 초침이 도는 순간 문은 닫힌다.",
  },
];

const GALLERY_COUNT = 3;

/** 혼자 넘어가는 간격(ms). 읽고 그림을 볼 시간이 필요해 넉넉히 잡는다. */
const AUTO_ADVANCE_INTERVAL = 5200;

interface GameplayVideosProps {
  top?: number;
  featuredTop?: number;
  pagerTop?: number;
}

/** 게임 영상 갤러리 · 고른 영상을 크게 보여 주는 카드 · 쪽번호. */
export default function GameplayVideos({ top = 0, featuredTop = 0, pagerTop = 0 }: GameplayVideosProps) {
  const [selected, setSelected] = useState(0);
  // 사람이 직접 고르면 자동 넘김을 멈춘다. 보고 있는 걸 뺏으면 안 된다.
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    if (hasInteracted) return;
    if (prefersReducedMotion()) return;
    const timer = window.setInterval(() => setSelected((n) => (n + 1) % CHALLENGES.length), AUTO_ADVANCE_INTERVAL);
    return () => clearInterval(timer);
  }, [hasInteracted]);

  const select = (n: number) => {
    setHasInteracted(true);
    setSelected(((n % CHALLENGES.length) + CHALLENGES.length) % CHALLENGES.length);
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
              active={selected === i}
              onSelect={() => select(i)}
            />
          ))}
        </div>
      </section>

      <FeaturedVideo top={featuredTop} challenge={CHALLENGES[selected]} />

      {/* 다섯 칸이 챌린지 다섯과 짝이다. 눌러 고를 수도, 두면 혼자 넘어간다. */}
      <div style={{ ...pagerStyle, top: `${pagerTop}px` }}>
        <button
          type="button"
          className="pager-arrow"
          style={arrowStyle}
          onClick={() => select(selected - 1)}
          aria-label="이전 챌린지"
        >
          ‹
        </button>
        {CHALLENGES.map((challenge, i) => (
          <button
            key={challenge.title}
            type="button"
            className={selected === i ? "pager-page is-active" : "pager-page"}
            style={{ ...(selected === i ? activePageStyle : inactivePageStyle), border: "none", cursor: "pointer" }}
            onClick={() => select(i)}
            aria-label={`${i + 1}번째 챌린지 · ${challenge.title}`}
            aria-current={selected === i}
          >
            {i + 1}
          </button>
        ))}
        <button
          type="button"
          className="pager-arrow"
          style={arrowStyle}
          onClick={() => select(selected + 1)}
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
  active: boolean;
  onSelect: () => void;
}

/** 마우스를 따라 기울고 차례로 안쪽에서 걸어 나오는 작은 영상 카드. */
function GalleryCard({ order, active, onSelect, ...challenge }: GalleryCardProps) {
  const { ref: tiltRef, onMouseMove, onMouseLeave } = useTilt<HTMLDivElement>(5);
  const [revealRef, visible] = useReveal<HTMLDivElement>();

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
      className={`gallery-card${active ? " is-active" : ""} tilt-scene ${approachClass(visible)}`}
      style={{ ...galleryCardStyle, transitionDelay: `${order * 30}ms` }}
    >
      <div
        ref={tiltRef}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        className="tilt"
        style={{ width: "100%", height: "100%" }}
      >
        <VideoCard {...challenge} />
      </div>
    </div>
  );
}

interface FeaturedVideoProps {
  top: number;
  challenge: Challenge;
}

/** 위 갤러리에서 고른 영상을 크게. 스크롤에 맞춰 안쪽에서 다가왔다 앞으로 지나간다. */
function FeaturedVideo({ top, challenge }: FeaturedVideoProps) {
  const passByRef = usePassBy<HTMLDivElement>({ enterScale: 0.9, exitScale: 1.05, depth: 110 });

  return (
    <div ref={passByRef} className="pass-by" style={{ ...featuredStyle, top: `${top}px` }}>
      {/* key 를 바꿔야 바뀌는 순간 카메라 전환이 다시 돈다 */}
      <div key={challenge.title} className="camera-zoom" style={{ width: "100%", height: "100%" }}>
        <VideoCard {...challenge} large />
      </div>
    </div>
  );
}

interface VideoCardProps extends Challenge {
  large?: boolean;
}

function VideoCard({ image, title, category, description, large = false }: VideoCardProps) {
  return (
    <div className="card" style={cardStyle}>
      <img loading="lazy" decoding="async" src={image} alt="" style={cardImageStyle} />
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

const cardImageStyle: CSSProperties = {
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

const arrowStyle: CSSProperties = {
  width: "40px",
  height: "40px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: FONT.body,
  fontSize: "24px",
  color: COLOR.textSubtle,
  cursor: "pointer",
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
