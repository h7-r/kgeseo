import Stage from "@/components/Stage";
import { MY_PAGE_TABS } from "@/data/myPage";
import { useQueryTab } from "@/hooks/useQueryTab";
import { HEADER_HEIGHT, FOOTER_ALLOWANCE } from "@/layout/layoutMetrics";
import PageFooter from "@/layout/PageFooter";
import MyPagePanel from "@/sections/myPage/MyPagePanel";

const PANEL_GAP = 60;
const PANEL_HEIGHT = 1300;
/** 맨 위 「내 정보」 카드 자리 */
const PROFILE_CARD_HEIGHT = 170;

/** 마이페이지. nav + 본문 + 푸터 */
export default function MyPage() {
  // 탭을 주소에 두어 머리띠 아래 하위 메뉴도 탭을 바꿀 수 있다.
  const [tab, setTab] = useQueryTab(MY_PAGE_TABS, "history");
  const footerTop = HEADER_HEIGHT + PANEL_GAP + PANEL_HEIGHT + PANEL_GAP + PROFILE_CARD_HEIGHT;

  return (
    <Stage height={footerTop + FOOTER_ALLOWANCE}>
      <MyPagePanel tab={tab} top={HEADER_HEIGHT + PANEL_GAP} onTabChange={setTab} />
      <PageFooter />
    </Stage>
  );
}
