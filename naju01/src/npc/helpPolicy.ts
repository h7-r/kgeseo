// 도움 제안 개입 정책 — 상태 추정(npc_assessment/0.1) + 지금 상호작용 상황 → WAIT | OFFER_HELP (npc_help_decision/0.1).
// 상태 추정과 떨어져 있다: 추정기를 학습 모델로 바꿔도 이 정책은 그대로 쓴다.
// 이 단계에서는 결정만 낸다 — OFFER_HELP 가 나와도 대화를 열거나 FSM 을 바꾸지 않는다(제안 UI · 수락/거절 입력은 다음 단계).
//
// [시간] 모든 시각은 놀이 시간(npc_ai_input.clock.active_seconds) — 씬이 멈춘 동안은 흐르지 않는다.
// [중복] OFFER_HELP 를 낸 순간 제안 쿨다운이 시작된다 → 같은 시각 · 쿨다운 안에서 다시 불러도 WAIT(COOLDOWN_ACTIVE).
//   commit 하지 않는 preview() 는 상태를 바꾸지 않는다(개발 도구 조회용).
// [세션] reset() 이 제안 · 거절 기록을 지운다. 지난 기록을 복원하지 않는다.
import type { NpcAssessment, PlayerAssessmentState } from "./npcAssessment";

export const NPC_HELP_DECISION_SCHEMA = "npc_help_decision/0.1";

export type HelpAction = "WAIT" | "OFFER_HELP";

export type HelpWaitReason =
  | "GAME_INACTIVE" // 씬이 멈춤 (부감 · 검수 고정 · 잠금 전)
  | "POINTER_UNLOCKED"
  | "CUTSCENE_ACTIVE" // 구역 진입 컷
  | "DIALOG_ACTIVE" // 대화 중
  | "INTERACTION_BLOCKED" // 지금 NPC 에게 말을 걸 수 없음(멀다 · 화면 밖 · 가림 등)
  | "PLAYER_DECLINED" // 최근 제안을 거절함
  | "COOLDOWN_ACTIVE" // 최근 제안함
  | "INSUFFICIENT_DATA" // 추정 근거 부족
  | "NOT_STUCK"; // 탐색 · 진행 중

export interface HelpContext {
  sceneActive: boolean;
  pointerLocked: boolean;
  cutActive: boolean;
  dialogOpen: boolean;
  /** 대화 접근 판정이 통과했는지 (npcTargeting.evaluateInteraction().ok) */
  canInteract: boolean;
  /** 판정이 막혔으면 그 이유 (기록용) */
  interactionBlock: string | null;
}

export interface HelpDecision {
  readonly schema: typeof NPC_HELP_DECISION_SCHEMA;
  readonly action: HelpAction;
  readonly reasons: readonly HelpWaitReason[];
  readonly assessment_state: PlayerAssessmentState;
  readonly assessment_evidence: readonly string[];
  /** OFFER_HELP 일 때 이번 제안 번호. WAIT 이면 null */
  readonly offer_id: number | null;
  readonly at_s: number;
  /** 제안 · 거절 쿨다운이 끝나는 놀이 시각 (없으면 null) */
  readonly cooldown_until_s: number | null;
  readonly declined_until_s: number | null;
  readonly interaction_block: string | null;
}

/**
 * 정책 값 — 모두 임시값이다(게임 규칙으로 정한 값이 아니다).
 * 제안 뒤 3 분 · 거절 뒤 10 분은 「같은 말을 자주 하지 않는다」 쪽으로 보수적으로 잡은 출발점이다. 플레이 테스트로 다시 정한다.
 */
export const HELP_POLICY_CONFIG = {
  /** 제안한 뒤 다시 제안하지 않는 놀이 시간 (s) */
  offerCooldownSeconds: 180,
  /** 거절한 뒤 다시 제안하지 않는 놀이 시간 (s) */
  declineCooldownSeconds: 600,
};

export type HelpPolicyConfig = typeof HELP_POLICY_CONFIG;

