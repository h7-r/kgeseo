"""공통 특성 추출 — 온라인·오프라인이 함께 쓰는 단 하나의 함수.

[판단 시점까지만 본다]
  context.requested_at 보다 뒤의 관측이 들어 있으면 계산하지 않고 오류를 낸다.
  미래 정보는 labels.py 에서 라벨을 만들 때만 쓴다.

[쓰지 않는 것]
  · InteractionRecord.inferred_object_id (추정값) · source (출처 표시)
    → 같은 사건을 live 로 받든 event_log 로 받든 같은 특성이 나와야 한다.
  · zone_id — 로그에는 없으므로 특성이 기대지 않는다.
  · case_id · puzzle_id 같은 ID 값 — 대상 퍼즐을 고를 때만 쓰고 열이 되지 않는다.
"""

from collections import Counter

from companion_npc.contracts.npc_context import InteractionRecord, NpcContext
from companion_npc.contracts.scenario_pack import ScenarioPack
from companion_npc.features.config import FeatureConfig
from companion_npc.features.schema import (
    FEATURE_NAMES,
    TARGET_OBSERVATION,
    DecisionPhase,
    FeatureMeta,
    FeatureStatus,
    FeatureVector,
    TargetSource,
)

PROGRESS_CHANGES = frozenset({"puzzle_completed", "clue_acquired"})


class FeatureInputError(ValueError):
    pass


class FutureObservationError(FeatureInputError):
    """판단 시점 뒤의 관측이 들어왔다 — 누수다."""


def puzzle_of(record: InteractionRecord, pack: ScenarioPack) -> str | None:
    """이 기록이 채점한 퍼즐. 관측값(resolved_puzzle_id · target_id)으로만 정한다."""

    if record.action != "input":
        return None
    if record.resolved_puzzle_id is not None:
        return record.resolved_puzzle_id
    if record.target_id is not None:
        obj = next((o for o in pack.objects if o.object_id == record.target_id), None)
        return obj.puzzle_id if obj else None
    return None


