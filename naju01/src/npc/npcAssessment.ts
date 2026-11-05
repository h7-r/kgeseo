// 플레이어 상태 추정 — npc_ai_input/0.1 → npc_assessment/0.1. 순수 함수(React · 게임 모듈 의존 없음).
// 지금은 규칙 기준선(rule_baseline)만 있다. 나중에 학습 모델이 같은 PlayerStateAssessor 계약으로 들어오면
// assessmentEval 의 같은 시나리오로 둘을 비교한다. 개입 여부(제안할지)는 helpPolicy 가 따로 정한다.
//
// [보수적으로] 「막힘」을 확정하지 않는다 — 관측 가능한 행동(진행 없음 + 같은 구역을 오감)의 조합만 POSSIBLY_STUCK 으로 본다.
//   멈춰 있음 · 오래 머묾 · 진행 없음 하나만으로는 POSSIBLY_STUCK 이 아니다. 퍼즐 정답 · 오답 · 힌트 단계는 없는 데이터라 쓰지 않는다.
// [창] 반복 방문은 「마지막 진행 뒤」만 센다(진행하면 판단이 초기화된다). 추적기의 누적 방문 수는 진행 전 것까지 섞여 있어
//   recent_events(최근 10개)의 zone_entered 를 쓴다 — 창 안 이벤트가 10개를 넘으면 앞쪽이 잘린다(그때는 이미 반복이 많다).
//   재진입 = 창 안 진입 수 − 서로 다른 구역 수. 창이 시작될 때 서 있던 구역으로 돌아오는 것은 이벤트 목록만으로는 못 봐서
//   하나 적게 셀 수 있다(막힘을 덜 보는 쪽 — 보수적). 예: Z1 에서 시작해 Z2 → Z1 은 0.
import type { NpcAiInput } from "./npcAiInput";

export const NPC_ASSESSMENT_SCHEMA = "npc_assessment/0.1";

export type PlayerAssessmentState = "EXPLORING" | "POSSIBLY_STUCK" | "INSUFFICIENT_DATA";

export type AssessmentEvidence =
  | "INSUFFICIENT_OBSERVATION" // 놀이 시간이 짧거나 구역을 모름
  | "RECENT_PROGRESS" // 정체 기준 시간 안에 진행이 있었다
  | "STALL_THRESHOLD_NOT_REACHED" // 아직 진행은 없지만 추적 시작부터 정체 기준 시간이 안 됐다
  | "NO_RECENT_PROGRESS" // 정체 기준 시간 넘게 진행이 없다
  | "REPEATED_ZONE_VISITS" // 마지막 진행 뒤 같은 구역을 여러 번 다시 들어섰다
  | "NEW_AREA_VISITED" // 최근 처음 가 보는 구역에 들어섰다 (탐색 중)
  | "PLAYER_IDLE_LONG"; // 오래 움직이지 않았다 (자리를 비웠을 수 있음 — 막힘 근거로 쓰지 않는다)

export interface NpcAssessment {
  readonly schema: typeof NPC_ASSESSMENT_SCHEMA;
  readonly state: PlayerAssessmentState;
  readonly evidence: readonly AssessmentEvidence[];
  /** 누가 판단했는지 — 학습 모델과 비교할 때 구분 */
  readonly decision_source: string;
  /** 판단한 놀이 시각 (s) */
  readonly observed_at_s: number;
  /** 판단에 쓴 값 (그대로 다시 계산해 볼 수 있게) */
  readonly metrics: {
    readonly active_seconds: number;
    readonly since_last_progress_s: number;
    readonly idle_seconds: number;
    readonly window_zone_entries: number;
    readonly window_revisits: number;
    readonly new_area_recently: boolean;
  };
}

/** 학습 모델도 이 계약으로 들어온다 */
export interface PlayerStateAssessor {
  readonly id: string;
  assess(input: NpcAiInput): NpcAssessment;
}

/**
 * 규칙 기준선의 임계값 — 모두 임시값이다(플레이 테스트로 정한 값이 아니다).
 * 나주 맵은 구역 4개 · 씬 5개 규모라 「몇 분 진행 없이 같은 구역을 오감」을 보수적으로 잡았다. 실제 플레이 기록으로 다시 정해야 한다.
 */
