"""라벨.

[no_progress_within_<N>s — 대리(proxy) 라벨]
  판단 시점 이후 N 초 안에 진전(puzzle_completed · clue_acquired)이 **없었으면 1**.
  "막혔다"를 직접 잰 것이 아니다. 생각 중이거나, 쉬거나, 탐색 중이어도 1 이 된다.
  미래 이벤트는 여기서만 본다 — 특성(extract.py)은 보지 않는다.
  · 미래 = 그 판단 시점이 본 마지막 이벤트(event_index) **다음 순번부터**.
    같은 시각에 찍힌 다음 이벤트도 특성이 아니라 라벨 쪽에 들어간다.
  · 관측 구간 [t, t+N] 이 observation_end 를 넘으면 확정하지 않는다(censored).
    단, 그 전에 진전이 이미 보였으면 0 으로 확정한다.

[needs_help — 실제 도움 필요성, 계약만]
  사람의 판단(플레이테스트 관찰·리플레이 검토·본인 응답)으로만 만든다. 수집 도구는 아직 없다.
"""

from datetime import datetime, timedelta
from typing import Literal

from pydantic import Field, model_validator

from companion_npc.contracts.common import AwareDatetime, ContractModel
from companion_npc.features.extract import PROGRESS_CHANGES
from companion_npc.features.replay import DecisionPoint, ReplayResult


class ProxyLabel(ContractModel):
    name: str
    value: Literal[0, 1] | None
    status: Literal["labeled", "censored"]
    horizon_sec: float
    is_proxy: Literal[True] = True

    @model_validator(mode="after")
    def _consistent(self) -> "ProxyLabel":
        if (self.status == "labeled") != (self.value is not None):
            raise ValueError("value must be present iff status is labeled")
        return self


def proxy_label_name(horizon_sec: float) -> str:
    seconds = int(horizon_sec) if float(horizon_sec).is_integer() else horizon_sec
    return f"no_progress_within_{seconds}s"


def label_no_progress(
    point: DecisionPoint,
    result: ReplayResult,
    observation_end: datetime,
    horizon_sec: float,
) -> ProxyLabel:
    t = point.context.requested_at
    window_end = t + timedelta(seconds=horizon_sec)
    future = [
        r
        for r in result.timeline[point.event_index + 1 :]
        if r.occurred_at <= window_end
    ]
    name = proxy_label_name(horizon_sec)
    if any(c.type in PROGRESS_CHANGES for r in future for c in r.state_changes):
        return ProxyLabel(name=name, value=0, status="labeled", horizon_sec=horizon_sec)
    if observation_end >= window_end:
        return ProxyLabel(name=name, value=1, status="labeled", horizon_sec=horizon_sec)
    return ProxyLabel(name=name, value=None, status="censored", horizon_sec=horizon_sec)


def label_replay(
    result: ReplayResult, observation_end: datetime, horizon_sec: float
) -> list[ProxyLabel]:
    return [
        label_no_progress(point, result, observation_end, horizon_sec)
        for point in result.decision_points
    ]


# ── needs_help (계약만) ─────────────────────────────────────────
class HelpAnnotation(ContractModel):
    """사람이 판단한 「이 시점에 도움이 필요했나」. 대리 라벨을 검증하는 기준이 된다."""

    contract: Literal["needs_help_annotation"] = "needs_help_annotation"
    contract_version: Literal["0.1"] = "0.1"
    annotation_id: str = Field(min_length=1, max_length=64)
    play_session_id: str = Field(min_length=1, max_length=36)
    # 판단 시점과 맞출 때 쓰는 시각. 맞추기 허용 오차는 실험 설정(제안 15초)
    decision_at: AwareDatetime
    needs_help: bool | None  # None = 판단 보류
    confidence: Literal["low", "medium", "high"] | None = None
    method: Literal[
        "playtest_observation", "think_aloud", "replay_review", "self_report"
    ]
    annotator_role: Literal["player", "observer", "reviewer"]
    annotated_at: AwareDatetime
    # 자유 서술. 플레이어가 친 답이나 정답을 적지 않는다(수집 도구가 누설 검사를 한다).
    note: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _consistent(self) -> "HelpAnnotation":
        if self.needs_help is None and self.confidence is not None:
            raise ValueError("confidence only when needs_help is decided")
        if self.annotated_at < self.decision_at:
            raise ValueError("annotated_at must not precede decision_at")
        return self
