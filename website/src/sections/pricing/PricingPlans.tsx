import { useState, type CSSProperties, type MouseEvent } from "react";

import HeartbeatLine from "@/components/HeartbeatLine";
import Modal from "@/components/Modal";
import { modalPrimaryStyle, modalSecondaryStyle } from "@/components/modalButtonStyles";
import { PRICING, type PlanName, type PricingPlan } from "@/data/pricing";
import { FONT } from "@/lib/style";
import { QUERY, ROUTES, useSiteNavigate, withQuery } from "@/navigation/routes";
import { sectionAnchor } from "@/navigation/subMenus";
import { getAccountData, saveAccountData } from "@/services/accountStore";
import { useSessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

import BenefitsBlock from "./BenefitsBlock";
import BlockHeader from "./BlockHeader";
import PaymentBox from "./PaymentBox";
import { pricingSectionStyle } from "./styles";

const PLAN_BACKGROUNDS: Readonly<Record<PlanName, string>> = {
  BASIC: "linear-gradient(180deg, #070f2a 0%, #01040a 100%)",
  PREMIUM: "linear-gradient(180deg, #16264f 0%, #01040a 100%)",
  ULTIMATE:
    "linear-gradient(147.383deg, rgb(22,38,79) 13.139%, rgb(14,26,60) 31.387%, rgb(7,15,40) 53.285%, rgb(3,8,26) 71.533%, rgb(1,4,10) 86.131%)",
};

/*
 * 카드 세 자리는 디자인 좌표 그대로 두고 어느 플랜이 어느 자리에 앉을지만 돌린다.
 * left/top/width/height 를 움직이면 배치를 다시 계산해 버벅여서, 상자 크기는 하나로 고정하고
 * 자리는 translate3d, 가운데 카드의 큰 크기(475×530)는 scale 로 낸다.
 */
const CARD_WIDTH = 467;
const CARD_HEIGHT = 520;
const CENTER_SCALE = 475 / CARD_WIDTH;

const SLOTS = [
  { x: 57, y: 60, scale: 1 },
  // 제자리에서 부푸는 만큼 당겨 디자인 좌표(556, 50)에 맞춘다.
  { x: 556 + (475 - CARD_WIDTH) / 2, y: 50 + (530 - CARD_HEIGHT) / 2, scale: CENTER_SCALE },
  { x: 1063, y: 60, scale: 1 },
] as const;
const CENTER_SLOT = 1;

interface PricingPlansProps {
  top: number;
}

/** 구독 요금제. 플랜 비교 · 결제 정보 · 혜택 안내 세 덩이. */
export default function PricingPlans({ top }: PricingPlansProps) {
  const navigate = useSiteNavigate();
  const user = useSessionUser();
  // 돌린 칸 수. 0 이면 BASIC·PREMIUM·ULTIMATE 원래 순서.
  const [rotation, setRotation] = useState(0);
  const [selectedPlan, setSelectedPlan] = useState<PricingPlan | null>(null);
  const [isAlertRequested, setIsAlertRequested] = useState(false);
  const planCount = PRICING.plans.length;

  const rotate = (steps: number) => setRotation((value) => (value + steps + planCount) % planCount);

  // 결제(PG)는 서버가 있어야 해서, 그 전까지는 로그인을 받고 오픈 알림 신청을 받는다.
  const handleSubscribe = async (event: MouseEvent<HTMLButtonElement>, plan: PricingPlan) => {
    event.stopPropagation(); // 카드 돌리기로 번지지 않게
    if (!user) {
      navigate(withQuery(ROUTES.login, { [QUERY.next]: ROUTES.pricing }));
      return;
    }
    const data = await getAccountData(user.email);
    setIsAlertRequested(data?.settings.launchAlertPlan === plan.name);
    setSelectedPlan(plan);
  };

  const handleRequestAlert = async () => {
    if (!user || !selectedPlan) return;
    const data = await getAccountData(user.email);
    await saveAccountData(user.email, {
      settings: { ...data?.settings, launchAlertPlan: selectedPlan.name, launchAlertAt: Date.now() },
    });
    setIsAlertRequested(true);
  };

  const closeModal = () => setSelectedPlan(null);

  return (
    <div style={{ ...rootStyle, top: `${top}px` }}>
      {/* 뒤 흐림은 걸지 않는다. 카드가 뜨고 맥 선이 흐를 때마다 넓은 흐림을 다시 계산해 첫 화면이 멈춘다. */}
      <section
        style={{ ...pricingSectionStyle, height: "756px", background: "none", border: "none" }}
        {...sectionAnchor("plans")}
      >
        <BlockHeader
          eyebrow="Plans"
          title="구독 플랜 비교"
          description="가장 적합한 플랜을 선택하고, 혜택을 한눈에 비교하세요."
        />

        <div style={{ position: "relative", width: "1587px", height: "640px" }}>
          {PRICING.plans.map((plan, i) => {
            const slotIndex = (i + rotation) % planCount;
            const slot = SLOTS[slotIndex];
            const active = slotIndex === CENTER_SLOT;
            return (
              <div
                key={plan.name}
                onClick={() => !active && rotate(CENTER_SLOT - slotIndex)}
                style={{
                  ...cardSlotStyle,
                  transform: `translate3d(${slot.x}px, ${slot.y}px, 0) scale(${slot.scale})`,
                  zIndex: active ? 2 : 1,
                  cursor: active ? "default" : "pointer",
                }}
              >
                <div
                  className={active ? "bob" : undefined}
                  style={{
                    ...cardStyle,
                    background: PLAN_BACKGROUNDS[plan.name],
                    border: active ? "1.5px solid rgba(50,82,150,0.85)" : "1px solid rgba(46,72,137,0.2)",
                    boxShadow: active
                      ? "0 0 72px 10px rgba(46,72,137,0.32), 0 20px 52px 0 rgba(47,62,112,0.45)"
                      : "0 8px 24px 0 rgba(0,0,0,0.35)",
                    // 옆 카드는 한 겹 뒤로 물러나 가운데가 먼저 눈에 든다.
                    opacity: active ? 1 : 0.7,
                    filter: active ? "none" : "saturate(0.75) brightness(0.88)",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}
                  >
                    <span style={{ fontFamily: FONT.display, fontSize: "32px", color: COLOR.textBright }}>
                      {plan.name}
                    </span>
                    <span style={{ ...priceStyle, color: active ? "#9fb4ea" : COLOR.accent }}>{plan.price}</span>
                  </div>
                  {/* 가운데로 온 플랜은 글을 밝혀 회색에 묻히지 않게 한다. */}
                  <div style={{ ...summaryStyle, color: active ? "#dfe5f2" : COLOR.textMuted }}>{plan.summary}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: "1 0 auto" }}>
                    {plan.features.map((line) => (
                      <span key={line} style={{ ...featureStyle, color: active ? "#eef2f8" : COLOR.textMuted }}>
                        {line}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {plan.extras.map((line) => (
                      <span key={line} style={{ ...extraStyle, color: active ? "#c9d2e6" : COLOR.textMuted }}>
                        {line}
                      </span>
                    ))}
                  </div>

                  {/* 334 짜리 위에 270 짜리를 겹쳐 가운데가 진해 보인다. */}
                  {active && (
                    <div style={waveBoxStyle} aria-hidden="true">
                      <HeartbeatLine
                        shape="card"
                        width="334px"
                        height="16px"
                        strokeWidth={1.1}
                        opacity={0.5}
                        duration={2.6}
                        style={waveStyle}
                      />
                      <HeartbeatLine
                        shape="cardSmall"
                        width="270px"
                        height="16px"
                        strokeWidth={1.1}
                        opacity={0.65}
                        duration={2.6}
                        delay={0.35}
                        style={waveStyle}
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn btn-sweep"
                    style={subscribeButtonStyle}
                    onClick={(e) => handleSubscribe(e, plan)}
                  >
                    <span className="btn__label">구독하기</span>
                  </button>
                </div>
              </div>
            );
          })}

          {/* 카드 바깥 여백(57px)에 들어간다. */}
          <button
            type="button"
            className="plan-arrow"
            style={{ ...arrowStyle, left: "-3px" }}
            onClick={() => rotate(1)}
            aria-label="이전 플랜"
          >
            ‹
          </button>
          <button
            type="button"
            className="plan-arrow"
            style={{ ...arrowStyle, right: "-3px" }}
            onClick={() => rotate(-1)}
            aria-label="다음 플랜"
          >
            ›
          </button>
        </div>
      </section>

      <section style={pricingSectionStyle} {...sectionAnchor("payment")}>
        <BlockHeader
          eyebrow="Payment"
          title="결제 정보"
          description="결제 수단을 등록하고, 자동 결제/환불 정책을 확인하세요."
        />
        <div style={{ display: "flex", gap: "24px", width: "100%" }}>
          {PRICING.paymentBoxes.map((box) => (
            <PaymentBox key={box.title} {...box} />
          ))}
        </div>
      </section>

      <BenefitsBlock />

      <Modal
        open={Boolean(selectedPlan)}
        onClose={closeModal}
        title={`${selectedPlan?.name ?? ""} 플랜 구독`}
        description="결제는 서비스 오픈과 함께 열립니다. 오픈 알림을 신청하면 가입한 이메일로 가장 먼저 알려 드려요."
      >
        {selectedPlan && (
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div style={modalPlanStyle}>
              <span style={{ fontFamily: FONT.mono, fontSize: "15px", color: COLOR.textMuted }}>
                {selectedPlan.summary}
              </span>
              <span style={{ fontFamily: FONT.display, fontSize: "30px", color: COLOR.textBright }}>
                {selectedPlan.price}
              </span>
            </div>
            <span style={{ fontFamily: FONT.mono, fontSize: "14px", color: COLOR.textDim }}>
              받는 곳 · {user?.email}
            </span>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button type="button" className="btn" style={modalSecondaryStyle} onClick={closeModal}>
                <span className="btn__label">닫기</span>
              </button>
              {isAlertRequested ? (
                <span style={{ alignSelf: "center", fontFamily: FONT.body, fontWeight: 700, color: COLOR.success }}>
                  ✓ 오픈 알림 신청됨
                </span>
              ) : (
                <button type="button" className="btn btn-sweep" style={modalPrimaryStyle} onClick={handleRequestAlert}>
                  <span className="btn__label">오픈 알림 신청</span>
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

const rootStyle: CSSProperties = {
  position: "absolute",
  left: "110px",
  width: "1699px",
  display: "flex",
  flexDirection: "column",
  gap: "100px",
};

const cardSlotStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: `${CARD_WIDTH}px`,
  height: `${CARD_HEIGHT}px`,
  transition: "transform .5s var(--ease-smooth)",
  willChange: "transform",
};

const cardStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  padding: "32px",
  borderRadius: "20px",
  display: "flex",
  flexDirection: "column",
  // 24 면 가운데 카드에 파형 한 줄이 더 붙어 「구독하기」가 잘린다.
  gap: "18px",
  overflow: "hidden",
  boxSizing: "border-box",
  transition: "border-color .45s ease, box-shadow .45s ease, opacity .45s ease, filter .45s ease",
};

const priceStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "24px",
  transition: "color .45s ease",
};

const summaryStyle: CSSProperties = { fontFamily: FONT.mono, fontSize: "16px", transition: "color .45s ease" };

const featureStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "16px",
  lineHeight: 1.5,
  transition: "color .45s ease",
};

// 14px 보다 키우면 카드 밖으로 밀려 잘린다.
const extraStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "14px",
  lineHeight: 1.4,
  transition: "color .45s ease",
};

const subscribeButtonStyle: CSSProperties = {
  // 카드 오른쪽 아래에 붙는 작은 알약.
  alignSelf: "flex-end",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "40px",
  padding: "10px 22px",
  borderRadius: "100px",
  background: COLOR.glass,
  border: "1px solid rgba(50,82,150,0.35)",
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  color: COLOR.accent,
  cursor: "pointer",
  boxSizing: "border-box",
};

const waveBoxStyle: CSSProperties = {
  position: "relative",
  height: "16px",
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const waveStyle: CSSProperties = {
  position: "absolute",
  height: "16px",
  maxWidth: "none",
  display: "block",
};

const arrowStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  width: "46px",
  height: "46px",
  borderRadius: "999px",
  background: "rgba(5,11,26,0.75)",
  border: "1px solid rgba(50,82,150,0.35)",
  color: COLOR.accent,
  fontFamily: FONT.body,
  fontSize: "26px",
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  zIndex: 3,
};

const modalPlanStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  padding: "16px 18px",
  borderRadius: "12px",
  border: `1px solid ${COLOR.border}`,
  background: "#0b1224",
};
