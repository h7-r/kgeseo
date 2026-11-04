import { useRef, type CSSProperties, type MouseEvent } from "react";

import { openVideoModal } from "@/app/siteState";
import { activePageStyle, inactivePageStyle } from "@/components/pagerStyles";
import TabBar from "@/components/TabBar";
import { ABOUT_CONTENT, ABOUT_TABS, type AboutTabId } from "@/data/about";
import type { Video } from "@/data/videos";
import { prefersReducedMotion } from "@/lib/motionPreference";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

interface AboutTabsProps {
  tab: AboutTabId;
  top: number;
  onTabChange: (id: AboutTabId) => void;
}

/**
 * 게임 소개 탭 네 개. 다른 화면은 전부 어두운데 이 구간만 흰 바탕이다(디자인 그대로).
 * 탭마다 제목·정보 줄·영상·설명 문단이 바뀐다.
 */
export default function AboutTabs({ tab, top, onTabChange }: AboutTabsProps) {
  const content = ABOUT_CONTENT[tab];
  const previousTab = ABOUT_TABS[Math.max(0, content.page - 2)].id;
  const nextTab = ABOUT_TABS[Math.min(ABOUT_TABS.length - 1, content.page)].id;

  return (
    <section className="theme-light" style={{ ...rootStyle, top: `${top}px` }}>
      <TabBar
        items={ABOUT_TABS}
        activeId={tab}
        onSelect={onTabChange}
        style={tabRowStyle}
        activeTabStyle={activeTabStyle}
        inactiveTabStyle={inactiveTabStyle}
      />

      <div style={dividerStyle} />

      {/* 네 탭을 같은 칸에 겹쳐 두고 고른 것만 보인다. 칸이 가장 긴 탭에 맞춰져 아래 쪽번호 줄이 움직이지 않는다. */}
      <div style={panelStackStyle}>
        {ABOUT_TABS.map(({ id }) => (
          <AboutPanel key={id} tabId={id} isActive={id === tab} />
        ))}
      </div>

      {/* 쪽 번호 1~4 는 탭 네 개와 짝이다. */}
      <div style={pagerStyle}>
        <button
          type="button"
          className="carousel-arrow carousel-arrow--prev"
          onClick={() => onTabChange(previousTab)}
          aria-label="이전 탭"
        >
          ‹
        </button>
        {ABOUT_TABS.map(({ id }, index) => {
          const page = index + 1;
          const isActive = page === content.page;
          return (
            <button
              key={id}
              type="button"
              className={isActive ? "pager__page is-active" : "pager__page"}
              style={isActive ? activePageStyle : inactivePageStyle}
              onClick={() => onTabChange(id)}
            >
              {page}
            </button>
          );
        })}
        <button
          type="button"
          className="carousel-arrow carousel-arrow--next"
          onClick={() => onTabChange(nextTab)}
          aria-label="다음 탭"
        >
          ›
        </button>
      </div>
    </section>
  );
}

interface AboutPanelProps {
  tabId: AboutTabId;
  isActive: boolean;
}

