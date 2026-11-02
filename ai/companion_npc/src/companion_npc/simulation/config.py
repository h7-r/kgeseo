"""시뮬레이터 실험 설정.

★ 아래 기본값은 **실제 플레이어를 관찰해서 얻은 값이 아니다.** P2-C 설계안의 초기 가정이다.
  experiments/p2c_default.json 이 같은 값을 그대로 담고 있으며, 실험할 때는 그 파일을 고친다.
  (test_simulation 이 두 곳의 값이 같은지 검사한다)
"""

from typing import Literal

from pydantic import Field, model_validator

from companion_npc.contracts.common import AwareDatetime, ContractModel

GENERATOR_VERSION = "sim/0.1"

ArchetypeName = Literal[
    "fast_solver",
    "trial_and_error",
    "repeat_wrong",
    "long_explorer",
    "dropout",
]
ARCHETYPES: tuple[ArchetypeName, ...] = (
    "fast_solver",
    "trial_and_error",
    "repeat_wrong",
    "long_explorer",
    "dropout",
)


class LogNormal(ContractModel):
    """시간 분포. median 초 · sigma (로그 표준편차)."""

    median_sec: float = Field(gt=0)
    sigma: float = Field(ge=0)


class ArchetypeParams(ContractModel):
    # 채점 직전 '생각하며 입력' 하는 시간 (working)
    think: LogNormal
    # 채점 전에 생산적으로 탐색할 확률과 그 시간 (exploring)
    explore_prob: float = Field(ge=0, le=1)
    explore: LogNormal
    # 정답 확률: 첫 시도 p_initial, 틀릴 때마다 +p_step, 최대 p_max
    p_correct_initial: float = Field(ge=0, le=1)
    p_correct_step: float = Field(ge=0, le=1)
    p_correct_max: float = Field(ge=0, le=1)
    # 「깨달음」: 틀릴 때마다 insight_hazard 확률로 일어나고, 그 뒤 정답 확률은 p_after_insight
    insight_hazard: float | None = Field(default=None, ge=0, le=1)
    p_after_insight: float | None = Field(default=None, ge=0, le=1)
    # 바로 전 오답을 그대로 다시 낼 확률
    repeat_wrong_prob: float = Field(ge=0, le=1)
    # 연속 오답이 stuck_after_fails 이상이면 stuck_prob 확률로 막힘(stuck) 구간
    stuck_after_fails: int = Field(ge=1)
    stuck_prob: float = Field(ge=0, le=1)
    stuck: LogNormal
    # 오답 뒤 이탈할 확률. dropout_after_stuck 이면 막힘 구간을 거친 뒤 떠난다
    dropout_per_failed_attempt: float = Field(ge=0, le=1)
    dropout_after_stuck: bool = False
    # 탐색 중 합성 inspect·navigate 의 분당 개수 (별도 파일에만 기록)
    exploration_actions_per_min: float = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _insight_pair(self) -> "ArchetypeParams":
        if (self.insight_hazard is None) != (self.p_after_insight is None):
            raise ValueError("insight_hazard and p_after_insight go together")
        return self


class AwayParams(ContractModel):
    """일시정지·자리 비움 — 로그에 남지 않는다. 모든 유형에 공통."""

    prob_per_gap: float = Field(ge=0, le=1)
    duration: LogNormal


class CaseSource(ContractModel):
    case_id: str
    # ai/companion_npc 기준 상대 경로. 예: ../../backend/app/content/cases
    cases_dir: str


