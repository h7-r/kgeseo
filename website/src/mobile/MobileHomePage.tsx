/**
 * 모바일 홈 — 데스크톱 홈(1920 무대 · 핀 스크롤 · 3D 강 · WebGL 히어로 영상)과 같은 글 · 사진을 세로 한 단으로.
 * 무거운 것은 뺀다: 히어로는 1.6MB 짧은 반복 영상(소리 없음 · 화면 안에서만), 사건 영상은 눌렀을 때만 받는 기본 플레이어.
 * 가입 폼은 홈에 두지 않고 가입 · 로그인 화면으로 보낸다(소셜 가입 마무리도 전용 화면 — SocialCallbackPage).
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

import mokpoPhoto from "@/assets/images/imgBg.webp";
import suncheonPhoto from "@/assets/images/imgBg1.webp";
import yeosuPhoto from "@/assets/images/imgBg2.webp";
import { NAJU_FILM } from "@/data/videos";
import { FONT, gradientText } from "@/lib/style";
import { ROUTES, START_GAME, useSiteNavigate } from "@/navigation/routes";
import { useSessionUser } from "@/services/session";
import { COLOR, GRADIENT } from "@/styles/tokens";

import MobilePage from "./MobilePage";
import SignedUpNotice from "./SignedUpNotice";
import {
  bodyTextStyle,
  cardStyle,
  eyebrowStyle,
  headingStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionStyle,
} from "./mobileStyles";

const HERO_LOOP = { src: "/hero-ambient-v2.mp4", poster: "/hero-ambient-v2-poster.webp" };

const STATS = [
  { value: "1", label: "공개 맵 · 나주" },
  { value: "4", label: "출시 예정 지역" },
  { value: "∞", label: "숨겨진 보상" },
];

const STEPS = [
  {
    title: "지역을 고른다",
    tag: "지금 열림 · 나주",
    text: "지도에서 전설이 잠든 땅을 고르세요. 첫 무대는 나주 앙암바위입니다.",
  },
  {
    title: "사건을 푼다",
    tag: "1인칭 3D 추리",
    text: "1인칭으로 현장을 걷고 단서를 모아, 어긋난 기록을 바로잡으세요.",
  },
  {
    title: "현장에서 보상을 연다",
    tag: "출시 예정",
    text: "게임에서 찾아낸 장소를 실제로 찾아가면 숨겨진 보상이 열립니다.",
  },
];

const FACTS = [
  { value: "1인", label: "플레이" },
  { value: "15~25분", label: "한 판" },
  { value: "설치 없이", label: "브라우저" },
];

const MISSION_SPECS = [
  { label: "난이도", value: "★★★☆☆" },
  { label: "플레이 시간", value: "15~25분" },
  { label: "플레이 인원", value: "1명" },
];

const SCENARIOS = [
  {
    region: "목포",
    title: "갓바위의 전설",
    text: "성자가 쉬어 가며 두고 간 갓이 바위로 굳었다. 바닷가 갓바위에 남은 단서를 찾아라.",
    photo: mokpoPhoto,
  },
  {
    region: "여수",
    title: "거북선의 비밀",
    text: "전라좌수영의 바다를 지키던 거북선. 거북 머리가 가리키는 곳에 봉인된 기록을 찾아라.",
    photo: yeosuPhoto,
  },
  {
    region: "순천",
    title: "순천만의 비밀",
    text: "갈대숲 사이로 굽이치는 S자 물길. 물길이 멈추는 자리에 숨은 마지막 단서를 찾아라.",
    photo: suncheonPhoto,
  },
];

const CLOSING_POINTS = [
  "브라우저에서 바로 시작합니다. 설치할 것이 없습니다.",
  "한 판은 15~25분. 앉은 자리에서 끝납니다.",
  "혼자 하는 1인칭 추리입니다. 일행을 모으지 않아도 됩니다.",
  "처음이어도 괜찮습니다. 복도 튜토리얼에서 조작부터 익힙니다.",
  "휴대폰은 가로로 돌려 플레이합니다. 화면 왼쪽으로 걷고 오른쪽으로 둘러봅니다.",
];

/** 데이터 절약 모드 · 움직임 줄이기면 히어로 영상을 받지 않고 포스터만 */
function canAutoplay(): boolean {
  if (typeof window === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return false;
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** 화면 밖으로 나가면 멈추고 돌아오면 다시 튼다 — 휴대폰 배터리 · 데이터 */
function usePlayWhileVisible() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void video.play().catch(() => {});
      else video.pause();
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, []);
  return ref;
}

