import { useState, type CSSProperties } from "react";

import mokpoPhoto from "@/assets/images/imgBg.webp";
import suncheonPhoto from "@/assets/images/imgBg1.webp";
import yeosuPhoto from "@/assets/images/imgBg2.webp";
import { VIDEOS, type Video } from "@/data/videos";
import { approachClass, useReveal, useTilt } from "@/hooks/motion";
import { useProximity } from "@/hooks/proximity";
import { useVideoPreview } from "@/hooks/useVideoPreview";
import { FONT, place } from "@/lib/style";
import { sectionAnchor } from "@/navigation/subMenus";
import { COLOR } from "@/styles/tokens";

import { PreviewBadge } from "./RegionSelect";

// 글 칸이 카드 안쪽 바닥에 붙도록 키운 높이. 아래 구간들도 그만큼 내려가 있다(homeLayout SECTION_OFFSET).
const CARD_HEIGHT = 540;

interface Scenario {
  id: string;
  /** 처음 앉는 자리. 가운데 자리만 42px 아래다. */
  slot: CSSProperties;
  photo: string;
  video: Video;
  region: string;
  name: string;
  stars: string;
  description: string;
}

/** 실제 지역의 시나리오 세 장. 글은 지역 설화 정리본의 사실만 쓴다. */
const SCENARIOS: readonly Scenario[] = [
  {
    id: "mokpo",
    slot: place(195, 5586, 500, CARD_HEIGHT),
    photo: mokpoPhoto,
    video: VIDEOS.mokpo,
    region: "목포",
    name: "갓바위의 전설",
    stars: "★★★☆☆",
    description: "성자가 쉬어 가며 두고 간 갓이 바위로 굳었다. 바닷가 갓바위에 남은 단서를 찾아라.",
  },
  {
    id: "yeosu",
    slot: place(710, 5628, 500, CARD_HEIGHT),
    photo: yeosuPhoto,
    video: VIDEOS.yeosu,
    region: "여수",
    name: "거북선의 비밀",
    stars: "★★★★☆",
    description: "전라좌수영의 바다를 지키던 거북선. 거북 머리가 가리키는 곳에 봉인된 기록을 찾아라.",
  },
  {
    id: "suncheon",
    slot: place(1225, 5586, 500, CARD_HEIGHT),
    photo: suncheonPhoto,
    video: VIDEOS.suncheon,
    region: "순천",
    name: "순천만의 비밀",
    stars: "★★★★★",
    description: "갈대숲 사이로 굽이치는 S자 물길. 물길이 멈추는 자리에 숨은 마지막 단서를 찾아라.",
  },
];

const SLOTS = SCENARIOS.map((scenario) => scenario.slot);

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
        <ScenarioCard key={scenario.id} {...scenario} slot={SLOTS[(index + rotation) % SCENARIOS.length]} />
      ))}

      <button
        type="button"
        className="card-arrow"
        style={{ ...place(115, 5808), ...arrowStyle }}
        onClick={() => rotate(1)}
        aria-label="이전 시나리오"
        {...sectionAnchor("scenarios")}
      >
        ‹
      </button>
      <button
        type="button"
        className="card-arrow"
        style={{ ...place(1750, 5808), ...arrowStyle }}
        onClick={() => rotate(-1)}
        aria-label="다음 시나리오"
      >
        ›
      </button>
    </>
  );
}

type ScenarioCardProps = Omit<Scenario, "id">;

/** 카드 한 장. 마우스를 따라 살짝 기울고, 스크롤로 떠오르고, 호버하면 영상이 흐른다. */
function ScenarioCard({ slot, photo, video, region, name, stars, description }: ScenarioCardProps) {
  const { ref: tiltRef, onMouseMove: handleTiltMove, onMouseLeave: resetTilt } = useTilt(5);
  const [revealRef, visible] = useReveal();
  const proximityRef = useProximity(240);
  // 카드 모서리(16px × 화면 배율쯤)에서 커지기 시작한다.
  const preview = useVideoPreview(video, "12px");

  return (
    <div
      ref={revealRef}
      className={`tilt-scene ${approachClass(visible)}`}
      style={{ ...slot, ...slotFrameStyle, transition: "left .6s var(--ease-smooth), top .6s var(--ease-smooth)" }}
    >
      <div
        ref={(el) => {
          tiltRef.current = el;
          proximityRef.current = el;
        }}
        {...preview.triggerProps}
        onMouseMove={handleTiltMove}
        onMouseLeave={(event) => {
          resetTilt();
          preview.triggerProps.onMouseLeave?.(event);
        }}
        className={`card tilt depth-scene proximity-inner${preview.hasVideo ? " preview-trigger" : ""}`}
        style={cardStyle}
      >
        {/* 사진을 한 겹 뒤로 물려 기울일 때 글보다 적게 움직이게 한다. 카드에 두께가 생긴다. */}
        <div className="depth-back" style={{ position: "absolute", inset: 0 }}>
          {preview.videoProps ? (
            <video {...preview.videoProps} style={mediaStyle} />
          ) : (
            <img loading="lazy" decoding="async" src={photo} alt="" style={mediaStyle} />
          )}
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} />
        </div>

        <div style={fadeStyle} />
        {preview.hasVideo && <PreviewBadge card />}

        <div className="depth-front" style={textBoxStyle}>
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
            {region && (
              <span style={regionTagStyle}>
                <span style={{ color: COLOR.textSubtle }}>지역</span>
                <span style={{ color: COLOR.textBright }}>{region}</span>
              </span>
            )}
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

// 바깥 칸은 자리만 잡는다. 기울임이 바깥에 걸리면 그림자까지 같이 돌아 어색하다.
const slotFrameStyle: CSSProperties = { boxSizing: "border-box" };

const cardStyle: CSSProperties = {
  border: `1px solid ${COLOR.border}`,
  borderRadius: "16px",
  overflow: "hidden",
  boxSizing: "border-box",
  boxShadow: "0px 0px 28px 0px rgba(46,72,137,0.2), 0px 18px 40px 0px rgba(0,0,0,0.4)",
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

const arrowStyle: CSSProperties = {
  height: "56px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  fontFamily: FONT.body,
  fontWeight: 700,
  fontSize: "36px",
  color: COLOR.accent,
  whiteSpace: "nowrap",
  boxSizing: "border-box",
};