class SimulationConfig(ContractModel):
    generator_version: Literal["sim/0.1"] = GENERATOR_VERSION
    seed: int
    sessions_per_case_archetype: int = Field(ge=1)
    cases: list[CaseSource] = Field(min_length=1)
    base_time: AwareDatetime
    start_spread_hours: float = Field(ge=0)
    # 로그를 내보낸 시각 = 세션 시작 + U(min, max) 분. 이보다 늦은 이벤트는 잘린다.
    export_after_min: tuple[float, float]
    max_session_min: float = Field(gt=0)
    epilogue_sec: float = Field(ge=0)
    already_completed_prob: float = Field(ge=0, le=1)  # 푼 퍼즐을 다시 입력할 확률
    combine_attempt_prob: float = Field(
        ge=0, le=1
    )  # 단서 2개 이상일 때 조합을 시도할 확률 (늘 실패)
    emit_exploration_events: bool
    away: AwayParams
    archetypes: dict[ArchetypeName, ArchetypeParams]

    @model_validator(mode="after")
    def _complete(self) -> "SimulationConfig":
        if set(self.archetypes) != set(ARCHETYPES):
            raise ValueError(f"archetypes must define exactly {ARCHETYPES}")
        low, high = self.export_after_min
        if not 0 < low <= high:
            raise ValueError("export_after_min must be 0 < min <= max")
        return self


def _ln(median: float, sigma: float) -> LogNormal:
    return LogNormal(median_sec=median, sigma=sigma)


# ── 초기 가정값 (관찰 근거 없음) ────────────────────────────────
DEFAULT_ARCHETYPES: dict[str, ArchetypeParams] = {
    "fast_solver": ArchetypeParams(
        think=_ln(25, 0.5),
        explore_prob=0.1,
        explore=_ln(60, 0.5),
        p_correct_initial=0.7,
        p_correct_step=0.1,
        p_correct_max=0.95,
        repeat_wrong_prob=0.1,
        stuck_after_fails=99,
        stuck_prob=0.0,
        stuck=_ln(60, 0.5),
        dropout_per_failed_attempt=0.0,
        exploration_actions_per_min=1,
    ),
    "trial_and_error": ArchetypeParams(
        think=_ln(20, 0.6),
        explore_prob=0.15,
        explore=_ln(60, 0.6),
        p_correct_initial=0.15,
        p_correct_step=0.1,
        p_correct_max=0.8,
        repeat_wrong_prob=0.15,
        stuck_after_fails=6,
        stuck_prob=0.3,
        stuck=_ln(120, 0.6),
        dropout_per_failed_attempt=0.02,
        exploration_actions_per_min=1,
    ),
    "repeat_wrong": ArchetypeParams(
        think=_ln(30, 0.6),
        explore_prob=0.1,
        explore=_ln(60, 0.6),
        p_correct_initial=0.05,
        p_correct_step=0.0,
        p_correct_max=0.05,
        insight_hazard=0.08,
        p_after_insight=0.6,
        repeat_wrong_prob=0.7,
        stuck_after_fails=3,
        stuck_prob=0.4,
        stuck=_ln(150, 0.6),
        dropout_per_failed_attempt=0.05,
        exploration_actions_per_min=0.5,
    ),
    "long_explorer": ArchetypeParams(
        think=_ln(20, 0.5),
        explore_prob=0.9,
        explore=_ln(180, 0.7),
        p_correct_initial=0.5,
        p_correct_step=0.1,
        p_correct_max=0.9,
        repeat_wrong_prob=0.05,
        stuck_after_fails=8,
        stuck_prob=0.1,
        stuck=_ln(120, 0.6),
        dropout_per_failed_attempt=0.01,
        exploration_actions_per_min=3,
    ),
    "dropout": ArchetypeParams(
        think=_ln(20, 0.6),
        explore_prob=0.15,
        explore=_ln(60, 0.6),
        p_correct_initial=0.15,
        p_correct_step=0.1,
        p_correct_max=0.8,
        repeat_wrong_prob=0.15,
        stuck_after_fails=2,
        stuck_prob=0.5,
        stuck=_ln(90, 0.6),
        dropout_per_failed_attempt=0.25,  # 기하분포 — 평균 4번 오답 뒤 이탈
        dropout_after_stuck=True,
        exploration_actions_per_min=1,
    ),
}
