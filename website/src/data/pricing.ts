import creditCardIcon from "@/assets/images/imgCreditCard.svg";
import repeatIcon from "@/assets/images/imgRepeat.svg";
import rotateCcwIcon from "@/assets/images/imgRotateCcw.svg";

export type PlanName = "BASIC" | "PREMIUM" | "ULTIMATE";

export interface PricingPlan {
  name: PlanName;
  price: string;
  summary: string;
  features: readonly string[];
  extras: readonly string[];
}

export interface PaymentBoxContent {
  icon: string;
  title: string;
  summary: string;
  lines: readonly string[];
}

interface BenefitPoint {
  text: string;
  note: string;
}

interface Pricing {
  plans: readonly PricingPlan[];
  paymentBoxes: readonly PaymentBoxContent[];
  benefitsTitle: string;
  /** 혜택 목록이 두 번 읽히지 않도록 위쪽은 한 문단으로 요약한다. */
  benefitsIntro: string;
  /** 목록이 「무엇을 주는가」라면 이 줄은 「그래서 어떤 일이 생기는가」를 말한다. */
  rotatingBenefits: readonly string[];
  benefitPoints: readonly BenefitPoint[];
}

/** 구독 요금제. 플랜 3장 · 결제 정보 3상자 · 혜택 안내. */
export const PRICING: Pricing = {
  plans: [
    {
      name: "BASIC",
      price: "Free",
      summary: "기본 혜택 + 월간 보상",
      features: [
        "• 월간 아이템 보상 (기본 아이템 1종)",
        "• 게임 내 스킨 1개 (기본 스킨)",
        "• 고객센터 우선 응대",
        "• 시즌 드롭 참여 (일반 우선순위)",
        "• 게임 내 알림/공지 우선 노출",
      ],
      extras: ["무료 체험 14일 제공", "매월 1회 보너스 아이템 지급"],
    },
    {
      name: "PREMIUM",
      price: "₩14,900",
      summary: "프리미엄 전용 혜택",
      features: [
        "• 모든 시나리오 무제한 플레이",
        "• 프리미엄 전용 스킨 5종",
        "• 멀티플레이 우선 매칭",
        "• 시즌 드롭 참여 (우선순위 상향)",
        "• 전용 서버 우선 접속",
      ],
      extras: ["전용 서버 우선 접속", "시즌 한정 콘텐츠 선행 체험", "프리미엄 전용 이모트 제공"],
    },
    {
      name: "ULTIMATE",
      price: "₩29,900",
      summary: "얼티밋 올인원 패키지",
      features: [
        "• 모든 프리미엄 혜택 포함",
        "• 한정판 레전드 스킨 제공",
        "• 신규 시나리오 얼리 액세스",
        "• 전용 1:1 고객 지원",
        "• 모든 DLC 무료 포함",
      ],
      extras: ["모든 DLC 무료 포함", "전용 1:1 고객 지원", "얼리 액세스 & 베타 참여권"],
    },
  ],
  paymentBoxes: [
    {
      icon: creditCardIcon,
      title: "결제 수단",
      summary: "카드 / 계좌이체 / 간편결제",
      lines: [
        "• 카드, 계좌이체, 간편결제 등록 가능",
        "• 결제 수단 변경은 언제든 가능",
        "• 결제 실패 시 자동 재시도 (최대 2회)",
        "• 결제 내역은 마이페이지에서 확인",
      ],
    },
    {
      icon: repeatIcon,
      title: "자동 결제",
      summary: "결제일 자동 청구 (해지 가능)",
      lines: [
        "• 매월 결제일 자동 청구",
        "• 해지 전까지 자동 결제 유지",
        "• 결제 실패 시 알림 발송",
        "• 해지 후에도 남은 기간은 그대로 이용 가능",
      ],
    },
    {
      icon: rotateCcwIcon,
      title: "환불 정책",
      summary: "해지 후 잔여 기간 기준 환불",
      lines: [
        "• 해지 후 남은 기간에 따라 환불",
        "• 환불은 결제 수단으로 처리",
        "• 환불 처리는 영업일 기준 3~5일 소요",
        "• 환불 후에도 이미 지급된 혜택은 소멸",
      ],
    },
  ],
  benefitsTitle: "시즌 드롭 & VIP 혜택",
  benefitsIntro:
    "프리미엄과 얼티밋 구독자는 시즌이 열리는 순간 가장 먼저 들어갑니다. 한정 스킨과 월간 보상이 매달 쌓이고, 막히는 순간엔 1:1 상담이 먼저 연결됩니다.",
  rotatingBenefits: [
    "시즌이 열리는 순간, 줄 서지 않고 바로 들어갑니다.",
    "이달의 한정 스킨은 구독자에게만 남습니다.",
    "월간 보상이 두 배로 쌓입니다. 미루면 사라지지 않습니다.",
    "막히는 순간 1:1 상담이 먼저 연결됩니다.",
    "다음 지역이 열리면 가장 먼저 알려 드립니다.",
  ],
  benefitPoints: [
    { text: "시즌 드롭 우선 참여", note: "프리미엄 · 얼티밋" },
    { text: "독점 스킨 제공", note: "VIP 전용 스킨 / 효과" },
    { text: "월간 보상 증정", note: "아이템 2배 · 3배" },
    { text: "고객센터 우선 응대", note: "1:1 상담 지원" },
  ],
};
