"""한 세션을 합성한다.

[한 세션의 흐름]
  답으로 풀 수 있는 퍼즐을 팩 순서대로 진행한다. 채점 한 번 앞에는 구간들이 차례로 붙는다.
      away(가끔) → exploring(유형별 확률) → stuck(연속 오답이 많을 때) → working(생각·입력)
  working 이 끝나는 순간 채점 이벤트가 하나 생긴다(interaction_events 한 행).

[정답을 모른다]
  시뮬레이터는 server.json 을 읽지 않는다. 맞았는지는 확률로 정하고, 답 칸에는 자리표시만 넣는다.
      정답 = "<SYNTH_CORRECT>"   오답 = "<SYNTH_WRONG_k>" (같은 k = 같은 오답 반복)
  단서 조합은 짝을 모르므로 시도하면 늘 incorrect_combination 이다.

[결과]
  completed           도달 가능한 퍼즐을 모두 풀었다
  abandoned           이탈 (dropout · max_session). 로그는 그냥 끊긴다
  observation_cutoff  로그를 내보낸 시각이 자연 종료보다 앞서 뒤가 잘렸다
  → 무엇이 일어났는지는 session_truth 에만 있다. interaction_events 에는 없다.

[재현성]
  세션마다 sha256(seed|case|유형|순번) 으로 난수 흐름을 따로 만든다. 같은 시드면 같은 결과,
  세션 수를 늘려도 앞 세션은 바뀌지 않는다.
"""

import hashlib
import math
import random
import uuid
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal

from pydantic import Field

from companion_npc.contracts.common import AwareDatetime, ContractModel
from companion_npc.simulation.config import (
    ArchetypeName,
    ArchetypeParams,
    LogNormal,
    SimulationConfig,
)
from companion_npc.simulation.runtime_effect import apply_correct
from companion_npc.simulation.scenario import SimScenario

CORRECT_TOKEN = "<SYNTH_CORRECT>"
LatentMode = Literal["working", "exploring", "stuck", "away"]
Outcome = Literal["completed", "abandoned", "observation_cutoff"]


class LatentSegment(ContractModel):
    play_session_id: str
    start: AwareDatetime
    end: AwareDatetime
    mode: LatentMode
    puzzle_id: str | None = None


class SessionTruth(ContractModel):
    """합성 정답 — 모델 입력이 아니다. 분석·라벨에만 쓴다."""

    synthetic: Literal[True] = True
    play_session_id: str
    case_id: str
    archetype: ArchetypeName
    session_index: int
    started_at: AwareDatetime
    ended_at: AwareDatetime  # 자연 종료 시각 (관측 종료보다 늦을 수 있다)
    observation_end: AwareDatetime  # 로그를 내보낸 시각 — replay 에 넘기는 값
    outcome: Outcome
    natural_outcome: Literal["completed", "abandoned"]
    abandon_reason: Literal["dropout", "max_session"] | None = None
    reachable_completed: bool  # observation_end 시점 기준
    scenario_completed: bool
    answerable_puzzle_ids: list[str]
    reachable_puzzle_ids: list[str]
    unreachable_puzzle_ids: list[str]
    events_generated: int = Field(ge=0)
    events_kept: int = Field(ge=0)


class ExplorationEvent(ContractModel):
    """합성 inspect·navigate. 운영 이벤트가 아니다 — 별도 파일에만 쓴다."""

    synthetic: Literal[True] = True
    operational: Literal[False] = False
    play_session_id: str
    at: AwareDatetime
    action: Literal["inspect", "navigate"]
    object_id: str | None = None
    zone_id: str | None = None


@dataclass(frozen=True)
class SessionOutput:
    rows: list[dict[str, Any]]  # interaction_events 형식 — replay 에 들어가는 유일한 것
    truth: SessionTruth
    segments: list[LatentSegment]
    exploration: list[ExplorationEvent]


def stream_seed(seed: int, case_id: str, archetype: str, index: int) -> int:
    digest = hashlib.sha256(
        f"{seed}|{case_id}|{archetype}|{index}".encode()
    ).hexdigest()
    return int(digest[:16], 16)


def _db_time(t: datetime) -> str:
    # backend 는 UTC 를 timezone 없이 저장한다
    return t.replace(tzinfo=None).isoformat(timespec="microseconds")


