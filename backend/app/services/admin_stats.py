"""관리자 API v0.2 2단계 — DB 없이 되는 집계 규칙(`docs/contracts/admin_api_v0.2_phase2.md`).

게임 데이터는 `beta_events` 한 줄 한 줄을 사람 단위로 묶어 센다. 퍼즐 ID · 스테이지 묶음은 나주 쪽
`naju01/src/dialogue/objectives.ts`(STAGE_OF · SERVER_JUDGED)를 그대로 옮겼다 — 그쪽이 바뀌면 여기도 맞춘다.
정답 값은 어디에도 두지 않는다.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Iterable

# 스테이지 묶음(objectives.ts STAGE_OF). 2 = 바위 아래 + 물굴(진행표의 2스테이지 기우제 · 물굴)
STAGE_OBJECTIVES: dict[int, tuple[str, ...]] = {
    1: ("P01", "P02", "P02-2", "S1_FIRE", "S1_SMOKE"),
    2: (
        "P03",
        "S2_BOTTLE",
        "P05",
        "S2_OFFER",
        "S2_STONES",
        "S2_ENTER",
        "C_JAR",
        "P07",
        "P08",
        "P09",
        "P10",
        "C_SOCKET",
    ),
    3: ("S3_GO", "P11", "P12", "P13", "P13-2", "S3_SCALE", "S3_KEY", "S3_RIFT"),
}
# 스테이지 끝 — 이 걸음을 마치면 그 스테이지를 「완료」로 본다(연기 화살표로 문 · 바위 홈 · 시공간 틈)
STAGE_END: dict[int, str] = {1: "S1_SMOKE", 2: "C_SOCKET", 3: "S3_RIFT"}
OBJECTIVE_STAGE: dict[str, int] = {
    objective: stage
    for stage, objectives in STAGE_OBJECTIVES.items()
    for objective in objectives
}
# 서버가 판정하는 퍼즐(objectives.ts SERVER_JUDGED). 나머지 P 는 화면 판정, S · C 는 판정 없는 걸음
SERVER_JUDGED: frozenset[str] = frozenset(
    {"P01", "P02", "P03", "P05", "P09", "P10", "P12", "P13"}
)
# 게임 진입 깔때기 — stage_reached 의 phase 순서(betaReport 와 같다)
FUNNEL_PHASES: tuple[str, ...] = (
    "character_open",
    "character_done",
    "headquarters",
    "naju_ready",
    "naju_controllable",
)
# puzzle_attempt 중 「틀렸다」로 세는 phase. sent_back(숨 다함)은 시도로만 센다
WRONG_PHASES: frozenset[str] = frozenset({"fail", "incorrect"})
OBJECTIVE_SEEN_PHASES: frozenset[str] = frozenset({"available", "focus", "complete"})


def judge_of(objective_id: str) -> str:
    if objective_id in SERVER_JUDGED:
        return "server"
    return "screen" if objective_id.startswith("P") else "step"


@dataclass
class GameEvent:
    """집계에 필요한 칸만 뽑은 beta_events 한 줄."""

    event_type: str
    phase: str | None
    objective_id: str | None
    person: str
    run_id: str | None
    at: datetime | None
    data: dict[str, Any] = field(default_factory=dict)


def guest_links(pairs: Iterable[tuple[str | None, str | None]]) -> dict[str, str]:
    """게스트 세션 → 회원 id 표. 서버는 로그인 뒤에도 쿠키의 guest_session_id 를 같이 적으므로,
    한 줄에 둘이 함께 있으면 그 게스트는 그 회원이다(로그인 전 기록을 같은 사람으로 묶는 근거)."""

    links: dict[str, str] = {}
    for app_user_id, guest_session_id in pairs:
        if app_user_id and guest_session_id:
            links.setdefault(guest_session_id, app_user_id)
    return links


def person_key(
    app_user_id: str | None,
    guest_session_id: str | None,
    tab_id: str | None,
    links: dict[str, str] | None = None,
) -> str:
    """사람 하나를 가리키는 키 — 회원 > 게스트 세션 > 탭. 셋 다 없으면 「모름」 하나로 묶는다.
    `links`(guest_links) 가 있으면 뒤에 회원이 된 게스트는 그 회원 키로 센다(세진 11/12 — 전환 중복 방지)."""

    if app_user_id:
        return f"u:{app_user_id}"
    if guest_session_id:
        linked = links.get(guest_session_id) if links else None
        return f"u:{linked}" if linked else f"g:{guest_session_id}"
    return f"t:{tab_id}" if tab_id else "t:?"


@dataclass
class GameAggregate:
    people: int
    funnel: list[tuple[str, int]]
    stages: list[tuple[int, int, int]]
    puzzles: list[dict[str, Any]]
    avg_completion_minutes: float | None
    completed_runs: int


def aggregate_game(events: Iterable[GameEvent]) -> GameAggregate:
    """사람 단위로 센다 — 같은 사람이 같은 목표를 여러 번 완료해도 한 번. 시도 · 힌트 요청은 건수 그대로."""

    people: set[str] = set()
    funnel: dict[str, set[str]] = defaultdict(set)
    seen: dict[str, set[str]] = defaultdict(set)  # objective → people who saw it
    completed: dict[str, set[str]] = defaultdict(set)
    attempts: dict[str, int] = defaultdict(int)
    wrong: dict[str, int] = defaultdict(int)
    hints: dict[str, int] = defaultdict(int)
    # run_id → (start, dawn)
    run_start: dict[str, datetime] = {}
    run_dawn: dict[str, datetime] = {}

    for event in events:
        people.add(event.person)
        kind, phase, objective = event.event_type, event.phase, event.objective_id
        if kind == "stage_reached" and phase in FUNNEL_PHASES:
            funnel[phase].add(event.person)
        elif kind == "objective_state" and objective:
            if phase in OBJECTIVE_SEEN_PHASES:
                seen[objective].add(event.person)
            if phase == "complete" and event.data.get("origin", "live") == "live":
                completed[objective].add(event.person)
        elif kind == "puzzle_attempt" and objective:
            attempts[objective] += 1
            if phase in WRONG_PHASES:
                wrong[objective] += 1
        elif kind == "help_event" and objective and phase == "request":
            hints[objective] += 1
        elif kind == "run_state" and event.run_id and event.at is not None:
            if phase in ("start", "resume"):
                run_start.setdefault(event.run_id, event.at)
            elif phase == "dawn":
                run_dawn.setdefault(event.run_id, event.at)

    stages: list[tuple[int, int, int]] = []
    for stage, objectives in STAGE_OBJECTIVES.items():
        entered: set[str] = set()
        for objective in objectives:
            entered |= seen[objective]
        stages.append((stage, len(entered), len(completed[STAGE_END[stage]])))

    puzzle_ids = sorted(
        {*OBJECTIVE_STAGE, *attempts, *wrong, *hints, *completed},
        key=lambda o: (OBJECTIVE_STAGE.get(o, 99), o),
    )
    puzzles = [
        {
            "objective_id": objective,
            "judge": judge_of(objective),
            "attempts": attempts[objective],
            "wrong": wrong[objective],
            "hint_requests": hints[objective],
            "completed_people": len(completed[objective]),
        }
        for objective in puzzle_ids
    ]

    durations = [
        (run_dawn[run] - start).total_seconds() / 60
        for run, start in run_start.items()
        if run in run_dawn and run_dawn[run] >= start
    ]
    average = round(sum(durations) / len(durations), 1) if durations else None
    return GameAggregate(
        people=len(people),
        funnel=[(phase, len(funnel[phase])) for phase in FUNNEL_PHASES],
        stages=stages,
        puzzles=puzzles,
        avg_completion_minutes=average,
        completed_runs=len(durations),
    )


def kst_days(last: date, days: int) -> list[date]:
    """`last` 를 끝으로 하는 `days` 개의 날짜(오래된 날부터)."""

    return [last - timedelta(days=offset) for offset in range(days - 1, -1, -1)]


def month_first(day: date) -> date:
    return day.replace(day=1)


def previous_month_first(day: date) -> date:
    return (month_first(day) - timedelta(days=1)).replace(day=1)


def month_firsts(last: date, months: int) -> list[date]:
    """`last` 가 속한 달을 끝으로 `months` 개 달의 1일(오래된 달부터)."""

    firsts = [month_first(last)]
    while len(firsts) < months:
        firsts.append(previous_month_first(firsts[-1]))
    return list(reversed(firsts))


def next_month_first(day: date) -> date:
    first = month_first(day)
    return (first + timedelta(days=32)).replace(day=1)
