"""오프라인 재생 — interaction_events 행 → 판단 시점별 NpcContext.

[입력] backend interaction_events 테이블의 행(dict) — 이 함수는 DB 에 접속하지 않는다.
       행을 어떻게 내보낼지(반출 범위·동의)는 팀 합의 사항이다.

[판단 시점]
  post_event  이벤트 i 를 처리한 직후 (t = created_at_i).  상태 = 이벤트 i 의 response_json.state
  tick        다음 이벤트 전까지 decision_interval_sec 마다. 상태 = 여전히 이벤트 i 직후 상태
              (그 사이에 상태를 바꾸는 일이 없었으므로). 마지막 이벤트 뒤에는 observation_end 까지.
  두 시점 모두 이벤트 0..i 만 본다. i+1 부터는 labels.py 만 본다.

[로그에 없는 것]
  zone_id · 오브젝트 target_id → null. puzzle_id(로그의 target_id)는 resolved_puzzle_id 로.
  팩에서 puzzle → 오브젝트를 거꾸로 짚을 수 있으면 inferred_object_id 에 **추정값**으로만 둔다.

[답 원문]
  payload_json.answer 는 여기서 지문을 만들 때 한 번 읽고 버린다. 지문은 오답일 때만,
  AnswerFingerprinter(비밀 키)를 받았을 때만 만든다. 행 모델의 repr·오류 메시지에 값이 나오지 않는다.
"""

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from companion_npc.adapters.errors import error_locations
from companion_npc.contracts.common import PlaySessionStateSnapshot
from companion_npc.contracts.npc_context import (
    InteractionRecord,
    NpcContext,
    StateChangeRef,
    Timing,
    Trigger,
)
from companion_npc.contracts.scenario_pack import ScenarioPack
from companion_npc.features.config import FeatureConfig
from companion_npc.features.extract import extract_features
from companion_npc.features.fingerprint import AnswerFingerprinter
from companion_npc.features.schema import FeatureVector

# backend api/v1/interactions.py _to_external_response 와 같은 표
RESULT_TO_EXTERNAL = {
    "correct": "correct",
    "incorrect": "incorrect",
    "combined": "correct",
    "incorrect_combination": "incorrect",
    "already_completed": "already_completed",
}
ACTION_TO_EXTERNAL = {"submit_answer": "input", "combine_clues": "combine_clues"}
# backend InputInteractionRequest 는 target_type="object", CombineClues 는 "clue" 로 고정이다
TARGET_TYPE = {"submit_answer": "object", "combine_clues": "clue"}
# state_changes 한 항목에서 대상 ID 가 들어 있는 key (옛 형식은 target_id)
_CHANGE_TARGET_KEYS = ("puzzle_id", "clue_id", "zone_id", "flag", "target_id")


class ReplayInputError(ValueError):
    """행이 interaction_events 형식이 아니다. 메시지에 값은 담지 않는다."""


