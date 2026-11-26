import Modal from "@/components/Modal";
import type { PaymentTopic } from "@/data/pricing";
import { PAYMENT_DETAILS } from "@/data/pricingDetails";

import DetailBlockView from "./DetailBlockView";

interface PaymentDetailModalProps {
  topic: PaymentTopic;
  title: string;
  open: boolean;
  onClose: () => void;
}

/** 결제 정보 상자를 눌렀을 때 — 맨 위 한 줄 요약, 아래로 무엇을 · 어떻게 · 문제가 생기면 · 확인은 어디서. */
export default function PaymentDetailModal({ topic, title, open, onClose }: PaymentDetailModalProps) {
  const { lead, blocks } = PAYMENT_DETAILS[topic];

  return (
    <Modal open={open} onClose={onClose} title={title} description={lead} className="modal--detail">
      {/* 내용만 모달 안에서 넘긴다. */}
      <div className="pricing-detail" tabIndex={0} role="region" aria-label={`${title} 내용`}>
        {blocks.map((block) => (
          <DetailBlockView key={block.heading} block={block} />
        ))}
      </div>
    </Modal>
  );
}