def extract_features(
    context: NpcContext,
    pack: ScenarioPack,
    config: FeatureConfig | None = None,
    *,
    phase: DecisionPhase = "live",
) -> FeatureVector:
    config = config or FeatureConfig()
    if context.case_id != pack.case_id or context.pack_id != pack.pack_id:
        raise FeatureInputError("context case_id/pack_id does not match the pack")
    t = context.requested_at
    if any(r.occurred_at > t for r in context.recent_interactions):
        raise FutureObservationError(
            "recent_interactions contain events after requested_at"
        )
    if any(h.spoken_at > t for h in context.npc_history):
        raise FutureObservationError(
            "npc_history contains utterances after requested_at"
        )

    state = context.state
    window = list(context.recent_interactions)[-config.recent_window :]
    pack_puzzles = {p.puzzle_id: p for p in pack.puzzles}

    # ── 대상 퍼즐 ────────────────────────────────────────────
    target: str | None = None
    target_source: TargetSource = "none"
    focus = context.focus.puzzle_id if context.focus else None
    if focus in pack_puzzles:
        target, target_source = focus, "focus"
    else:
        for record in reversed(window):
            pid = puzzle_of(record, pack)
            if pid in pack_puzzles:
                target, target_source = pid, "last_attempt"
                break
    on_target = [r for r in window if target and puzzle_of(r, pack) == target]

    values: dict[str, float | None] = {}
    status: dict[str, FeatureStatus] = {}

    def put(
        name: str, value: float | bool | None, why: FeatureStatus = "observed"
    ) -> None:
        if value is None:
            if why == "observed":
                raise FeatureInputError(f"{name}: missing value needs a reason")
            values[name], status[name] = None, why
        else:
            values[name], status[name] = float(value), "observed"

    def put_target(name: str, compute) -> None:
        if target is None:
            put(name, None, "not_applicable")
        else:
            put(name, compute())

    # ── 진행 ────────────────────────────────────────────────
    completed = set(state.completed_puzzle_ids)
    acquired = set(state.acquired_clue_ids)
    clue_ids = {c.clue_id for c in pack.clues}
    put(
        "progress_puzzle_ratio",
        len(completed & set(pack_puzzles)) / len(pack_puzzles)
        if pack_puzzles
        else None,
        "not_applicable",
    )
    put(
        "progress_clue_ratio",
        len(acquired & clue_ids) / len(clue_ids) if clue_ids else None,
        "not_applicable",
    )
    put("acquired_clue_count", len(acquired))
    put("flags_true_count", sum(v is True for v in state.flags.values()))

    # ── 대상 퍼즐 ────────────────────────────────────────────
    put("target_known", target is not None)
    put_target("target_from_focus", lambda: target_source == "focus")
    put_target("target_solved", lambda: target in completed)
    put_target("target_attempt_count", lambda: state.attempt_counts.get(target, 0))

    def consecutive_incorrect() -> int:
        count = 0
        for record in reversed(on_target):
            if record.result_type != "incorrect":
                break
            count += 1
        return count

    put_target("target_consecutive_incorrect", consecutive_incorrect)

    wrong = [r for r in on_target if r.result_type == "incorrect"]
    if target is None:
        put("target_repeat_wrong_max", None, "not_applicable")
        put("target_distinct_wrong", None, "not_applicable")
    elif any(r.answer_fingerprint is None for r in wrong):
        # 지문이 없는 오답이 하나라도 있으면 반복 여부를 알 수 없다 (승인된 경계 밖이거나 원천 없음)
        put("target_repeat_wrong_max", None, "unobservable")
        put("target_distinct_wrong", None, "unobservable")
    else:
        counts = Counter(r.answer_fingerprint for r in wrong)
        put("target_repeat_wrong_max", max(counts.values(), default=0))
        put("target_distinct_wrong", len(counts))

    if target is None:
        put("target_hint_level", None, "not_applicable")
    elif not config.hint_api_available:
        put("target_hint_level", None, "unobservable")
    else:
        put("target_hint_level", state.hint_levels.get(target, 0))
    put_target(
        "target_grants_clue_count", lambda: len(pack_puzzles[target].grants_clue_ids)
    )

    # ── 시간 ────────────────────────────────────────────────
    if window:
        put("since_last_interaction_sec", (t - window[-1].occurred_at).total_seconds())
    else:
        put("since_last_interaction_sec", None, "unobservable")
    progressed = [
        r for r in window if any(c.type in PROGRESS_CHANGES for c in r.state_changes)
    ]
    if progressed:
        put("since_last_progress_sec", (t - progressed[-1].occurred_at).total_seconds())
    else:
        # 창 안에 진전이 없다 — "한 번도 없었다"인지 "창 밖으로 밀렸다"인지 모른다
        put("since_last_progress_sec", None, "unobservable")
    put(
        "events_in_rate_window",
        sum(
            (t - r.occurred_at).total_seconds() <= config.rate_window_sec
            for r in window
        ),
    )
    recent = window[-(config.gap_window + 1) :]
    if len(recent) >= 2:
        gaps = [
            (b.occurred_at - a.occurred_at).total_seconds()
            for a, b in zip(recent, recent[1:])
        ]
        put("mean_gap_recent_sec", sum(gaps) / len(gaps))
    else:
        put("mean_gap_recent_sec", None, "unobservable")

    # ── 조합 ────────────────────────────────────────────────
    put(
        "recent_incorrect_combinations",
        sum(
            r.action == "combine_clues" and r.result_type == "incorrect" for r in window
        ),
    )

    # ── NPC ────────────────────────────────────────────────
    history = list(context.npc_history)
    if not config.npc_log_available:
        put("since_last_npc_utterance_sec", None, "unobservable")
        put("npc_max_hint_level_on_target", None, "unobservable")
    else:
        if history:
            last = max(h.spoken_at for h in history)
            put("since_last_npc_utterance_sec", (t - last).total_seconds())
        else:
            put("since_last_npc_utterance_sec", None, "not_applicable")
        put_target(
            "npc_max_hint_level_on_target",
            lambda: max(
                (h.npc_hint_level for h in history if h.puzzle_id == target), default=0
            ),
        )

    # ── 요청 · 탐색 · 구조 ─────────────────────────────────────
    put("player_requested_help", context.trigger.type == "player_request")
    # inspect · navigate 가 아직 501 이라 기록이 없다 (fs-0.1 에서는 늘 unobservable)
    put("inspected_objects_since_progress", None, "unobservable")
    put("zone_dwell_sec", None, "unobservable")
    put("pack_puzzle_count", len(pack_puzzles))
    put("pack_clue_count", len(clue_ids))

    return FeatureVector(
        meta=FeatureMeta(
            request_id=context.request_id,
            play_session_id=context.play_session_id,
            case_id=context.case_id,
            pack_id=context.pack_id,
            decision_at=t,
            phase=phase,
            target_source=target_source,
            target_puzzle_id=target,
            target_observation=TARGET_OBSERVATION[target_source],
        ),
        values={name: values[name] for name in FEATURE_NAMES},
        status={name: status[name] for name in FEATURE_NAMES},
    )
