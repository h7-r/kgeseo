import type { CSSProperties } from "react";

import TabBar from "@/components/TabBar";
import { SUPPORT_TABS, type SupportTabId } from "@/data/support";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

import FaqPanel from "./FaqPanel";
import InquiryPanel from "./InquiryPanel";
import NoticesPanel from "./NoticesPanel";
import { ACTIVE_TAB_BACKGROUND } from "./styles";
import { SUPPORT_CONTENT_OFFSET, SUPPORT_CONTENT_PADDING } from "./supportLayout";

interface SupportCenterProps {
  tab: SupportTabId;
  top: number;
  /** 내용 칸 최소 높이 */
  panelHeight: number;
  /** 헤더 아래부터 푸터 전까지 까는 흰 면의 높이 */
  lightBgHeight: number;
  onTabChange: (tab: SupportTabId) => void;
}

/** 고객센터. 탭 셋이 같은 껍데기를 쓰고 내용만 바뀐다. */
export default function SupportCenter({ tab, top, panelHeight, lightBgHeight, onTabChange }: SupportCenterProps) {
  return (
    <>
      {/* 머리·탭·내용이 한 장의 흰 종이 위에 놓인다. 헤더·푸터만 어둡다. */}
      <div
        className="light-surface"
        style={{
          position: "absolute",
          left: 0,
          top: `${top}px`,
          width: "1920px",
          height: `${lightBgHeight}px`,
          background: COLOR.white,
        }}
        aria-hidden="true"
      />
      <div style={{ ...headerStyle, top: `${top}px` }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
          <div
            style={{
              fontFamily: FONT.display,
              fontSize: "76px",
              lineHeight: "72px",
              color: COLOR.lightText,
              whiteSpace: "nowrap",
            }}
          >
            고객센터
          </div>
          <div
            style={{
              fontFamily: FONT.mono,
              fontWeight: 400,
              fontSize: "18px",
              lineHeight: "28px",
              color: COLOR.lightTextMuted,
              width: "100%",
            }}
          >
            공지사항, 자주 묻는 질문, 그리고 합동수사본부 1:1 문의 채널을 통해 해결되지 않은 미션을 제보하세요.
          </div>
        </div>
      </div>

      <div className="light-surface" style={{ ...tabBarStyle, top: `${top + 230}px` }}>
        <TabBar
          items={SUPPORT_TABS}
          activeId={tab}
          onSelect={onTabChange}
          style={tabRowStyle}
          activeTabStyle={activeTabStyle}
          inactiveTabStyle={inactiveTabStyle}
        />
        <div style={{ height: "1px", width: "100%", background: COLOR.lightDivider }} />
      </div>

      <div
        className="light-surface"
        style={{ ...contentStyle, top: `${top + SUPPORT_CONTENT_OFFSET}px`, minHeight: `${panelHeight}px` }}
      >
        {tab === "notices" && <NoticesPanel />}
        {tab === "faq" && <FaqPanel />}
        {tab === "inquiry" && <InquiryPanel />}
      </div>
    </>
  );
}

const headerStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  width: "1920px",
  padding: "80px 120px 40px",
  boxSizing: "border-box",
};

const tabBarStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  width: "1920px",
  padding: "20px 120px 10px",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
  boxSizing: "border-box",
};

const contentStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  width: "1920px",
  padding: `${SUPPORT_CONTENT_PADDING.top}px 120px ${SUPPORT_CONTENT_PADDING.bottom}px`,
  display: "flex",
  flexDirection: "column",
  gap: "32px",
  background: COLOR.white,
  boxSizing: "border-box",
};

const tabRowStyle: CSSProperties = { display: "flex", gap: "20px" };

const tabBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "12px 24px",
  borderRadius: "999px",
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  whiteSpace: "nowrap",
  cursor: "pointer",
  boxSizing: "border-box",
};
const activeTabStyle: CSSProperties = {
  ...tabBaseStyle,
  backgroundImage: ACTIVE_TAB_BACKGROUND,
  color: COLOR.white,
  filter: "drop-shadow(0px 8px 24px rgba(46,72,137,0.2)) drop-shadow(0px 4px 12px rgba(46,72,137,0.35))",
};
const inactiveTabStyle: CSSProperties = {
  ...tabBaseStyle,
  background: COLOR.lightSurface,
  border: `1px solid ${COLOR.lightBorder}`,
  color: COLOR.lightTextMuted,
};
