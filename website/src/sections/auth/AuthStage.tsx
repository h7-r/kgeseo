import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import DividerArc from "@/components/DividerArc";
import Stage from "@/components/Stage";
import { TERMS_HEIGHTS } from "@/data/terms";
import PageFooter from "@/layout/PageFooter";
import { DESIGN_WIDTH, FOOTER_ALLOWANCE } from "@/lib/layout";
import { useIsMobileLayout } from "@/mobile/layoutMode";
import InAppNotice from "@/mobile/InAppNotice";
import MobilePage from "@/mobile/MobilePage";
import { sectionStyle } from "@/mobile/mobileStyles";
import AuthIntro from "@/sections/auth/AuthIntro";
import TermsTabs from "@/sections/terms/TermsTabs";

import { TERMS_ANCHOR_ID, type TermsAnchor } from "./useTermsAnchor";

// 카드(593)와 소개 글(560) 폭은 디자인 그대로 두고 양쪽 여백만 같게 맞춘다.
const SIDE_MARGIN = 189;
const CARD_WIDTH = 593;
const INTRO_WIDTH = 560;
const COLUMN_GAP = DESIGN_WIDTH - SIDE_MARGIN * 2 - CARD_WIDTH - INTRO_WIDTH;
const INTRO_LEFT = SIDE_MARGIN + CARD_WIDTH + COLUMN_GAP;

// 약관 탭은 인증 카드 아래에 붙는다. 기본 자리는 1410 — 가입 카드(393 + 989)에서 28 아래다.
// 카드가 길어지면(오류 안내 · 칸 아래 안내 글) 그 28 을 지킨 채 약관 · 푸터가 같이 내려간다.
const CARD_TOP = 393;
const TERMS_TOP = 1410;
const TERMS_MIN_GAP = 28;
const TERMS_WIDTH = DESIGN_WIDTH - SIDE_MARGIN * 2;
// 푸터를 가장 긴 약관 탭에 맞춰 못 박아 탭을 바꿔도 움직이지 않게 한다.
const TERMS_RESERVED_HEIGHT = Math.max(...Object.values(TERMS_HEIGHTS)) + 80;
const FOOTER_TOP = TERMS_TOP + TERMS_RESERVED_HEIGHT;

/** 약관 탭의 자리(무대 px). 카드 높이를 재어 카드와 겹치지 않게 내린다. */
function useTermsTop() {
  const cardRef = useRef<HTMLDivElement>(null);
  const [termsTop, setTermsTop] = useState(TERMS_TOP);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    // 무대가 통째로 축소돼 있어도 offsetHeight 는 축소 전(무대 px) 값이다.
    const measure = () => setTermsTop(Math.max(TERMS_TOP, CARD_TOP + card.offsetHeight + TERMS_MIN_GAP));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  return { cardRef, termsTop };
}

interface AuthStageProps {
  terms: TermsAnchor;
  /** 왼쪽 카드 */
  children: ReactNode;
}

/** 인증 화면 공통 배치. 왼쪽에 카드, 오른쪽에 소개 글, 아래에 약관 탭. */
export default function AuthStage({ terms, children }: AuthStageProps) {
  const isMobile = useIsMobileLayout();
  const { cardRef, termsTop } = useTermsTop();
  if (isMobile) {
    return (
      <MobilePage>
        <div style={{ ...sectionStyle, paddingTop: 20 }}>
          {/* 간편 로그인이 앱 안 브라우저에서 막힐 수 있어 로그인 전에도 안내한다(코덱스 구현 06회차) */}
          <div style={{ marginBottom: 12 }}>
            <InAppNotice />
          </div>
          {/* 카드는 데스크톱 폭(593)으로 짜여 있다 — 모바일 칸 폭에 맞춘다(mobile.css .mobile-auth-card) */}
          <div className="mobile-auth-card">{children}</div>
          <div id={TERMS_ANCHOR_ID} style={{ marginTop: 32, scrollMarginTop: "72px" }}>
            <TermsTabs tab={terms.tab} top={0} onTabChange={terms.setTab} isFlow />
          </div>
        </div>
      </MobilePage>
    );
  }
  return (
    <Stage height={FOOTER_TOP + FOOTER_ALLOWANCE}>
      <div ref={cardRef} style={{ position: "absolute", left: `${SIDE_MARGIN}px`, top: `${CARD_TOP}px` }}>
        {children}
      </div>
      {/* 카드(393~1193)와 소개 글(482~1106)을 합친 범위의 가운데(793)에 호의 가운데를 맞춘다. */}
      <DividerArc centerX={(SIDE_MARGIN + CARD_WIDTH + INTRO_LEFT) / 2} top={353} height={880} />
      <div style={{ position: "absolute", left: `${INTRO_LEFT}px`, top: "482px", width: `${INTRO_WIDTH}px` }}>
        <AuthIntro />
      </div>
      <TermsTabs tab={terms.tab} top={termsTop} left={SIDE_MARGIN} width={TERMS_WIDTH} onTabChange={terms.setTab} />
      {/* scrollMarginTop — 스크롤해 왔을 때 머리띠에 약관 탭이 가리지 않게 한다. */}
      <div
        id={TERMS_ANCHOR_ID}
        style={{
          position: "absolute",
          left: 0,
          top: `${termsTop}px`,
          width: "1px",
          height: `${TERMS_RESERVED_HEIGHT}px`,
          pointerEvents: "none",
          scrollMarginTop: "140px",
        }}
      />
      <PageFooter />
    </Stage>
  );
}
