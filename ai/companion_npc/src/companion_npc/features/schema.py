"""FeatureVector fs-0.1 — 판단층 입력의 고정 열 목록.

[열은 언제나 같다]
  사건이 바뀌어도 열 이름과 순서는 FEATURE_SPECS 그대로다. case_id · puzzle_id 같은
  ID 는 열이 되지 않는다 — 그런 값은 meta 에만 있고 학습 행(model_row)에는 나가지 않는다.

[값이 비는 이유를 나눈다]
  observed        관측했다. 값이 있다.
  not_applicable  이 시점에는 뜻이 없다 (예: 대상 퍼즐이 없으면 대상 퍼즐 특성)
  unobservable    원천이 없거나 가려져 알 수 없다 (예: Hint API 없음, 창 밖으로 밀림)
  observed 일 때만 값이 있고, 나머지는 null 이다.
"""

from typing import Literal

from pydantic import Field, model_validator

from companion_npc.contracts.common import AwareDatetime, ContractModel

FEATURE_SET_VERSION = "fs-0.1"

FeatureStatus = Literal["observed", "not_applicable", "unobservable"]
Realtime = Literal["yes", "conditional", "needs_new_log"]


class FeatureSpec(ContractModel):
    name: str
    group: str
    dtype: Literal["float", "int", "bool"]
    # S=PlaySessionState · E=interaction_events · P=ScenarioPack · R=요청 시점 NpcContext · N=새 로그
    sources: str
    realtime: Realtime
    description: str


FEATURE_SPECS: tuple[FeatureSpec, ...] = tuple(
    FeatureSpec(name=n, group=g, dtype=d, sources=s, realtime=r, description=t)
    for n, g, d, s, r, t in [
        (
            "progress_puzzle_ratio",
            "progress",
            "float",
            "S+P",
            "yes",
            "완료 퍼즐 / 팩 퍼즐 수",
        ),
        (
            "progress_clue_ratio",
            "progress",
            "float",
            "S+P",
            "yes",
            "획득 단서 / 팩 단서 수",
        ),
        ("acquired_clue_count", "progress", "int", "S", "yes", "획득 단서 수"),
        ("flags_true_count", "progress", "int", "S", "yes", "true 인 flag 수"),
        ("target_known", "target", "bool", "R+E", "yes", "대상 퍼즐을 정할 수 있었나"),
        (
            "target_from_focus",
            "target",
            "bool",
            "R",
            "yes",
            "대상이 FE 포커스에서 왔나 (아니면 마지막 채점)",
        ),
        ("target_solved", "target", "bool", "S", "yes", "대상 퍼즐을 이미 풀었나"),
        ("target_attempt_count", "target", "int", "S", "yes", "대상 퍼즐 채점 횟수"),
        (
            "target_consecutive_incorrect",
            "target",
            "int",
            "E",
            "yes",
            "대상 퍼즐 연속 오답 (창 안)",
        ),
        (
            "target_repeat_wrong_max",
            "target",
            "int",
            "E",
            "conditional",
            "같은 오답 지문의 최대 반복",
        ),
        (
            "target_distinct_wrong",
            "target",
            "int",
            "E",
            "conditional",
            "서로 다른 오답 지문 수",
        ),
        (
            "target_hint_level",
            "target",
            "int",
            "S",
            "needs_new_log",
            "정적 힌트 단계 (Hint API)",
        ),
        (
            "target_grants_clue_count",
            "target",
            "int",
            "P",
            "yes",
            "대상 퍼즐이 주는 단서 수",
        ),
        (
            "since_last_interaction_sec",
            "time",
            "float",
            "E",
            "yes",
            "마지막 상호작용 뒤 경과",
        ),
        (
            "since_last_progress_sec",
            "time",
            "float",
            "E",
            "yes",
            "마지막 진전(완료·획득) 뒤 경과 (창 안)",
        ),
        (
            "events_in_rate_window",
            "time",
            "int",
            "E",
            "yes",
            "최근 rate_window_sec 안 상호작용 수",
        ),
        (
            "mean_gap_recent_sec",
            "time",
            "float",
            "E",
            "yes",
            "최근 gap_window 개 간격 평균",
        ),
        (
            "recent_incorrect_combinations",
            "combination",
            "int",
            "E",
            "yes",
            "창 안 조합 실패 수",
        ),
        (
            "since_last_npc_utterance_sec",
            "npc",
            "float",
            "N",
            "needs_new_log",
            "마지막 NPC 발화 뒤 경과",
        ),
        (
            "npc_max_hint_level_on_target",
            "npc",
            "int",
            "N",
            "needs_new_log",
            "대상 퍼즐에 NPC 가 준 최고 수준",
        ),
        (
            "player_requested_help",
            "request",
            "bool",
            "R",
            "yes",
            "플레이어가 NPC 에게 도움 요청",
        ),
        (
            "inspected_objects_since_progress",
            "exploration",
            "int",
            "N",
            "needs_new_log",
            "진전 뒤 조사한 물건 수 (inspect 미구현)",
        ),
        (
            "zone_dwell_sec",
            "exploration",
            "float",
            "N",
            "needs_new_log",
            "현재 zone 체류 (navigate 미구현)",
        ),
        ("pack_puzzle_count", "structure", "int", "P", "yes", "팩 퍼즐 수"),
        ("pack_clue_count", "structure", "int", "P", "yes", "팩 단서 수"),
    ]
)
FEATURE_NAMES: tuple[str, ...] = tuple(spec.name for spec in FEATURE_SPECS)

