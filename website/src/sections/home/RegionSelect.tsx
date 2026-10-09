import { useState, type CSSProperties } from "react";

import ancientGateIcon from "@/assets/images/imgAncientGateLine.svg";
import awardIcon from "@/assets/images/imgAwardLine.svg";
import mysteryPhoto from "@/assets/images/imgBg.webp";
import naturePhoto from "@/assets/images/imgBg1.webp";
import culturePhoto from "@/assets/images/imgBg2.webp";
import eyeIcon from "@/assets/images/imgEyeIcon.svg";
import filePaperIcon from "@/assets/images/imgFilePaper2Line.svg";
import glowCenterAccent from "@/assets/images/imgGlowCenterAccent.svg";
import glowRight from "@/assets/images/imgGlowRight.svg";
import dividerLine from "@/assets/images/imgLine.svg";
import mountainIcon from "@/assets/images/imgMountainIcon.svg";
import najuPhoto from "@/assets/images/imgPortalImageNaju.webp";
import showcasePhoto from "@/assets/images/imgShowcaseCircle.webp";
import { VIDEOS, type Video } from "@/data/videos";
import { useScrollZoomOut } from "@/hooks/motion";
import { useProximity } from "@/hooks/proximity";
import { useVideoPreview } from "@/hooks/useVideoPreview";
import { fillImageStyle, FONT, glowImageStyle, gradientText, place } from "@/lib/style";
import { ROUTES, useSiteNavigate } from "@/navigation/routes";
import { sectionAnchor } from "@/navigation/subMenus";
import { COLOR, GRADIENT, SHADOW, badgePillStyle } from "@/styles/tokens";

interface Branch {
  label: string;
  icon: string;
  iconSize: number;
  photo: string;
  /** 있으면 원 안이 영상이 된다. 호버하면 흐르고, 누르면 크게 열린다. */
  video?: Video;
  title: string;
  description: string;
}

/** 갈래 다섯 — 각각 실제 지역 하나를 가리킨다. 누르면 오른쪽 원이 그 지역으로 바뀐다. */
const BRANCHES: readonly Branch[] = [
  {
    label: "역사 탐험",
    icon: ancientGateIcon,
    iconSize: 30,
    photo: showcasePhoto,
    video: VIDEOS.gyeongju,
    title: "경주 (Gyeongju) · 신라의 비밀",
    description: "천년의 역사가 숨겨진 고분 아래, 잃어버린 전설의 열쇠가 깨어납니다.",
  },
  {
    label: "전설 추적",
    icon: filePaperIcon,
    iconSize: 30,
    photo: najuPhoto,
    title: "나주 (Naju) · 앙암바위의 전설",
    description: "강가에 선 바위에 얽힌 오래된 이야기, 그 진짜 결말을 찾아내세요.",
  },
  {
    label: "문화 유산",
    icon: awardIcon,
    iconSize: 30,
    photo: culturePhoto,
    video: VIDEOS.yeosu,
    title: "여수 (Yeosu) · 거북선의 비밀",
    description: "이순신의 전라좌수영이 있던 바다, 거북선이 남긴 단서를 따라 봉인을 푸세요.",
  },
  {
    label: "자연 모험",
    icon: mountainIcon,
    iconSize: 28,
    photo: naturePhoto,
    video: VIDEOS.suncheon,
    title: "순천 (Suncheon) · 순천만의 비밀",
    description: "갈대숲 사이로 굽이치는 S자 물길, 그 끝에 숨은 단서를 따라가세요.",
  },
  {
    label: "미스터리",
    icon: eyeIcon,
    iconSize: 28,
    photo: mysteryPhoto,
    video: VIDEOS.mokpo,
    title: "목포 (Mokpo) · 갓바위의 전설",
    description: "성자가 두고 간 갓이 바위로 굳었다는 바닷가, 그 전설 속 단서를 따라가세요.",
  },
];

