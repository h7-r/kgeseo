import Stage from "@/components/Stage";
import { ABOUT_TABS } from "@/data/about";
import { useQueryTab } from "@/hooks/useQueryTab";
import { HEADER_HEIGHT, FOOTER_ALLOWANCE } from "@/layout/layoutMetrics";
import PageFooter from "@/layout/PageFooter";
import AboutTabs from "@/sections/about/AboutTabs";

// 흰 면이 머리띠에 붙으면 머리띠가 흰 면의 일부처럼 보여 어두운 바탕을 넉넉히 띄운다.
const HEADER_GAP = 104;
// 첫 측정 전에 쓰는 어림값. 실제 높이는 Stage 가 잰다.
const SECTION_HEIGHT = 650;

export default function AboutPage() {
  // 탭을 주소에 둬야 머리띠 아래 하위 메뉴도 탭을 바꿀 수 있다.
  const [tab, setTab] = useQueryTab(ABOUT_TABS, "overview");

  return (
    <Stage height={HEADER_HEIGHT + HEADER_GAP + SECTION_HEIGHT + FOOTER_ALLOWANCE}>
      <AboutTabs tab={tab} top={HEADER_HEIGHT + HEADER_GAP} onTabChange={setTab} />
      <PageFooter />
    </Stage>
  );
}
