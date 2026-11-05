// 행동 판단 평가 — 평가셋(입력 스냅숏 + 사람이 붙인 기대 레이블)으로 상태 추정기 · 개입 정책을 잰다. 순수 로직.
// 규칙 기준선 · 이후 학습 모델(LightGBM 등) · LLM 판단기가 같은 PlayerStateAssessor 계약으로 들어와 같은 사례로 비교된다.
// 한국어 대사 품질 평가와는 별개다(이것은 「언제 · 무엇으로 판단하나」만 본다).
//
// [레이블] 기대값은 규칙 계산에서 만들지 않는다 — 플레이어 경험 · 게임 진행 관점에서 따로 붙인 초안(labelStatus "draft")이고,
//   사람 검토 전에는 정답 데이터가 아니다. 합성 시나리오라 결과를 실제 플레이어 예측 정확도로 말하지 않는다.
// [제외] 기대값이 npc_ai_input/0.1 에 없는 정보(퍼즐 오답 수 · 퍼즐 장치와의 거리 등)에 달린 사례는 runtimeJudgeable=false —
//   기준선을 돌려 기록은 하되 지표에서는 뺀다.
// [이력] 정책은 제안 · 거절만 기억한다(수락은 기록하지 않음 — 수락 뒤에는 제안 쿨다운만 걸린다). 이력은 그 범위로 재현한다.
import { classificationReport, type ClassificationReport } from "./evalMetrics";
import {
  createHelpPolicy,
  HELP_POLICY_CONFIG,
  type HelpAction,
  type HelpContext,
  type HelpPolicyConfig,
} from "./helpPolicy";
import type { NpcAiInput } from "./npcAiInput";
import type { NpcAssessment, PlayerAssessmentState, PlayerStateAssessor } from "./npcAssessment";

export const BEHAVIOR_EVAL_SCHEMA = "npc_behavior_eval/0.1";
export const ASSESSMENT_STATES: readonly PlayerAssessmentState[] = ["EXPLORING", "POSSIBLY_STUCK", "INSUFFICIENT_DATA"];
export const HELP_ACTIONS: readonly HelpAction[] = ["WAIT", "OFFER_HELP"];

/** 정책 이력 한 칸 — 평가 시점보다 secondsAgo 초(놀이 시간) 전 */
export interface PolicyHistoryEvent {
  kind: "offer" | "decline" | "accept";
  secondsAgo: number;
}

export interface BehaviorEvalCase {
  id: string;
  category: string;
  description: string;
  /** 판단기에 그대로 넣는 입력 */
  input: NpcAiInput;
  /** 평가 시점의 상호작용 상황 */
  context: HelpContext;
  /** 평가 전의 제안 · 거절 · 수락 */
  history: readonly PolicyHistoryEvent[];
  /** 기대 상태 · 기대 개입 — 기존 레이블로 표현하기 어려우면 null (labelNote 에 적는다) */
  expectedState: PlayerAssessmentState | null;
  expectedAction: HelpAction | null;
  rationale: string;
  limitations: string;
  /** 런타임 입력으로 기대값을 판단할 수 있는가 */
  runtimeJudgeable: boolean;
  /** npc_ai_input 에 없는 평가용 정보 (런타임에는 없다) */
  evalOnly?: Record<string, string | number | boolean>;
  labelStatus: "draft" | "reviewed";
  labelNote?: string;
}

export interface BehaviorEvalRow {
  id: string;
  category: string;
  expectedState: PlayerAssessmentState | null;
  actualState: PlayerAssessmentState;
  expectedAction: HelpAction | null;
  actualAction: HelpAction;
  stateMatch: boolean | null;
  actionMatch: boolean | null;
  /** 상태 · 개입이 둘 다 맞음 (기대값이 하나라도 null 이면 null) */
  bothMatch: boolean | null;
  included: boolean;
  evidence: readonly string[];
  waitReasons: readonly string[];
  /** 불일치 이유 · 입력 부족 메모 */
  note: string;
}

export interface BehaviorEvalResult {
  schema: typeof BEHAVIOR_EVAL_SCHEMA;
  assessor: string;
  total: number;
  included: number;
  excluded: readonly string[];
  rows: readonly BehaviorEvalRow[];
  state: ClassificationReport<PlayerAssessmentState>;
  action: ClassificationReport<HelpAction>;
  /** 상태 · 개입이 둘 다 맞은 비율 (포함 사례 기준) */
  overallAgreement: number | null;
}