function AboutPanel({ tabId, isActive }: AboutPanelProps) {
  const content = ABOUT_CONTENT[tabId];
  const title = ABOUT_TABS.find((item) => item.id === tabId)?.label;

  return (
    <div style={isActive ? panelStyle : hiddenPanelStyle} aria-hidden={!isActive} inert={!isActive}>
      <div style={{ flex: "1 0 0", minWidth: 0, display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={titleStyle}>{title}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%", fontSize: "18px" }}>
          {content.rows.map(([label, value], i) => (
            <div key={i} style={{ display: "flex", gap: "12px", alignItems: "center", width: "100%" }}>
              <span style={rowLabelStyle}>{label}</span>
              <span style={rowValueStyle}>{value}</span>
            </div>
          ))}
        </div>

        <div style={dividerStyle} />

        <div style={paragraphsStyle}>
          {content.paragraphs.map((paragraph, i) => (
            <p key={i} style={{ margin: 0, lineHeight: "26px" }}>
              {paragraph}
            </p>
          ))}
        </div>
      </div>

      <AboutVideo video={content.video} caption={content.videoCaption} isActive={isActive} />
    </div>
  );
}

interface AboutVideoProps {
  video: Video;
  caption: string;
  isActive: boolean;
}

/** 고른 탭의 영상만 받아 돌린다. 숨은 탭까지 받으면 네 편을 한꺼번에 내려받는다. */
function AboutVideo({ video, caption, isActive }: AboutVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const openLarge = (event: MouseEvent<HTMLButtonElement>) => {
    const element = videoRef.current;
    openVideoModal({
      video,
      origin: event.currentTarget,
      originRadius: "16px",
      startTime: element?.currentTime ?? 0,
      onReturn: (time) => {
        if (videoRef.current) videoRef.current.currentTime = time;
      },
    });
  };

  return (
    <button
      type="button"
      className="interactive-card"
      style={videoBoxStyle}
      aria-label={`${video.title} 영상 크게 보기`}
      onClick={openLarge}
    >
      {isActive && (
        <video
          ref={videoRef}
          src={video.src}
          poster={video.poster}
          autoPlay={!prefersReducedMotion()}
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          style={videoStyle}
        />
      )}
      <span style={videoCaptionStyle}>{caption}</span>
    </button>
  );
}

const panelStackStyle: CSSProperties = { display: "grid", width: "100%" };

const panelStyle: CSSProperties = { gridArea: "1 / 1", display: "flex", gap: "40px", width: "100%" };

const hiddenPanelStyle: CSSProperties = { ...panelStyle, visibility: "hidden" };

const rootStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  width: "1920px",
  minHeight: "630px",
  background: COLOR.white,
  // 아래를 조금 더 띄워 쪽번호와 흰 면 끝 사이를 둔다.
  padding: "40px 120px 56px",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
  alignItems: "flex-start",
  overflow: "hidden",
  boxSizing: "border-box",
};

const dividerStyle: CSSProperties = { height: "1px", width: "100%", background: "#ebedf2" };

const tabRowStyle: CSSProperties = { display: "flex", gap: "20px", width: "100%" };

const tabBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "12px 18px",
  borderRadius: "999px",
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "18px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  cursor: "pointer",
  boxSizing: "border-box",
};

const activeTabStyle: CSSProperties = {
  ...tabBaseStyle,
  background: COLOR.navy,
  // 남색 위 검정 글자는 안 읽혀 흰 글자로 둔다.
  color: COLOR.white,
  filter: "drop-shadow(0px 8px 9px rgba(46,72,137,0.25))",
};

// 연회색 바탕에서도 읽히도록 글자 대비를 5.2:1 로 둔다.
const inactiveTabStyle: CSSProperties = {
  ...tabBaseStyle,
  background: COLOR.lightSurface,
  border: `1px solid ${COLOR.lightBorder}`,
  color: COLOR.lightTextMuted,
};

const titleStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontWeight: 400,
  fontSize: "40px",
  color: COLOR.lightText,
  whiteSpace: "nowrap",
};

const rowLabelStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 600,
  color: COLOR.navyDeep,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const rowValueStyle: CSSProperties = {
  flex: "1 0 0",
  minWidth: 0,
  fontFamily: FONT.mono,
  fontWeight: 400,
  lineHeight: "22px",
  color: "#3c4250",
};

const paragraphsStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 400,
  fontSize: "18px",
  letterSpacing: "0.18px",
  color: COLOR.lightTextMuted,
  width: "100%",
};

const videoBoxStyle: CSSProperties = {
  position: "relative",
  width: "640px",
  height: "360px",
  padding: 0,
  borderRadius: "16px",
  background: COLOR.navyDeep,
  border: `1px solid ${COLOR.lightBorder}`,
  overflow: "hidden",
  cursor: "pointer",
  boxSizing: "border-box",
  flexShrink: 0,
};

const videoStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover", display: "block" };

const videoCaptionStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  padding: "32px 20px 14px",
  background: "linear-gradient(transparent, rgba(5,8,18,0.82))",
  fontFamily: FONT.mono,
  fontSize: "16px",
  lineHeight: "20px",
  color: COLOR.white,
  textAlign: "left",
};

// 좌표로 박으면 내용이 짧은 탭에서 쪽번호 위가 휑해 흐름 안에서 내용 바로 뒤에 붙인다.
const pagerStyle: CSSProperties = {
  alignSelf: "center",
  marginTop: "auto",
  paddingTop: "24px",
  paddingBottom: "8px",
  display: "flex",
  gap: "12px",
  alignItems: "center",
  justifyContent: "center",
};