class _Session:
    def __init__(
        self,
        scenario: SimScenario,
        config: SimulationConfig,
        archetype: ArchetypeName,
        index: int,
    ) -> None:
        self.scenario = scenario
        self.config = config
        self.archetype = archetype
        self.params: ArchetypeParams = config.archetypes[archetype]
        self.index = index
        self.case_id = scenario.pack.case_id
        self.rng = random.Random(
            stream_seed(config.seed, self.case_id, archetype, index)
        )
        self.session_id = self._uuid()
        self.started = config.base_time + timedelta(
            seconds=self.rng.uniform(0, config.start_spread_hours * 3600)
        )
        low, high = config.export_after_min
        self.export_at = self.started + timedelta(minutes=self.rng.uniform(low, high))
        self.deadline = self.started + timedelta(minutes=config.max_session_min)
        self.t = self.started
        self.state: dict[str, Any] = {
            "current_zone_id": scenario.pack.entry_zone_id,
            "completed_puzzle_ids": [],
            "acquired_clue_ids": [],
            "hint_levels": {},
            "attempt_counts": {},
            "flags": {},
        }
        self.rows: list[dict[str, Any]] = []
        self.segments: list[LatentSegment] = []
        self.exploration: list[ExplorationEvent] = []
        self.visible_objects = [o for o in scenario.pack.objects if o.initially_visible]
        self.nav_targets = [
            n.target_zone_id for z in scenario.pack.zones for n in z.navigation
        ]

    # ── 난수 ────────────────────────────────────────────────
    def _uuid(self) -> str:
        return str(uuid.UUID(int=self.rng.getrandbits(128), version=4))

    def _duration(self, dist: LogNormal) -> float:
        return max(1.0, self.rng.lognormvariate(math.log(dist.median_sec), dist.sigma))

    # ── 구간 · 이벤트 ────────────────────────────────────────
    def _segment(self, mode: LatentMode, seconds: float, puzzle_id: str | None) -> None:
        start, end = self.t, self.t + timedelta(seconds=seconds)
        self.segments.append(
            LatentSegment(
                play_session_id=self.session_id,
                start=start,
                end=end,
                mode=mode,
                puzzle_id=puzzle_id,
            )
        )
        if mode == "exploring" and self.config.emit_exploration_events:
            self._explore_actions(start, seconds)
        self.t = end

    def _explore_actions(self, start: datetime, seconds: float) -> None:
        expected = self.params.exploration_actions_per_min * seconds / 60
        count = int(expected) + (self.rng.random() < expected - int(expected))
        offsets = sorted(self.rng.uniform(0, seconds) for _ in range(count))
        for offset in offsets:
            at = start + timedelta(seconds=offset)
            if self.nav_targets and self.rng.random() < 0.3:
                zone = self.rng.choice(self.nav_targets)
                self.exploration.append(
                    ExplorationEvent(
                        play_session_id=self.session_id,
                        at=at,
                        action="navigate",
                        zone_id=zone,
                    )
                )
            elif self.visible_objects:
                obj = self.rng.choice(self.visible_objects)
                self.exploration.append(
                    ExplorationEvent(
                        play_session_id=self.session_id,
                        at=at,
                        action="inspect",
                        object_id=obj.object_id,
                        zone_id=obj.zone_id,
                    )
                )

    def _row(
        self,
        interaction_type: str,
        target_id: str | None,
        payload: dict[str, Any],
        result_type: str,
        attempt_count: int | None,
        changes: list[dict[str, Any]],
    ) -> None:
        stamp = _db_time(self.t)
        self.rows.append(
            {
                "id": self._uuid(),
                "play_session_id": self.session_id,
                "client_event_id": self._uuid(),
                "client_timestamp": stamp,
                "interaction_type": interaction_type,
                "target_id": target_id,
                "payload_json": payload,
                "result_type": result_type,
                # backend InteractionResult.model_dump 와 같은 모양
                "response_json": {
                    "result_type": result_type,
                    "state": deepcopy(self.state),
                    "state_changes": changes,
                    "message": None,
                    "attempt_count": attempt_count,
                    "ui_actions": [],
                },
                "created_at": stamp,
            }
        )

    def _submit(self, puzzle_id: str, correct: bool, token: str) -> None:
        counts = self.state["attempt_counts"]
        counts[puzzle_id] = counts.get(puzzle_id, 0) + 1
        changes: list[dict[str, Any]] = []
        if correct:
            self.state, changes = apply_correct(
                self.state, self.scenario.puzzles[puzzle_id]
            )
        self._row(
            "submit_answer",
            puzzle_id,
            {"answer": token},
            "correct" if correct else "incorrect",
            self.state["attempt_counts"][puzzle_id],
            changes,
        )

    # ── 진행 ────────────────────────────────────────────────
    def run(self) -> SessionOutput:
        p = self.params
        natural: Literal["completed", "abandoned"] = "completed"
        reason: Literal["dropout", "max_session"] | None = None
        for pid in self.scenario.answerable:
            if pid in self.state["completed_puzzle_ids"]:
                continue  # 앞 퍼즐의 효과로 이미 완료
            fails = consecutive = 0
            insight = False
            wrong_tokens: list[str] = []
            solved = False
            while not solved:
                if self.t >= self.deadline:
                    natural, reason = "abandoned", "max_session"
                    break
                if self.rng.random() < self.config.away.prob_per_gap:
                    self._segment(
                        "away", self._duration(self.config.away.duration), pid
                    )
                if self.rng.random() < p.explore_prob:
                    self._segment("exploring", self._duration(p.explore), pid)
                if (
                    consecutive >= p.stuck_after_fails
                    and self.rng.random() < p.stuck_prob
                ):
                    self._segment("stuck", self._duration(p.stuck), pid)
                clues = self.state["acquired_clue_ids"]
                if (
                    len(clues) >= 2
                    and self.rng.random() < self.config.combine_attempt_prob
                ):
                    self._segment("working", self._duration(p.think), pid)
                    pair = sorted(self.rng.sample(clues, 2))
                    self._row(
                        "combine_clues",
                        None,
                        {"clue_ids": pair},
                        "incorrect_combination",
                        None,
                        [],
                    )
                self._segment("working", self._duration(p.think), pid)

                if p.insight_hazard is not None:
                    chance = p.p_after_insight if insight else p.p_correct_initial
                else:
                    chance = min(
                        p.p_correct_max, p.p_correct_initial + p.p_correct_step * fails
                    )
                if self.rng.random() < chance:
                    self._submit(pid, True, CORRECT_TOKEN)
                    solved = True
                    if self.rng.random() < self.config.already_completed_prob:
                        # 푼 퍼즐을 다시 입력 — backend 는 횟수를 늘리지 않고 저장값을 돌려준다
                        self._segment("working", self._duration(p.think), pid)
                        self._row(
                            "submit_answer",
                            pid,
                            {"answer": CORRECT_TOKEN},
                            "already_completed",
                            self.state["attempt_counts"].get(pid),
                            [],
                        )
                    continue

                if wrong_tokens and self.rng.random() < p.repeat_wrong_prob:
                    token = wrong_tokens[-1]
                else:
                    token = f"<SYNTH_WRONG_{len(set(wrong_tokens)) + 1}>"
                wrong_tokens.append(token)
                self._submit(pid, False, token)
                fails += 1
                consecutive += 1
                if p.insight_hazard is not None and not insight:
                    insight = self.rng.random() < p.insight_hazard
                if self.rng.random() < p.dropout_per_failed_attempt:
                    if p.dropout_after_stuck:
                        self._segment("stuck", self._duration(p.stuck), pid)
                    natural, reason = "abandoned", "dropout"
                    break
            if natural == "abandoned":
                break
        if natural == "completed":
            self._segment("working", self.config.epilogue_sec, None)
        return self._finish(natural, reason)

    def _finish(self, natural, reason) -> SessionOutput:
        ended = self.t
        events_generated = len(self.rows)
        outcome: Outcome = natural
        rows, segments, exploration = self.rows, self.segments, self.exploration
        if self.export_at < ended:
            outcome = "observation_cutoff"
            cut = _db_time(self.export_at)
            rows = [r for r in rows if r["created_at"] <= cut]
            segments = [
                s.model_copy(update={"end": min(s.end, self.export_at)})
                for s in segments
                if s.start < self.export_at
            ]
            exploration = [e for e in exploration if e.at <= self.export_at]
        last_state = (
            rows[-1]["response_json"]["state"]
            if rows
            else self.state | {"completed_puzzle_ids": []}
        )
        done = set(last_state["completed_puzzle_ids"])
        scenario = self.scenario
        truth = SessionTruth(
            play_session_id=self.session_id,
            case_id=self.case_id,
            archetype=self.archetype,
            session_index=self.index,
            started_at=self.started,
            ended_at=ended,
            observation_end=self.export_at,
            outcome=outcome,
            natural_outcome=natural,
            abandon_reason=reason,
            reachable_completed=scenario.reachable <= done,
            scenario_completed=set(scenario.puzzles) <= done,
            answerable_puzzle_ids=list(scenario.answerable),
            reachable_puzzle_ids=sorted(scenario.reachable),
            unreachable_puzzle_ids=list(scenario.unreachable),
            events_generated=events_generated,
            events_kept=len(rows),
        )
        return SessionOutput(
            rows=rows, truth=truth, segments=segments, exploration=exploration
        )


def simulate_session(
    scenario: SimScenario,
    config: SimulationConfig,
    archetype: ArchetypeName,
    index: int,
) -> SessionOutput:
    return _Session(scenario, config, archetype, index).run()
