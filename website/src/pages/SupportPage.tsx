import Stage from "@/components/Stage";
import { SUPPORT_TABS, type SupportTabId } from "@/data/support";
import { useQueryTab } from "@/hooks/useQueryTab";
import { HEADER_HEIGHT, FOOTER_ALLOWANCE } from "@/layout/layoutMetrics";
import PageFooter from "@/layout/PageFooter";
import SupportCenter from "@/sections/support/SupportCenter";
import { SUPPORT_CONTENT_OFFSET, SUPPORT_CONTENT_PADDING } from "@/sections/support/supportLayout";

/** 흰 면이 내용 칸 아래로 더 내려가는 길이 */
const LIGHT_BG_BOTTOM = 60;

/** 탭마다 내용 높이가 달라 푸터 자리도 함께 움직인다. */
const CONTENT_HEIGHTS: Record<SupportTabId, number> = {
  notices: 1100,
  faq: 979,
  inquiry: 1059,
};

/** 고객센터 페이지. nav + 머리(230) + 탭(100) + 내용 + 푸터 */
export default function SupportPage() {
  // 탭을 주소에 두어 머리띠 아래 하위 메뉴도 탭을 바꿀 수 있다.
  const [tab, setTab] = useQueryTab(SUPPORT_TABS, "notices");
  const panelHeight = CONTENT_HEIGHTS[tab] + SUPPORT_CONTENT_PADDING.top + SUPPORT_CONTENT_PADDING.bottom;
  const lightBgHeight = SUPPORT_CONTENT_OFFSET + panelHeight + LIGHT_BG_BOTTOM;
  const footerTop = HEADER_HEIGHT + lightBgHeight;

  return (
    // 틈을 두면 흰 면과 푸터 사이로 어두운 띠가 보인다.
    <Stage height={footerTop + FOOTER_ALLOWANCE} bottomGap={0}>
      <SupportCenter
        tab={tab}
        top={HEADER_HEIGHT}
        panelHeight={panelHeight}
        lightBgHeight={lightBgHeight}
        onTabChange={setTab}
      />
      <PageFooter />
    </Stage>
  );
}