DecisionPhase = Literal["live", "post_event", "tick"]
TargetSource = Literal["focus", "last_attempt", "none"]
TargetObservation = Literal["observed_focus", "last_attempt", "none"]
TARGET_OBSERVATION: dict[str, str] = {
    "focus": "observed_focus",
    "last_attempt": "last_attempt",
    "none": "none",
}


class FeatureMeta(ContractModel):
    """학습 입력이 아니다. 묶어 나누기(group split)·추적에만 쓴다."""

    request_id: str
    play_session_id: str
    case_id: str
    pack_id: str
    decision_at: AwareDatetime
    phase: DecisionPhase
    target_source: TargetSource
    # ── 정책 메타데이터 (P3-B 추가) — 학습 열(model_row)에는 나가지 않는다 ──
    # 정책이 퍼즐별 상한·완료 퍼즐 금지를 적용할 때만 읽는다.
    target_puzzle_id: str | None = None
    # observed_focus  FE 가 지금 그 퍼즐을 보고 있다고 알려 왔다 (온라인에서만)
    # last_attempt    마지막으로 채점한 퍼즐일 뿐이다 — 지금 그 퍼즐을 보고 있다는 뜻이 아니다
    # none            대상을 정할 수 없다
    target_observation: TargetObservation = "none"

    @model_validator(mode="after")
    def _target_consistent(self) -> "FeatureMeta":
        expected = {
            "focus": "observed_focus",
            "last_attempt": "last_attempt",
            "none": "none",
        }
        if self.target_observation != expected[self.target_source]:
            raise ValueError("target_observation must follow target_source")
        if (self.target_puzzle_id is None) != (self.target_observation == "none"):
            raise ValueError("target_puzzle_id is required iff a target was observed")
        return self


class FeatureVector(ContractModel):
    feature_set_version: Literal["fs-0.1"] = FEATURE_SET_VERSION
    meta: FeatureMeta
    values: dict[str, float | None]
    status: dict[str, FeatureStatus]

    @model_validator(mode="after")
    def _consistent(self) -> "FeatureVector":
        if tuple(self.values) != FEATURE_NAMES or tuple(self.status) != FEATURE_NAMES:
            raise ValueError("values/status must list exactly FEATURE_NAMES in order")
        for name in FEATURE_NAMES:
            if (self.status[name] == "observed") != (self.values[name] is not None):
                raise ValueError(
                    f"{name}: value must be present iff status is observed"
                )
        return self

    def known(self, name: str) -> bool:
        return self.status[name] == "observed"

    def model_row(self) -> dict[str, float | int | None]:
        """학습 행 — 특성 값과 <이름>__known 만. ID·meta 는 들어가지 않는다."""

        row: dict[str, float | int | None] = {}
        for name in FEATURE_NAMES:
            row[name] = self.values[name]
            row[f"{name}__known"] = int(self.known(name))
        return row


class FeatureRowSchema(ContractModel):
    """model_row 의 열 목록 — 버전이 같으면 사건이 달라도 같다."""

    feature_set_version: str = FEATURE_SET_VERSION
    columns: list[str] = Field(
        default_factory=lambda: [c for n in FEATURE_NAMES for c in (n, f"{n}__known")]
    )
