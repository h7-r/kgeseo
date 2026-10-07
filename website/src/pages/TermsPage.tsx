import Stage from "@/components/Stage";
import { TERMS_HEIGHTS, TERMS_TABS } from "@/data/terms";
import { useQueryTab } from "@/hooks/useQueryTab";
import { HEADER_HEIGHT, FOOTER_ALLOWANCE } from "@/layout/layoutMetrics";
import PageFooter from "@/layout/PageFooter";
import TermsTabs from "@/sections/terms/TermsTabs";

const TOP_MARGIN = 64;
const BOTTOM_MARGIN = 64;
const CARD_TOP = HEADER_HEIGHT + TOP_MARGIN;
const LONGEST_TERMS = Math.max(...Object.values(TERMS_HEIGHTS));

export default function TermsPage() {
  // 푸터의 「개인정보처리방침」처럼 특정 탭을 바로 여는 링크가 있어 탭을 주소에 둔다.
  const [tab, setTab] = useQueryTab(TERMS_TABS, "terms");

  return (
    <Stage height={CARD_TOP + LONGEST_TERMS + BOTTOM_MARGIN + FOOTER_ALLOWANCE}>
      <TermsTabs tab={tab} top={CARD_TOP} onTabChange={setTab} />
      {/* 탭마다 카드 길이가 달라 푸터가 뛰지 않도록 가장 긴 탭만큼 자리를 잡아 둔다. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: `${CARD_TOP}px`,
          width: "1px",
          height: `${LONGEST_TERMS + BOTTOM_MARGIN}px`,
          pointerEvents: "none",
        }}
      />
      <PageFooter />
    </Stage>
  );
}
