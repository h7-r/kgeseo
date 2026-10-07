import { useRef, useState } from "react";

import DividerArc from "@/components/DividerArc";
import Stage from "@/components/Stage";
import { TERMS_HEIGHTS, type TermsTabId } from "@/data/terms";
import { FOOTER_ALLOWANCE } from "@/layout/layoutMetrics";
import PageFooter from "@/layout/PageFooter";
import { DESIGN_WIDTH } from "@/lib/stage";
import AuthForm from "@/sections/auth/AuthForm";
import AuthIntro from "@/sections/auth/AuthIntro";
import TermsTabs from "@/sections/terms/TermsTabs";

export type AuthMode = "login" | "signup" | "forgotPassword" | "verifyCode" | "resetPassword";

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

interface AuthPageProps {
  mode: AuthMode;
}

/** 인증 화면. 왼쪽에 카드, 오른쪽에 소개 글, 아래에 약관 탭. 소개 글이 없으면 오른쪽 절반이 비어 네 화면 모두에 둔다. */
export default function AuthPage({ mode }: AuthPageProps) {
  const [termsTab, setTermsTab] = useState<TermsTabId>("terms");
  const termsAnchorRef = useRef<HTMLDivElement>(null);

  // 페이지를 옮기지 않고 아래 약관으로 내려가 적던 가입 내용이 남는다.
  const showTerms = (tab: TermsTabId) => {
    setTermsTab(tab);
    termsAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Stage height={FOOTER_TOP + FOOTER_ALLOWANCE}>
      <div style={{ position: "absolute", left: `${SIDE_MARGIN}px`, top: "393px" }}>
        {/* 모드가 바뀌면 폼을 새로 만든다. 안 그러면 로그인에 치던 비밀번호가 회원가입 칸에 남는다. */}
        <AuthForm key={mode} mode={mode} onShowTerms={showTerms} />
      </div>
      {/* 카드(393~1193)와 소개 글(482~1106)을 합친 범위의 가운데(793)에 호의 가운데를 맞춘다. */}
      <DividerArc centerX={(SIDE_MARGIN + CARD_WIDTH + INTRO_LEFT) / 2} top={353} height={880} />
      <div style={{ position: "absolute", left: `${INTRO_LEFT}px`, top: "482px", width: `${INTRO_WIDTH}px` }}>
        <AuthIntro />
      </div>
      <TermsTabs tab={termsTab} top={TERMS_TOP} left={SIDE_MARGIN} width={TERMS_WIDTH} onTabChange={setTermsTab} />
      {/* scrollMarginTop — 스크롤해 왔을 때 머리띠에 약관 탭이 가리지 않게 한다. */}
      <div
        ref={termsAnchorRef}
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
