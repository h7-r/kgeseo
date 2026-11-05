import type { ReactNode } from "react";

import DividerArc from "@/components/DividerArc";
import Stage from "@/components/Stage";
import { TERMS_HEIGHTS } from "@/data/terms";
import PageFooter from "@/layout/PageFooter";
import { DESIGN_WIDTH, FOOTER_ALLOWANCE } from "@/lib/layout";
import AuthIntro from "@/sections/auth/AuthIntro";
import TermsTabs from "@/sections/terms/TermsTabs";

import { TERMS_ANCHOR_ID, type TermsAnchor } from "./useTermsAnchor";

// 카드(593)와 소개 글(560) 폭은 디자인 그대로 두고 양쪽 여백만 같게 맞춘다.
const SIDE_MARGIN = 189;
const CARD_WIDTH = 593;
const INTRO_WIDTH = 560;
const COLUMN_GAP = DESIGN_WIDTH - SIDE_MARGIN * 2 - CARD_WIDTH - INTRO_WIDTH;
const INTRO_LEFT = SIDE_MARGIN + CARD_WIDTH + COLUMN_GAP;

// 약관 탭은 인증 카드 아래에 같은 여백으로 붙는다.
const TERMS_TOP = 1410;
const TERMS_WIDTH = DESIGN_WIDTH - SIDE_MARGIN * 2;
// 푸터를 가장 긴 약관 탭에 맞춰 못 박아 탭을 바꿔도 움직이지 않게 한다.
const TERMS_RESERVED_HEIGHT = Math.max(...Object.values(TERMS_HEIGHTS)) + 80;
const FOOTER_TOP = TERMS_TOP + TERMS_RESERVED_HEIGHT;

interface AuthStageProps {
  terms: TermsAnchor;
  /** 왼쪽 카드 */
  children: ReactNode;
}

/** 인증 화면 공통 배치. 왼쪽에 카드, 오른쪽에 소개 글, 아래에 약관 탭. */
export default function AuthStage({ terms, children }: AuthStageProps) {
  return (
    <Stage height={FOOTER_TOP + FOOTER_ALLOWANCE}>
      <div style={{ position: "absolute", left: `${SIDE_MARGIN}px`, top: "393px" }}>{children}</div>
      {/* 카드(393~1193)와 소개 글(482~1106)을 합친 범위의 가운데(793)에 호의 가운데를 맞춘다. */}
      <DividerArc centerX={(SIDE_MARGIN + CARD_WIDTH + INTRO_LEFT) / 2} top={353} height={880} />
      <div style={{ position: "absolute", left: `${INTRO_LEFT}px`, top: "482px", width: `${INTRO_WIDTH}px` }}>
        <AuthIntro />
      </div>
      <TermsTabs tab={terms.tab} top={TERMS_TOP} left={SIDE_MARGIN} width={TERMS_WIDTH} onTabChange={terms.setTab} />
      {/* scrollMarginTop — 스크롤해 왔을 때 머리띠에 약관 탭이 가리지 않게 한다. */}
      <div
        id={TERMS_ANCHOR_ID}
        style={{
          position: "absolute",
          left: 0,
          top: `${TERMS_TOP}px`,
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
