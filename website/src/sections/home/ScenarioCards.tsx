import { useState, type CSSProperties } from "react";

import mokpoPhoto from "@/assets/images/imgBg.webp";
import suncheonPhoto from "@/assets/images/imgBg1.webp";
import yeosuPhoto from "@/assets/images/imgBg2.webp";
import ComingSoonChip from "@/components/ComingSoonChip";
import { VIDEOS, type Video } from "@/data/videos";
import { useProximity } from "@/hooks/proximity";
import { useVideoPreview } from "@/hooks/useVideoPreview";
import { FONT, place } from "@/lib/style";
import { sectionAnchor } from "@/navigation/subMenus";
import { COLOR } from "@/styles/tokens";

import { PreviewBadge } from "./RegionSelect";

// 글 칸이 카드 안쪽 바닥에 붙도록 키운 높이. 아래 구간들도 그만큼 내려가 있다(homeLayout SECTION_OFFSET).
const CARD_HEIGHT = 540;
const CARD_WIDTH = 500;

/** 세 자리(무대 px). 가운데 자리만 42px 아래다. */
const SLOT_POINTS = [
  { x: 195, y: 5586 },
  { x: 710, y: 5628 },
  { x: 1225, y: 5586 },
] as const;
const SLOTS = SLOT_POINTS.map(({ x, y }) => place(x, y, CARD_WIDTH, CARD_HEIGHT));

interface Scenario {
  id: string;
  photo: string;
  video: Video;
  region: string;
  name: string;
  stars: string;
  description: string;
  /** 아직 플레이할 수 없는 지역이면 지역 딱지 옆에 「출시 예정」을 단다. */
  isComingSoon: boolean;
}

/** 실제 지역의 시나리오 세 장. 글은 지역 설화 정리본의 사실만 쓴다. 지금 열린 곳은 나주뿐이라 셋 다 출시 예정이다. */
const SCENARIOS: readonly Scenario[] = [
  {
    id: "mokpo",
    photo: mokpoPhoto,
    video: VIDEOS.mokpo,
    region: "목포",
    name: "갓바위의 전설",
    stars: "★★★☆☆",
    description: "성자가 쉬어 가며 두고 간 갓이 바위로 굳었다. 바닷가 갓바위에 남은 단서를 찾아라.",
    isComingSoon: true,
  },
  {
    id: "yeosu",
    photo: yeosuPhoto,
    video: VIDEOS.yeosu,
    region: "여수",
    name: "거북선의 비밀",
    stars: "★★★★☆",
    description: "전라좌수영의 바다를 지키던 거북선. 거북 머리가 가리키는 곳에 봉인된 기록을 찾아라.",
    isComingSoon: true,
  },
  {
    id: "suncheon",
    photo: suncheonPhoto,
    video: VIDEOS.suncheon,
    region: "순천",
    name: "순천만의 비밀",
    stars: "★★★★★",
    description: "갈대숲 사이로 굽이치는 S자 물길. 물길이 멈추는 자리에 숨은 마지막 단서를 찾아라.",
    isComingSoon: true,
  },
];

/**
 * 시나리오 카드 세 장과 좌우 화살표. 세 장이 세 자리를 돌아가며 앉는다(i 번째 카드의 자리 = (i + 돌린 수) % 3).
 * 자리가 바뀌면 transition 으로 미끄러져 옮겨 간다.
 */
export default function ScenarioCards() {
  const [rotation, setRotation] = useState(0);
  const rotate = (step: number) => setRotation((value) => (value + step + SCENARIOS.length) % SCENARIOS.length);

  return (
    <>
      {SCENARIOS.map((scenario, index) => (
        <ScenarioCard key={scenario.id} {...scenario} order={(index + rotation) % SCENARIOS.length} />
      ))}

      <button
        type="button"
        className="carousel-arrow carousel-arrow--prev"
        style={place(105, 5814)}
        onClick={() => rotate(1)}
        aria-label="이전 시나리오"
        {...sectionAnchor("scenarios")}
      >
        ‹
      </button>
      <button
        type="button"
        className="carousel-arrow carousel-arrow--next"
        style={place(1740, 5814)}
        onClick={() => rotate(-1)}
        aria-label="다음 시나리오"
      >
        ›
      </button>
    </>
  );
}

type ScenarioCardProps = Omit<Scenario, "id"> & {
  /** 지금 앉은 자리(왼쪽부터 0·1·2). */
  order: number;
};

