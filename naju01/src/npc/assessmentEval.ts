// 상태 추정기 평가 — 같은 시나리오(npc_ai_input/0.1 + 기대 상태)로 규칙 기준선과 학습 모델을 나란히 잰다. 순수 함수.
// 시나리오의 기대 상태는 「설계 의도」 표시다(실제 플레이어 기록으로 붙인 정답이 아니다).
import type { NpcAiInput } from "./npcAiInput";
import type { PlayerAssessmentState, PlayerStateAssessor } from "./npcAssessment";

export interface AssessmentScenario {
  id: string;
  /** 무엇을 보려는 시나리오인지 */
  description: string;
  input: NpcAiInput;
  expected: PlayerAssessmentState;
}

export interface AssessmentEvalResult {
  assessor: string;
  total: number;
  correct: number;
  /** 기대 상태 → 낸 상태 → 수 */
  confusion: Record<PlayerAssessmentState, Record<PlayerAssessmentState, number>>;
  /** 틀린 시나리오 */
  misses: { id: string; expected: PlayerAssessmentState; got: PlayerAssessmentState; evidence: readonly string[] }[];
}

const STATES: PlayerAssessmentState[] = ["EXPLORING", "POSSIBLY_STUCK", "INSUFFICIENT_DATA"];

export function evaluateAssessor(
  assessor: PlayerStateAssessor,
  scenarios: readonly AssessmentScenario[],
): AssessmentEvalResult {
  const confusion = Object.fromEntries(
    STATES.map((e) => [e, Object.fromEntries(STATES.map((g) => [g, 0]))]),
  ) as AssessmentEvalResult["confusion"];
  const misses: AssessmentEvalResult["misses"] = [];
  let correct = 0;
  for (const s of scenarios) {
    const a = assessor.assess(s.input);
    confusion[s.expected][a.state]++;
    if (a.state === s.expected) correct++;
    else misses.push({ id: s.id, expected: s.expected, got: a.state, evidence: a.evidence });
  }
  return { assessor: assessor.id, total: scenarios.length, correct, confusion, misses };
}
