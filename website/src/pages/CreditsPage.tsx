import { useIsMobileLayout } from "@/mobile/layoutMode";
import { MobileCreditsPage } from "@/mobile/MobilePages";
import Stage from "@/components/Stage";
import PageFooter from "@/layout/PageFooter";
import { HEADER_HEIGHT, FOOTER_ALLOWANCE } from "@/lib/layout";
import CreditsCard from "@/sections/credits/CreditsCard";

const CARD_TOP = HEADER_HEIGHT + 64;
/** 첫 측정 전 높이 — Stage 가 카드 끝을 재서 바로잡는다 */
const FIRST_GUESS_HEIGHT = 4200;

function DesktopCreditsPage() {
  return (
    <Stage height={CARD_TOP + FIRST_GUESS_HEIGHT + FOOTER_ALLOWANCE}>
      <CreditsCard top={CARD_TOP} />
      <PageFooter />
    </Stage>
  );
}

/** 크레딧 및 오픈소스 고지 — 약관 「저작권 및 라이선스」가 이 주소(/credits)를 가리킨다 */
export default function CreditsPage() {
  return useIsMobileLayout() ? <MobileCreditsPage /> : <DesktopCreditsPage />;
}
