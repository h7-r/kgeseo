import Modal from "@/components/Modal";
import { modalPrimaryStyle } from "@/components/modalButtonStyles";
import type { PricingPlan } from "@/data/pricing";
import { PLAN_DETAILS } from "@/data/pricingDetails";

import DetailBlockView from "./DetailBlockView";

interface PlanDetailModalProps {
  plan: PricingPlan;
  open: boolean;
  onClose: () => void;
  /** 카드의 「구독하기」와 같은 일을 한다. */
  onSubscribe: () => void;
}

/** 플랜 카드를 눌렀을 때 — 가격 · 혜택 풀이 · 이용 조건 · 플랜 비교 · 플랜 변경 · 맞는 사람. */
export default function PlanDetailModal({ plan, open, onClose, onSubscribe }: PlanDetailModalProps) {
  const { billing, blocks } = PLAN_DETAILS[plan.name];
  const isFree = plan.price === "Free";

  return (
    <Modal open={open} onClose={onClose} title={plan.name} description={plan.summary} className="modal--detail">
      {/* 내용만 모달 안에서 넘긴다. 제목과 「구독하기」는 늘 보인다. */}
      <div className="pricing-detail" tabIndex={0} role="region" aria-label={`${plan.name} 플랜 내용`}>
        <div className="pricing-detail__price">
          <span>
            <span className="pricing-detail__amount">{plan.price}</span>
            {!isFree && <span className="pricing-detail__unit">/ 월</span>}
          </span>
          <span className="pricing-detail__billing">{billing}</span>
        </div>
        {blocks.map((block) => (
          <DetailBlockView key={block.heading} block={block} />
        ))}
      </div>

      <div className="pricing-detail__actions">
        <button type="button" className="button button--primary" style={modalPrimaryStyle} onClick={onSubscribe}>
          <span className="button__label">구독하기</span>
        </button>
      </div>
    </Modal>
  );
}
