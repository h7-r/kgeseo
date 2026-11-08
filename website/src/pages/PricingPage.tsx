import { useIsMobileLayout } from "@/mobile/layoutMode";
import { MobilePricingPage } from "@/mobile/MobilePages";
import Stage from "@/components/Stage";
import PageFooter from "@/layout/PageFooter";
import { HEADER_HEIGHT, FOOTER_ALLOWANCE } from "@/lib/layout";
import PricingPlans from "@/sections/pricing/PricingPlans";

const TOP_GAP = 60;
const CONTENT_HEIGHT = 2322;

function DesktopPricingPage() {
  return (
    <Stage height={HEADER_HEIGHT + CONTENT_HEIGHT + TOP_GAP + FOOTER_ALLOWANCE}>
      <PricingPlans top={HEADER_HEIGHT + TOP_GAP} />
      <PageFooter />
    </Stage>
  );
}

/** 모바일은 따로 그린다 — 데스크톱판의 무대 배율 훅이 모바일에서 돌지 않게 진입에서만 가른다(src/mobile/MobilePages) */
export default function PricingPage() {
  return useIsMobileLayout() ? <MobilePricingPage /> : <DesktopPricingPage />;
}