class LoggedInteraction(BaseModel):
    """backend models/interaction_event.py 의 열 그대로."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    play_session_id: str
    client_event_id: str
    client_timestamp: datetime | None = None
    interaction_type: Literal["submit_answer", "combine_clues"]
    target_id: str | None = None
    payload_json: dict[str, Any] = Field(repr=False)
    result_type: Literal[
        "correct", "incorrect", "combined", "incorrect_combination", "already_completed"
    ]
    response_json: dict[str, Any] = Field(repr=False)
    created_at: datetime


@dataclass(frozen=True)
class DecisionPoint:
    phase: Literal["post_event", "tick"]
    event_index: int  # 이 시점까지 본 마지막 이벤트 (timeline 의 순번)
    context: NpcContext


@dataclass(frozen=True)
class ReplayResult:
    play_session_id: str
    timeline: tuple[InteractionRecord, ...]  # 라벨 계산용 전체 기록 (지문만, 원문 없음)
    decision_points: tuple[DecisionPoint, ...]
    skipped_without_state: (
        int  # response_json 에 state 가 없어 판단 시점을 못 만든 이벤트 수
    )
    duplicates_dropped: int


def _utc(value: datetime) -> datetime:
    # backend 는 UTC 를 timezone 없이 저장한다 (DATETIME). 없으면 UTC 로 본다.
    return value.replace(tzinfo=timezone.utc) if value.utcoffset() is None else value


def _request_id(*parts: object) -> str:
    raw = "|".join(str(p) for p in parts)
    return "rp-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _state_changes(raw: list[Any]) -> list[StateChangeRef]:
    changes = []
    for item in raw:
        target = next(
            (item[k] for k in _CHANGE_TARGET_KEYS if item.get(k) is not None), None
        )
        changes.append(StateChangeRef(type=item["type"], target_id=target))
    return changes


def _to_record(
    row: LoggedInteraction,
    pack: ScenarioPack,
    fingerprinter: AnswerFingerprinter | None,
) -> InteractionRecord:
    puzzle_id = row.target_id if row.interaction_type == "submit_answer" else None
    hosts = [
        o.object_id for o in pack.objects if puzzle_id and o.puzzle_id == puzzle_id
    ]
    fingerprint = None
    if fingerprinter is not None and row.result_type == "incorrect":
        answer = row.payload_json.get("answer")
        if isinstance(answer, str):
            fingerprint = fingerprinter.fingerprint(row.play_session_id, answer)
    response = row.response_json
    return InteractionRecord(
        source="event_log",
        client_event_id=row.client_event_id,
        interaction_id=row.id,
        occurred_at=_utc(row.created_at),
        zone_id=None,
        action=ACTION_TO_EXTERNAL[row.interaction_type],
        target_type=TARGET_TYPE[row.interaction_type],
        target_id=None,
        resolved_puzzle_id=puzzle_id,
        inferred_object_id=hosts[0] if len(hosts) == 1 else None,
        result_type=RESULT_TO_EXTERNAL[row.result_type],
        attempt_count=response.get("attempt_count"),
        state_changes=_state_changes(response.get("state_changes", [])),
        answer_fingerprint=fingerprint,
    )


def replay_session(
    rows: list[dict],
    *,
    play_session_id: str,
    case_id: str,
    pack: ScenarioPack,
    observation_end: datetime,
    config: FeatureConfig | None = None,
    fingerprinter: AnswerFingerprinter | None = None,
    session_started_at: datetime | None = None,
) -> ReplayResult:
    """한 PlaySession 의 행을 재생한다. observation_end = 이 로그를 잘라 낸 시각."""

    config = config or FeatureConfig()
    if observation_end.utcoffset() is None:
        raise ReplayInputError("observation_end must include a timezone offset")

    parsed: list[
        tuple[LoggedInteraction, InteractionRecord, PlaySessionStateSnapshot | None]
    ] = []
    for index, raw in enumerate(rows):
        try:
            row = LoggedInteraction.model_validate(raw)
            if row.play_session_id != play_session_id:
                raise ReplayInputError(f"row {index}: play_session_id mismatch")
            record = _to_record(row, pack, fingerprinter)
            raw_state = row.response_json.get("state")
            state = (
                PlaySessionStateSnapshot.model_validate(raw_state)
                if raw_state
                else None
            )
        except ValidationError as error:
            raise ReplayInputError(
                f"row {index}: " + "; ".join(error_locations(error))
            ) from None
        except (KeyError, TypeError) as error:
            raise ReplayInputError(
                f"row {index}: malformed {type(error).__name__}"
            ) from None
        if record.occurred_at > observation_end:
            raise ReplayInputError(f"row {index}: created_at is after observation_end")
        parsed.append((row, record, state))

    # 같은 client_event_id 는 한 번만 (backend 는 unique 제약으로 막지만 내보내기에서 겹칠 수 있다)
    parsed.sort(
        key=lambda item: item[1].occurred_at
    )  # 안정 정렬 — 같은 시각은 원래 순서
    seen: set[str] = set()
    unique = []
    for item in parsed:
        if item[1].client_event_id in seen:
            continue
        seen.add(item[1].client_event_id)
        unique.append(item)
    duplicates = len(parsed) - len(unique)

    timeline = tuple(record for _, record, _ in unique)
    started = (
        _utc(session_started_at)
        if session_started_at
        else (timeline[0].occurred_at if timeline else observation_end)
    )
    interval = timedelta(seconds=config.decision_interval_sec)
    points: list[DecisionPoint] = []
    skipped = 0

    def context_at(
        t: datetime, i: int, state: PlaySessionStateSnapshot, trigger: Trigger
    ) -> NpcContext:
        window = timeline[max(0, i + 1 - config.recent_window) : i + 1]
        return NpcContext(
            request_id=_request_id(play_session_id, trigger.type, i, t.isoformat()),
            requested_at=t,
            play_session_id=play_session_id,
            case_id=case_id,
            pack_id=pack.pack_id,
            trigger=trigger,
            state=state,
            recent_interactions=list(window),
            # 오프라인에서는 일시정지를 알 수 없다 — 경과 시간으로 채우고 특성에는 쓰지 않는다
            timing=Timing(session_active_sec=max(0.0, (t - started).total_seconds())),
        )

    for i, (_, record, state) in enumerate(unique):
        if state is None:
            skipped += 1
            continue
        t = record.occurred_at
        points.append(
            DecisionPoint(
                "post_event",
                i,
                context_at(
                    t,
                    i,
                    state,
                    Trigger(
                        type="interaction_result",
                        source="backend",
                        event_ref=record.client_event_id,
                    ),
                ),
            )
        )
        next_t = timeline[i + 1].occurred_at if i + 1 < len(timeline) else None
        tick = t + interval
        while (tick < next_t) if next_t else (tick <= observation_end):
            points.append(
                DecisionPoint(
                    "tick",
                    i,
                    context_at(
                        tick, i, state, Trigger(type="idle_tick", source="timer")
                    ),
                )
            )
            tick += interval

    return ReplayResult(
        play_session_id=play_session_id,
        timeline=timeline,
        decision_points=tuple(points),
        skipped_without_state=skipped,
        duplicates_dropped=duplicates,
    )


def replay_features(
    result: ReplayResult, pack: ScenarioPack, config: FeatureConfig | None = None
) -> list[FeatureVector]:
    """재생 결과의 모든 판단 시점에 **같은** extract_features 를 적용한다."""

    return [
        extract_features(point.context, pack, config, phase=point.phase)
        for point in result.decision_points
    ]