/** 카드 한 장. 처음부터 제자리에 서 있고, 호버하면 떠올라 흔들리며 영상이 흐른다. */
function ScenarioCard({ order, photo, video, region, name, stars, description, isComingSoon }: ScenarioCardProps) {
  const proximityRef = useProximity(240);
  // 카드 모서리(16px × 화면 배율쯤)에서 커지기 시작한다.
  const preview = useVideoPreview(video, "12px");

  const slotStyle: CSSProperties = {
    ...SLOTS[order],
    transition: "left .6s var(--ease-smooth), top .6s var(--ease-smooth)",
  };

  return (
    <div className="scenario-card" style={slotStyle}>
      <div
        ref={proximityRef}
        {...preview.triggerProps}
        className={`scenario-card__body interactive-card u-proximity-glow u-proximity-glow--inset${preview.hasVideo ? " preview-trigger" : ""}`}
        style={cardStyle}
      >
        {/* 살짝 키워 영상 앞머리의 검은 띠가 카드 모서리에 비치지 않게 한다. */}
        <div style={{ position: "absolute", inset: 0, transform: "scale(1.06)" }}>
          {preview.videoProps ? (
            <video {...preview.videoProps} style={mediaStyle} />
          ) : (
            <img loading="lazy" decoding="async" src={photo} alt="" style={mediaStyle} />
          )}
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} />
        </div>

        <div style={fadeStyle} />
        {preview.hasVideo && <PreviewBadge isOnCard />}

        <div style={textBoxStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <div
              style={{
                fontFamily: FONT.mono,
                fontSize: "18px",
                color: COLOR.accent,
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              SCENARIO
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {isComingSoon && <ComingSoonChip style={comingSoonOnCardStyle} />}
              {region && (
                <span style={regionTagStyle}>
                  <span style={{ color: COLOR.textSubtle }}>지역</span>
                  <span style={{ color: COLOR.textBright }}>{region}</span>
                </span>
              )}
            </div>
          </div>
          <div
            style={{
              fontFamily: FONT.display,
              fontWeight: 400,
              fontSize: "50px",
              color: COLOR.textBright,
              width: "100%",
            }}
          >
            {name}
          </div>
          <div style={metaStyle}>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <span style={{ color: COLOR.textSubtle }}>난이도</span>
              <span style={{ color: COLOR.textBright }}>{stars}</span>
            </div>
            <span style={{ color: COLOR.textSubtle }}>1인칭 추리</span>
          </div>
          <div
            style={{
              fontFamily: FONT.body,
              fontWeight: 400,
              fontSize: "18px",
              lineHeight: 1.5,
              color: COLOR.textSubtle,
              width: "100%",
            }}
          >
            {description}
          </div>
        </div>
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = {
  border: `1px solid ${COLOR.border}`,
  borderRadius: "16px",
  overflow: "hidden",
  boxSizing: "border-box",
  // 그림자는 호버 빛과 이어지도록 CSS(.scenario-card__body)가 맡는다.
  width: "100%",
  height: "100%",
  position: "relative",
};

const mediaStyle: CSSProperties = {
  position: "absolute",
  width: "100%",
  height: "100%",
  objectFit: "cover",
  maxWidth: "none",
};

const fadeStyle: CSSProperties = {
  position: "absolute",
  left: "-1px",
  right: "-1px",
  bottom: "-1px",
  height: "300px",
  background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(1,4,10,0.8) 55%, #01040a 100%)",
};

const textBoxStyle: CSSProperties = {
  position: "absolute",
  left: "-1px",
  right: "-1px",
  bottom: 0, // 높이는 글만큼 — 몇 줄이 돼도 카드 안에서 끝난다.
  padding: "18px 20px 22px",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  boxSizing: "border-box",
};

const regionTagStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "4px 12px",
  borderRadius: "999px",
  background: "rgba(5,11,26,0.72)",
  border: "1px solid rgba(111,134,191,0.45)",
  fontFamily: FONT.mono,
  fontSize: "16px",
  whiteSpace: "nowrap",
};

// 사진 위라 바탕을 깔아 읽히게 하고, 글 크기는 옆 지역 딱지에 맞춘다.
const comingSoonOnCardStyle: CSSProperties = { fontSize: "15px", background: "rgba(5,11,26,0.72)" };

const metaStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  fontFamily: FONT.mono,
  fontSize: "18px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};