/** 지역 선택 구간 — 큰 제목, 왼쪽 글과 갈래, 오른쪽 둥근 사진. */
export default function RegionSelect() {
  const navigate = useSiteNavigate();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollZoomRef = useScrollZoomOut();
  const branch = BRANCHES[selectedIndex];
  // 모달이 이 둥근 모양에서 시작해 네모로 커진다.
  const preview = useVideoPreview(branch.video, "50%");

  return (
    <>
      <div className="u-shine-text" style={headlineStyle} {...sectionAnchor("legend-regions")}>
        전설 속으로, 탈출을 시작하라
      </div>

      <div style={{ ...place(932, 4371, 731, 700), pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: "-34.29%", bottom: "-34.29%", left: "-32.83%", right: "-32.83%" }}>
          <img loading="lazy" decoding="async" src={glowRight} alt="" style={glowImageStyle} />
        </div>
      </div>
      <div style={{ ...place(1420, 4410, 366, 400), pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: "-37.5%", bottom: "-37.5%", left: "-40.98%", right: "-40.98%" }}>
          <img loading="lazy" decoding="async" src={glowCenterAccent} alt="" style={glowImageStyle} />
        </div>
      </div>

      <div
        ref={scrollZoomRef}
        className="u-scroll-zoom-out"
        style={{ ...place(985, 4406, 713), display: "flex", flexDirection: "column", alignItems: "center" }}
      >
        <div
          style={photoCircleStyle}
          className={preview.hasVideo ? "preview-trigger" : undefined}
          {...preview.triggerProps}
        >
          {/* key 를 바꿔야 CSS 애니메이션이 다시 돈다. */}
          {preview.videoProps ? (
            <video key={selectedIndex} className="u-swap-in" {...preview.videoProps} style={circleFillStyle} />
          ) : (
            <img
              loading="lazy"
              decoding="async"
              key={selectedIndex}
              className="u-swap-in"
              src={branch.photo}
              alt=""
              style={circleFillStyle}
            />
          )}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "inherit",
              boxShadow: `inset 0px 0px 24px 0px ${COLOR.bg}`,
            }}
          />
          <div className="u-rotating-border" aria-hidden="true" />
          {preview.hasVideo && <PreviewBadge />}
        </div>
        <div key={`caption${selectedIndex}`} className="region-select__caption" style={captionStyle}>
          <div style={photoTitleStyle}>{branch.title}</div>
          <div style={photoDescriptionStyle}>{branch.description}</div>
        </div>
      </div>

      <div style={{ ...place(221, 4495, 657, 523), display: "flex", flexDirection: "column", gap: "48px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={eyebrowStyle}>
            <span
              style={{
                fontFamily: FONT.mono,
                fontSize: "18px",
                color: COLOR.accent,
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              당신의 모험이 시작되는 곳
            </span>
          </div>
          <div style={bigTitleStyle}>지역을 선택하세요</div>
          <div
            style={{
              fontFamily: FONT.body,
              fontWeight: 400,
              fontSize: "26px",
              lineHeight: "32px",
              color: COLOR.textMuted,
            }}
          >
            각 지역의 역사와 전설이 담긴 방탈출 미션이 당신을 기다립니다
          </div>
        </div>

        <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
          <button type="button" className="button" style={outlineButtonStyle} onClick={() => navigate(ROUTES.media)}>
            <span className="button__label">모든 지역 보기</span>
          </button>
          <button type="button" className="button" style={filledButtonStyle} onClick={() => navigate(ROUTES.media)}>
            <span className="button__label">지금 탐험하기</span>
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* 높이 0 칸 위에 선 그림이 걸쳐 있다. */}
          <div style={{ position: "relative", height: 0, width: "100%" }}>
            <div style={{ position: "absolute", top: "-1px", left: 0, right: 0 }}>
              <img loading="lazy" decoding="async" src={dividerLine} alt="" style={fillImageStyle} />
            </div>
          </div>
          <div style={{ display: "flex", gap: "24px", alignItems: "flex-start" }}>
            {BRANCHES.map((item, index) => (
              <BranchDot
                key={item.label}
                label={item.label}
                icon={item.icon}
                iconSize={item.iconSize}
                selected={index === selectedIndex}
                onSelect={() => setSelectedIndex(index)}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

interface BranchDotProps {
  label: string;
  icon: string;
  iconSize: number;
  selected: boolean;
  onSelect: () => void;
}

/** 갈래 동그라미 하나. 커서가 가까워지면 밝아진다(고리는 ::after 가 그린다). */
function BranchDot({ label, icon, iconSize, selected, onSelect }: BranchDotProps) {
  const proximityRef = useProximity(170);

  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} style={branchItemStyle}>
      <div
        ref={proximityRef}
        className="branch-dot u-proximity-glow"
        style={{
          ...dotStyle,
          border: `2px solid ${selected ? COLOR.navy : "rgba(26,48,95,0.38)"}`,
          ...(selected ? { boxShadow: "0px 0px 16px 0px rgba(46,72,137,0.38)" } : {}),
        }}
      >
        <img
          loading="lazy"
          decoding="async"
          src={icon}
          alt=""
          style={{ width: `${iconSize}px`, height: `${iconSize}px`, display: "block" }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "inherit",
            boxShadow: `inset 0px 0px 10px 0px ${selected ? "rgba(46,72,137,0.2)" : "rgba(255,255,255,0.07)"}`,
          }}
        />
      </div>
      <div
        style={{
          fontFamily: FONT.body,
          fontWeight: selected ? 700 : 500,
          fontSize: "18px",
          color: selected ? "#efefef" : COLOR.textMuted,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </button>
  );
}

interface PreviewBadgeProps {
  /** 시나리오 카드용 자리(가운데보다 조금 위). */
  isOnCard?: boolean;
}

/** 호버하면 떠오르는 「▶ 영상 크게 보기」 딱지. 누를 수 있는 곳이라는 표시다. */
export function PreviewBadge({ isOnCard = false }: PreviewBadgeProps) {
  return (
    <span
      className={`preview-badge${isOnCard ? " preview-badge--card" : ""}`}
      style={{ fontFamily: FONT.mono }}
      aria-hidden="true"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 4.8v14.4L19 12z" fill="currentColor" />
      </svg>
      영상 크게 보기
    </span>
  );
}

const circleFillStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  borderRadius: "240px",
  maxWidth: "none",
};

const headlineStyle: CSSProperties = {
  position: "absolute",
  left: "919px",
  top: "4156px",
  transform: "translate(-50%, -50%)",
  fontFamily: FONT.display,
  fontWeight: 400,
  fontSize: "112px",
  letterSpacing: "4px",
  textAlign: "center",
  whiteSpace: "nowrap",
  ...gradientText("linear-gradient(90deg, #2e509b 0%, #2e4889 50%, #37569e 100%)"),
};

const photoCircleStyle: CSSProperties = {
  position: "relative",
  width: "480px",
  height: "500px",
  borderRadius: "240px",
  // 파란 테두리는 도는 고리(.u-rotating-border)가 맡고, 여기는 아주 어두운 남색 한 줄만.
  border: "1px solid rgba(22,38,77,0.6)",
  boxShadow: "0px 0px 40px 0px rgba(14,26,58,0.45)",
  boxSizing: "border-box",
};

const captionStyle: CSSProperties = {
  paddingTop: "32px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  alignItems: "center",
  textAlign: "center",
  width: "564px",
};

const photoTitleStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "40px",
  color: "#eeffee",
  width: "100%",
  // 모노 40px 은 띄어쓰기 한 칸이 24px 이라 564px 를 넘긴다. 글자 크기 대신 단어 사이만 좁혀 한 줄에 담는다.
  wordSpacing: "-14px",
  whiteSpace: "nowrap",
};

const photoDescriptionStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 400,
  fontSize: "20px",
  lineHeight: "24px",
  color: COLOR.accent,
  width: "100%",
};

const eyebrowStyle: CSSProperties = { ...badgePillStyle, alignSelf: "flex-start", gap: "8px", padding: "6px 16px" };

const bigTitleStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 900,
  fontSize: "84px",
  lineHeight: "72px",
  ...gradientText(GRADIENT.titleFade),
  // 줄 높이가 글자보다 작아 그라디언트 칸 밖 윗부분이 잘린다. 칸만 넓히고 margin 으로 되돌린다.
  padding: "0.15em 0",
  margin: "-0.15em 0",
};

const buttonBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "18px 44px",
  borderRadius: "100px",
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "18px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  boxSizing: "border-box",
  cursor: "pointer",
};

const outlineButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  color: COLOR.accent,
  background: COLOR.glass,
  backdropFilter: "blur(7px)",
  WebkitBackdropFilter: "blur(7px)",
  border: "0.5px solid #eeffee",
};

const filledButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  color: COLOR.white,
  backgroundImage: GRADIENT.pillButton("143.454deg"),
  boxShadow: SHADOW.pillGlow,
};

const branchItemStyle: CSSProperties = {
  flex: "1 0 0",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  alignItems: "center",
  cursor: "pointer",
  // 단추는 브라우저가 word-spacing 을 normal 로 되돌린다. 감싸던 div 처럼 부모 값을 따르게 한다.
  wordSpacing: "inherit",
};

const dotStyle: CSSProperties = {
  position: "relative",
  width: "64px",
  height: "64px",
  borderRadius: "32px",
  background: COLOR.surface,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  boxSizing: "border-box",
};
