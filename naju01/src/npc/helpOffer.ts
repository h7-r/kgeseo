// 도움 제안 상태 — 정책(helpPolicy)이 낸 OFFER_HELP 를 화면 안내([F] 도움)로 이어 주는 작은 상태기. 순수 로직.
//
// [상태] 제안은 한 번에 하나: pending → accepted(F 로 수락해 대화가 열림) | declined(G 로 명시적 거절) | expired(이유와 함께).
//   같은 offer_id 는 한 번만 받는다(두 번째부터 무시). 새 제안이 오면 앞의 pending 은 superseded 로 만료한다.
// [만료] 유효 시간 지남(timeout) · 새 진행(progress) · 추정이 EXPLORING 으로 바뀜(assessment_changed) · 세션/정책 초기화(reset).
//   추정이 INSUFFICIENT_DATA 로 바뀐 것만으로는 만료하지 않는다(오래 서서 생각 중일 수 있다 — PLAYER_IDLE_LONG).
// [숨김 ≠ 거절] 대화를 걸 수 없어 안내를 숨겨도(멀어짐 · 컷 · 잠금 풀림 · 씬 멈춤) 제안은 pending 그대로다. 거절은 decline() 으로만 기록한다.
// [시간] 모든 시각은 놀이 시간(정책 · 추적기와 같은 시계).
import type { InteractionPrompt } from "./dialogSession";
import type { HelpDecision } from "./helpPolicy";
import type { PlayerAssessmentState } from "./npcAssessment";

/** 제안 유효 시간 — 임시값(게임 규칙으로 정한 값이 아니다). 정책의 제안 쿨다운(180 s)보다 짧게 둬 다음 제안과 겹치지 않게 했다 */
export const HELP_OFFER_CONFIG = {
  offerTtlSeconds: 60,
};

export type HelpOfferConfig = typeof HELP_OFFER_CONFIG;

export type HelpOfferStatus = "pending" | "accepted" | "declined" | "expired";
export type HelpOfferExpiry = "timeout" | "progress" | "assessment_changed" | "superseded" | "reset";

export interface HelpOffer {
  readonly offerId: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly status: HelpOfferStatus;
  /** 만든 때의 진행 수 — 이보다 늘면 만료 */
  readonly progressAtCreate: number;
  readonly resolvedAt: number | null;
  readonly expiry: HelpOfferExpiry | null;
}

export interface HelpOfferTickInput {
  now: number;
  progressCount: number;
  assessmentState: PlayerAssessmentState | null;
}

export interface HelpOfferStore {
  /** 정책 결정을 넣는다. OFFER_HELP 이고 처음 보는 offer_id 면 새 pending 제안을 만든다. 만들었으면 true */
  present(decision: HelpDecision, progressCount: number): boolean;
  /** 매 프레임: 유효 시간 · 진행 · 추정 변화로 만료한다 */
  tick(input: HelpOfferTickInput): void;
  /** 지금 수락 · 거절할 수 있는 제안 (pending 이고 아직 안 지남). 없으면 null */
  pending(now: number): HelpOffer | null;
  /** 수락 — 그 제안이 지금 pending 일 때만. 대화가 실제로 열린 뒤에 부른다 */
  accept(offerId: number, now: number): boolean;
  /** 명시적 거절 — 그 제안이 지금 pending 일 때만(같은 제안 두 번째 거절은 false) */
  decline(offerId: number, now: number): boolean;
  reset(): void;
  /** 지금 · 지난 제안 (최근 10) */
  snapshot(): { current: HelpOffer | null; history: readonly HelpOffer[]; seen: number };
}

export function createHelpOfferStore(config: HelpOfferConfig = HELP_OFFER_CONFIG): HelpOfferStore {
  let current: HelpOffer | null = null;
  let history: HelpOffer[] = [];
  let seen = new Set<number>();

  const settle = (patch: Partial<HelpOffer>) => {
    if (!current) return;
    const done = Object.freeze({ ...current, ...patch });
    history = [...history, done].slice(-10);
    current = done;
  };
  const expire = (reason: HelpOfferExpiry, now: number) => {
    if (current?.status === "pending") settle({ status: "expired", expiry: reason, resolvedAt: now });
  };
  const isPending = (offerId: number, now: number) =>
    current !== null && current.offerId === offerId && current.status === "pending" && now < current.expiresAt;

  return {
    present(decision, progressCount) {
      if (decision.action !== "OFFER_HELP" || decision.offer_id === null) return false;
      if (seen.has(decision.offer_id)) return false;
      seen.add(decision.offer_id);
      expire("superseded", decision.at_s);
      current = Object.freeze({
        offerId: decision.offer_id,
        createdAt: decision.at_s,
        expiresAt: decision.at_s + config.offerTtlSeconds,
        status: "pending",
        progressAtCreate: progressCount,
        resolvedAt: null,
        expiry: null,
      });
      return true;
    },
    tick({ now, progressCount, assessmentState }) {
      if (current?.status !== "pending") return;
      if (now >= current.expiresAt) expire("timeout", now);
      else if (progressCount > current.progressAtCreate) expire("progress", now);
      else if (assessmentState === "EXPLORING") expire("assessment_changed", now);
    },
    pending: (now) => (current && isPending(current.offerId, now) ? current : null),
    accept(offerId, now) {
      if (!isPending(offerId, now)) return false;
      settle({ status: "accepted", resolvedAt: now });
      return true;
    },
    decline(offerId, now) {
      if (!isPending(offerId, now)) return false;
      settle({ status: "declined", resolvedAt: now });
      return true;
    },
    reset() {
      if (current?.status === "pending") expire("reset", current.createdAt);
      current = null;
      history = [];
      seen = new Set();
    },
    snapshot: () => ({ current, history: [...history], seen: seen.size }),
  };
}

/** 화면 안내 종류 — 대화를 걸 수 없으면 아무것도 안 보인다. 걸 수 있고 유효한 제안이 있으면 도움, 아니면 대화 */
export function promptKind(canInteract: boolean, offerPending: boolean): InteractionPrompt {
  if (!canInteract) return null;
  return offerPending ? "help" : "talk";
}