/** 이력을 정책에 다시 돌린 뒤 평가 시점 결정을 낸다 */
function decideWithHistory(
  assessment: NpcAssessment,
  c: BehaviorEvalCase,
  policyConfig: HelpPolicyConfig,
): ReturnType<ReturnType<typeof createHelpPolicy>["decide"]> {
  const policy = createHelpPolicy(policyConfig);
  const now = assessment.observed_at_s;
  const ok: HelpContext = {
    sceneActive: true,
    pointerLocked: true,
    cutActive: false,
    dialogOpen: false,
    canInteract: true,
    interactionBlock: null,
  };
  const stuckAt = (t: number): NpcAssessment => ({ ...assessment, state: "POSSIBLY_STUCK", observed_at_s: t });
  for (const h of [...c.history].sort((a, b) => b.secondsAgo - a.secondsAgo)) {
    const t = now - h.secondsAgo;
    if (h.kind === "offer" || h.kind === "accept") policy.decide(stuckAt(t), ok); // 수락도 그 전에 제안이 있었다
    if (h.kind === "decline") {
      const last = policy.state().lastOfferId;
      if (last !== null) policy.decline(last, t);
    }
  }
  return policy.decide(assessment, c.context);
}

export function runBehaviorEval(
  cases: readonly BehaviorEvalCase[],
  assessor: PlayerStateAssessor,
  policyConfig: HelpPolicyConfig = HELP_POLICY_CONFIG,
): BehaviorEvalResult {
  const rows: BehaviorEvalRow[] = cases.map((c) => {
    const assessment = assessor.assess(c.input);
    const decision = decideWithHistory(assessment, c, policyConfig);
    const stateMatch = c.expectedState === null ? null : c.expectedState === assessment.state;
    const actionMatch = c.expectedAction === null ? null : c.expectedAction === decision.action;
    const notes: string[] = [];
    if (stateMatch === false)
      notes.push(`상태 ${c.expectedState} 기대 · ${assessment.state} [${assessment.evidence.join(",")}]`);
    if (actionMatch === false)
      notes.push(`개입 ${c.expectedAction} 기대 · ${decision.action} [${decision.reasons.join(",") || "제안"}]`);
    if (!c.runtimeJudgeable) notes.push(`런타임 판단 불가: ${c.limitations}`);
    return {
      id: c.id,
      category: c.category,
      expectedState: c.expectedState,
      actualState: assessment.state,
      expectedAction: c.expectedAction,
      actualAction: decision.action,
      stateMatch,
      actionMatch,
      bothMatch: stateMatch === null || actionMatch === null ? null : stateMatch && actionMatch,
      included: c.runtimeJudgeable && c.expectedState !== null && c.expectedAction !== null,
      evidence: assessment.evidence,
      waitReasons: decision.reasons,
      note: notes.join(" · "),
    };
  });
  const included = rows.filter((r) => r.included);
  const state = classificationReport(
    ASSESSMENT_STATES,
    included.map((r) => ({ expected: r.expectedState as PlayerAssessmentState, predicted: r.actualState })),
  );
  const action = classificationReport(
    HELP_ACTIONS,
    included.map((r) => ({ expected: r.expectedAction as HelpAction, predicted: r.actualAction })),
  );
  const both = included.filter((r) => r.bothMatch).length;
  return {
    schema: BEHAVIOR_EVAL_SCHEMA,
    assessor: assessor.id,
    total: rows.length,
    included: included.length,
    excluded: rows.filter((r) => !r.included).map((r) => r.id),
    rows,
    state,
    action,
    overallAgreement: included.length ? both / included.length : null,
  };
}

/** 다른 도구(Python · LLM 프롬프트)로 넘길 평가셋 — 입력 스냅숏 · 상황 · 이력 · 기대값만 (규칙 결과는 넣지 않는다) */
export function exportBehaviorEvalDataset(cases: readonly BehaviorEvalCase[]) {
  return {
    schema: BEHAVIOR_EVAL_SCHEMA,
    note: "합성 시나리오 · 기대 레이블은 사람 검토 전 초안 — 실제 플레이어 정답 데이터가 아니다",
    cases: cases.map((c) => ({
      id: c.id,
      category: c.category,
      description: c.description,
      input: c.input,
      context: c.context,
      history: c.history,
      expected_state: c.expectedState,
      expected_action: c.expectedAction,
      rationale: c.rationale,
      limitations: c.limitations,
      runtime_judgeable: c.runtimeJudgeable,
      eval_only: c.evalOnly ?? null,
      label_status: c.labelStatus,
      label_note: c.labelNote ?? null,
    })),
  };
}