export interface HelpPolicyState {
  offers: number;
  lastOfferId: number | null;
  lastOfferAt: number | null;
  declines: number;
  declinedUntil: number | null;
  resets: number;
}

export interface HelpPolicy {
  /** 결정하고, OFFER_HELP 면 제안 쿨다운을 건다 */
  decide(assessment: NpcAssessment, context: HelpContext): HelpDecision;
  /** 결정만 미리 본다 — 상태를 바꾸지 않는다 */
  preview(assessment: NpcAssessment, context: HelpContext): HelpDecision;
  /** 플레이어가 제안을 거절함 (가장 최근 제안 번호만 받는다). 받아들였으면 true */
  decline(offerId: number, atSeconds: number): boolean;
  /** 새 세션 */
  reset(): void;
  state(): Readonly<HelpPolicyState>;
}

export function createHelpPolicy(config: HelpPolicyConfig = HELP_POLICY_CONFIG): HelpPolicy {
  let offers = 0;
  let lastOfferId: number | null = null;
  let lastOfferAt: number | null = null;
  let declines = 0;
  let declinedUntil: number | null = null;
  let resets = 0;

  const evaluate = (assessment: NpcAssessment, ctx: HelpContext, commit: boolean): HelpDecision => {
    const now = assessment.observed_at_s;
    const reasons: HelpWaitReason[] = [];
    if (!ctx.sceneActive) reasons.push("GAME_INACTIVE");
    if (!ctx.pointerLocked) reasons.push("POINTER_UNLOCKED");
    if (ctx.cutActive) reasons.push("CUTSCENE_ACTIVE");
    if (ctx.dialogOpen) reasons.push("DIALOG_ACTIVE");
    else if (!ctx.canInteract) reasons.push("INTERACTION_BLOCKED");
    if (declinedUntil !== null && now < declinedUntil) reasons.push("PLAYER_DECLINED");
    const cooldownUntil = lastOfferAt !== null ? lastOfferAt + config.offerCooldownSeconds : null;
    if (cooldownUntil !== null && now < cooldownUntil) reasons.push("COOLDOWN_ACTIVE");
    if (assessment.state === "INSUFFICIENT_DATA") reasons.push("INSUFFICIENT_DATA");
    else if (assessment.state !== "POSSIBLY_STUCK") reasons.push("NOT_STUCK");

    const offer = reasons.length === 0;
    let offerId: number | null = null;
    let cooldown = cooldownUntil;
    if (offer) {
      offerId = (lastOfferId ?? 0) + 1;
      cooldown = now + config.offerCooldownSeconds;
      if (commit) {
        offers++;
        lastOfferId = offerId;
        lastOfferAt = now;
      }
    }
    return Object.freeze({
      schema: NPC_HELP_DECISION_SCHEMA,
      action: offer ? "OFFER_HELP" : "WAIT",
      reasons: Object.freeze(reasons),
      assessment_state: assessment.state,
      assessment_evidence: Object.freeze([...assessment.evidence]),
      offer_id: offerId,
      at_s: now,
      cooldown_until_s: cooldown !== null && now < cooldown ? cooldown : null,
      declined_until_s: declinedUntil !== null && now < declinedUntil ? declinedUntil : null,
      interaction_block: ctx.interactionBlock,
    } as const);
  };

  return {
    decide: (assessment, ctx) => evaluate(assessment, ctx, true),
    preview: (assessment, ctx) => evaluate(assessment, ctx, false),
    decline(offerId, atSeconds) {
      if (offerId !== lastOfferId) return false;
      declines++;
      declinedUntil = atSeconds + config.declineCooldownSeconds;
      return true;
    },
    reset() {
      offers = 0;
      lastOfferId = null;
      lastOfferAt = null;
      declines = 0;
      declinedUntil = null;
      resets++;
    },
    state: () => Object.freeze({ offers, lastOfferId, lastOfferAt, declines, declinedUntil, resets }),
  };
}
