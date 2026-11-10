import PageHeader from "../ui/PageHeader";
import StatusScreen from "../ui/StatusScreen";

/** 결제 서버가 없다. 미리보기에도 숫자를 두지 않는다 — 요금은 웹 요금 화면(data/pricing.ts)을 따라야 해서 지어낼 수 없다. */
export default function SubscriptionsPage() {
  return (
    <>
      <PageHeader title="구독 관리" description="구독 현황 · 결제 내역 · 쿠폰을 봅니다." />
      <StatusScreen
        kind="pending"
        title="결제 연동 전"
        description="결제 서버가 연결되면 열립니다. 요금은 웹 요금 화면(BASIC · PREMIUM · ULTIMATE)과 같게 맞춥니다."
      />
    </>
  );
}
