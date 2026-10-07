import Stage from "@/components/Stage";
import { HEADER_HEIGHT, FOOTER_ALLOWANCE } from "@/layout/layoutMetrics";
import PageFooter from "@/layout/PageFooter";
import PricingPlans from "@/sections/pricing/PricingPlans";

const TOP_GAP = 60;
const CONTENT_HEIGHT = 2322;

export default function PricingPage() {
  return (
    <Stage height={HEADER_HEIGHT + CONTENT_HEIGHT + TOP_GAP + FOOTER_ALLOWANCE}>
      <PricingPlans top={HEADER_HEIGHT + TOP_GAP} />
      <PageFooter />
    </Stage>
  );
}