export const ASSESSMENT_CONFIG = {
  /** 이보다 짧게 놀았으면 판단하지 않는다 (s) */
  minObservationSeconds: 120,
  /** 마지막 진행 뒤 이만큼 지나면 「진행 없음」 (s) */
  stallSeconds: 300,
  /** 마지막 진행 뒤 같은 구역 재진입이 이 수 이상이면 「반복 방문」 */
  minWindowRevisits: 2,
  /** 처음 가 보는 구역에 이 시간 안에 들어섰으면 탐색 중으로 본다 (s) */
  newAreaGraceSeconds: 120,
  /** 이만큼 움직이지 않았으면 자리를 비웠을 수 있다 — 막힘으로 보지 않는다 (s) */
  idleLongSeconds: 180,
};

export type AssessmentConfig = typeof ASSESSMENT_CONFIG;

/** 마지막 진행 뒤(창) 구역 진입 · 재진입 수와 최근 새 구역 여부 */
export function windowZoneSignals(input: NpcAiInput, config: AssessmentConfig = ASSESSMENT_CONFIG) {
  const now = input.clock.active_seconds;
  const start = input.progress.last_progress?.at_s ?? 0;
  const entries = input.recent_events.filter((e) => e.type === "zone_entered" && e.at_s > start);
  const targets = entries.map((e) => e.target);
  const revisits = targets.length - new Set(targets).size;
  const newAreaRecently = entries.some(
    (e) => now - e.at_s <= config.newAreaGraceSeconds && input.progress.zone_visits[e.target] === 1,
  );
  return { entries: targets.length, revisits, newAreaRecently };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) freeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

export function assessPlayerByRules(input: NpcAiInput, config: AssessmentConfig = ASSESSMENT_CONFIG): NpcAssessment {
  const active = input.clock.active_seconds;
  const since = input.progress.since_last_progress_s;
  const idle = input.player.idle_seconds;
  const zone = windowZoneSignals(input, config);
  const evidence: AssessmentEvidence[] = [];
  let state: PlayerAssessmentState;

  const zoneUnknown = input.player.zone === null && Object.keys(input.progress.zone_visits).length === 0;
  if (active < config.minObservationSeconds || zoneUnknown) {
    evidence.push("INSUFFICIENT_OBSERVATION");
    state = "INSUFFICIENT_DATA";
  } else if (since < config.stallSeconds) {
    evidence.push(input.progress.last_progress ? "RECENT_PROGRESS" : "STALL_THRESHOLD_NOT_REACHED");
    if (zone.revisits >= config.minWindowRevisits) evidence.push("REPEATED_ZONE_VISITS");
    if (zone.newAreaRecently) evidence.push("NEW_AREA_VISITED");
    state = "EXPLORING";
  } else {
    evidence.push("NO_RECENT_PROGRESS");
    const repeated = zone.revisits >= config.minWindowRevisits;
    if (repeated) evidence.push("REPEATED_ZONE_VISITS");
    if (zone.newAreaRecently) evidence.push("NEW_AREA_VISITED");
    if (idle >= config.idleLongSeconds) {
      // 오래 멈춰 있으면 자리를 비웠을 수 있다 — 막힘으로도 탐색으로도 단정하지 않는다
      evidence.push("PLAYER_IDLE_LONG");
      state = "INSUFFICIENT_DATA";
    } else if (repeated && !zone.newAreaRecently) {
      state = "POSSIBLY_STUCK";
    } else {
      // 진행 없음만 있거나(한 구역을 차분히 살피는 중일 수 있음) 새 구역을 가 보는 중
      state = "EXPLORING";
    }
  }

  return freeze({
    schema: NPC_ASSESSMENT_SCHEMA,
    state,
    evidence,
    decision_source: "rule_baseline",
    observed_at_s: active,
    metrics: {
      active_seconds: active,
      since_last_progress_s: since,
      idle_seconds: idle,
      window_zone_entries: zone.entries,
      window_revisits: zone.revisits,
      new_area_recently: zone.newAreaRecently,
    },
  } as const);
}

export function createRuleBaselineAssessor(config: AssessmentConfig = ASSESSMENT_CONFIG): PlayerStateAssessor {
  return { id: "rule_baseline/0.1", assess: (input) => assessPlayerByRules(input, config) };
}