export default function MobileHomePage() {
  const navigate = useSiteNavigate();
  const user = useSessionUser();
  const heroVideoRef = usePlayWhileVisible();

  return (
    <MobilePage>
      {/* 히어로 — 짧은 반복 영상(소리 없음). 데이터 절약 모드 · 움직임 줄이기에서는 포스터만 */}
      <section style={heroStyle}>
        {canAutoplay() ? (
          <video
            ref={heroVideoRef}
            src={HERO_LOOP.src}
            poster={HERO_LOOP.poster}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
            aria-hidden="true"
            style={heroVideoStyle}
          />
        ) : (
          <img src={HERO_LOOP.poster} alt="" aria-hidden="true" style={heroVideoStyle} />
        )}
        <div style={heroShadeStyle} />
        <div style={{ ...sectionStyle, position: "relative", paddingTop: 120, paddingBottom: 36 }}>
          <SignedUpNotice />
          <h1 style={heroTitleStyle}>
            ESCAPE
            <br />
            <span style={gradientText(GRADIENT.titleFrost)}>THE LEGEND</span>
          </h1>
          <p style={{ ...bodyTextStyle, color: COLOR.textBright }}>
            지역의 전설 속으로 들어가 지워진 기록을 되찾는 1인칭 방탈출 어드벤처
          </p>
          <div style={buttonRowStyle}>
            <button type="button" style={primaryButtonStyle} onClick={() => navigate(START_GAME)}>
              플레이하기
            </button>
            <button type="button" style={secondaryButtonStyle} onClick={() => navigate(ROUTES.about)}>
              게임 소개
            </button>
          </div>
        </div>
      </section>

      {/* 소개 · 숫자 */}
      <Section>
        <p style={bodyTextStyle}>
          지역의 역사와 설화로 만든 몰입형 방탈출 게임. 사건을 풀고 실제로 그 지역을 찾아가면 숨겨진 보상이 열립니다.
        </p>
        <p style={bodyTextStyle}>
          잊혀 가는 지역의 이야기를 게임으로 되살리고, 당신의 발걸음으로 그 지역을 다시 빛나게 하세요.
        </p>
        <div style={statsStyle}>
          {STATS.map(({ value, label }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={statValueStyle}>{value}</div>
              <div style={statLabelStyle}>{label}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* 화면 속 사건이, 현실의 여행이 된다 */}
      <Section>
        <p style={eyebrowStyle}>How it works</p>
        <h2 style={headingStyle}>
          화면 속 사건이,
          <br />
          <span style={gradientText(GRADIENT.titleBlue)}>현실의 여행이 된다</span>
        </h2>
        <img src="/case.webp" alt="안개 낀 영산강 위로 솟은 앙암바위 절벽" loading="lazy" style={photoStyle} />
        <ol style={stepsStyle}>
          {STEPS.map(({ title, tag, text }, index) => (
            <li key={title} style={{ ...cardStyle, padding: 16 }}>
              {/* 글자를 키운 기기에서 제목 · 꼬리표가 한 줄에 안 들어가면 꼬리표가 다음 줄로(카드가 화면 밖으로 밀리지 않게) */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span style={stepTitleStyle}>
                  <span style={{ color: COLOR.accent, marginRight: 8 }}>{`0${index + 1}`}</span>
                  {title}
                </span>
                <span style={chipStyle}>{tag}</span>
              </div>
              <p style={{ ...bodyTextStyle, fontSize: "14px", marginTop: 8 }}>{text}</p>
            </li>
          ))}
        </ol>
        <div style={factsStyle}>
          {FACTS.map(({ value, label }) => (
            <div key={value}>
              <div style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: "16px", color: COLOR.textBright }}>
                {value}
              </div>
              <div style={statLabelStyle}>{label}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* 첫 사건 — 나주 앙암바위 */}
      <Section>
        <p style={eyebrowStyle}>Region No. 04 · Mission active</p>
        <h2 style={headingStyle}>
          SECRET OF ANGAM
          <br />
          <span style={{ fontFamily: FONT.body, fontWeight: 800, fontSize: "22px" }}>앙암바위의 비밀</span>
        </h2>
        <p style={bodyTextStyle}>
          영산강 절벽 앙암바위에 얽힌 옛이야기가 지워지고 있습니다. 나루터에서 능선까지 흩어진 단서를 모아 사라진 전설을
          되살리세요.
        </p>
        {/* 눌렀을 때만 받는다(11MB) — 기본 플레이어라 기기 전체 화면 · 소리 조절이 그대로 된다 */}
        <video src={NAJU_FILM.src} poster={NAJU_FILM.poster} controls playsInline preload="none" style={filmStyle} />
        <div style={specsStyle}>
          {MISSION_SPECS.map(({ label, value }) => (
            <div key={label} style={{ ...cardStyle, padding: "12px 10px", textAlign: "center" }}>
              <div style={statLabelStyle}>{label}</div>
              <div
                style={{
                  fontFamily: FONT.body,
                  fontWeight: 700,
                  fontSize: "15px",
                  color: COLOR.textBright,
                  marginTop: 4,
                }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
        <div style={buttonRowStyle}>
          <button type="button" style={primaryButtonStyle} onClick={() => navigate(START_GAME)}>
            지금 플레이하기
          </button>
        </div>
      </Section>

      {/* 출시 예정 지역 — 옆으로 밀어 넘긴다 */}
      <Section>
        <p style={eyebrowStyle}>Coming soon</p>
        <h2 style={headingStyle}>다음 전설</h2>
        <div style={carouselStyle}>
          {SCENARIOS.map(({ region, title, text, photo }) => (
            <article key={region} style={scenarioCardStyle}>
              <img src={photo} alt="" loading="lazy" style={scenarioPhotoStyle} />
              <div style={{ padding: 14 }}>
                <span style={chipStyle}>{region} · 출시 예정</span>
                <h3 style={{ ...stepTitleStyle, margin: "10px 0 0" }}>{title}</h3>
                <p style={{ ...bodyTextStyle, fontSize: "14px", marginTop: 6 }}>{text}</p>
              </div>
            </article>
          ))}
        </div>
      </Section>

      {/* 마무리 */}
      <Section>
        <h2 style={{ ...headingStyle, textAlign: "center" }}>
          전설 속으로,
          <br />
          <span style={gradientText(GRADIENT.titleBlue)}>탈출을 시작하라</span>
        </h2>
        <ul style={pointsStyle}>
          {CLOSING_POINTS.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <div style={{ ...buttonRowStyle, justifyContent: "center" }}>
          <button type="button" style={primaryButtonStyle} onClick={() => navigate(START_GAME)}>
            지금 시작하기
          </button>
        </div>
        {!user && (
          <div style={{ ...cardStyle, marginTop: 24, textAlign: "center" }}>
            <h3 style={{ ...stepTitleStyle, margin: 0 }}>탈출을 시작하세요.</h3>
            <p style={{ ...bodyTextStyle, fontSize: "14px" }}>
              조사관으로 등록하면 진행이 저장되고 PC에서도 이어 할 수 있습니다.
            </p>
            <div style={{ ...buttonRowStyle, justifyContent: "center" }}>
              <button type="button" style={primaryButtonStyle} onClick={() => navigate(ROUTES.signup)}>
                회원가입
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={() => navigate(ROUTES.login)}>
                로그인
              </button>
            </div>
          </div>
        )}
      </Section>
    </MobilePage>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <section style={{ ...sectionStyle, position: "relative", marginTop: 48 }}>{children}</section>;
}

const heroStyle: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  minHeight: "72dvh",
  display: "flex",
  alignItems: "flex-end",
};
const heroVideoStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  maxWidth: "none",
};
const heroShadeStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "linear-gradient(180deg, rgba(1,4,10,0.15) 0%, rgba(1,4,10,0.35) 45%, rgba(1,4,10,0.95) 100%)",
};
const heroTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.display,
  fontSize: "clamp(54px, 16vw, 88px)",
  lineHeight: 0.95,
  color: COLOR.textBright,
};
const buttonRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 };
const statsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 8,
  marginTop: 24,
};
const statValueStyle: CSSProperties = { fontFamily: FONT.display, fontSize: "40px", lineHeight: 1, color: "#4f6cb0" };
const statLabelStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "12px",
  color: COLOR.textSubtle,
  marginTop: 6,
};
const photoStyle: CSSProperties = {
  width: "100%",
  aspectRatio: "16 / 10",
  objectFit: "cover",
  borderRadius: 14,
  marginTop: 18,
};
const stepsStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "16px 0 0",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  gap: 10,
};
const stepTitleStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 700,
  fontSize: "17px",
  color: COLOR.textBright,
};
const chipStyle: CSSProperties = {
  flexShrink: 0,
  padding: "4px 10px",
  borderRadius: 999,
  border: `1px solid ${COLOR.border}`,
  fontFamily: FONT.mono,
  fontSize: "11px",
  color: COLOR.textMuted,
  whiteSpace: "nowrap",
};
const factsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 8,
  marginTop: 18,
};
const filmStyle: CSSProperties = {
  width: "100%",
  aspectRatio: "16 / 9",
  borderRadius: 14,
  marginTop: 16,
  background: COLOR.black,
};
const specsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 8,
  marginTop: 14,
};
const carouselStyle: CSSProperties = {
  display: "grid",
  gridAutoFlow: "column",
  gridAutoColumns: "82%",
  gap: 12,
  overflowX: "auto",
  scrollSnapType: "x mandatory",
  marginTop: 16,
  paddingBottom: 6,
  WebkitOverflowScrolling: "touch",
};
const scenarioCardStyle: CSSProperties = { ...cardStyle, padding: 0, overflow: "hidden", scrollSnapAlign: "start" };
const scenarioPhotoStyle: CSSProperties = { width: "100%", aspectRatio: "16 / 10", objectFit: "cover" };
const pointsStyle: CSSProperties = {
  margin: "18px 0 0",
  paddingLeft: 18,
  display: "grid",
  gap: 8,
  fontFamily: FONT.body,
  fontSize: "15px",
  lineHeight: 1.6,
  color: COLOR.textMuted,
};
