import Stage from "@/components/Stage";
import { TERMS_HEIGHTS, TERMS_TABS } from "@/data/terms";
import { useQueryTab } from "@/hooks/useQueryTab";
import PageFooter from "@/layout/PageFooter";
import { HEADER_HEIGHT, FOOTER_ALLOWANCE } from "@/lib/layout";
import TermsTabs from "@/sections/terms/TermsTabs";

const TOP_MARGIN = 64;
const CARD_TOP = HEADER_HEIGHT + TOP_MARGIN;

export default function TermsPage() {
  // 푸터의 「개인정보처리방침」처럼 특정 탭을 바로 여는 링크가 있어 탭을 주소에 둔다.
  const [tab, setTab] = useQueryTab(TERMS_TABS, "terms");

  // 푸터는 카드 끝을 따라간다. 탭을 바꾸면 Stage 가 카드를 다시 재어 푸터를 옮긴다.
  // 카드 끝~푸터 간격은 소개 페이지와 같은 Stage 기본값(72)을 쓴다.
  return (
    <Stage height={CARD_TOP + TERMS_HEIGHTS[tab] + FOOTER_ALLOWANCE}>
      <TermsTabs tab={tab} top={CARD_TOP} onTabChange={setTab} />
      <PageFooter />
    </Stage>
  );
}
