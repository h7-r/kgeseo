"""NPC 콘텐츠 공개 조건 `reveal_when` 평가기 v0.1 (팀 검토 대기, 아직 아무 곳에도 연결하지 않음).

문법은 NPC 콘텐츠 데이터 계약 v0.3 §3.1~3.3을 따른다. 조건 객체는 키가 정확히 하나다.

    {"always": true}
    {"clue_acquired": "<clue_id>"}                      → state.acquired_clue_ids
    {"puzzle_completed": "<puzzle_id>"}                 → state.completed_puzzle_ids
    {"hint_level": {"puzzle": "<puzzle_id>", "gte": 1|2}} → state.hint_levels[<puzzle_id>]
    {"flag": {"name": "<flag>", "eq": <JSON 스칼라>}}     → state.flags[<flag>]
    {"all": [<조건>, …]} · {"any": [<조건>, …]}            → AND · OR, 중첩 가능

[닫힌 쪽 원칙] 아래는 모두 비공개(`revealed=False`)다. 이유 코드만 돌려주고 내용은 담지 않는다.
- 조건이 없음(`None`) — 늘 공개는 `{"always": true}`로 밝혀야 한다.
- 모르는 조건 · 키가 0개이거나 2개 이상 · 값 타입이 틀림.
- `scene_reached` · `scene_cleared` · `ending_reached`: 계약에 있지만 BE에 장면 · 엔딩 판정이 없어
  판정할 상태가 없다(v0.3 §3.3 "판정할 상태가 없음 → 비공개").
- 빈 `all` · 빈 `any`: 계약에 정의가 없어 둘 다 비공개로 둔다(수학적 관례인 빈 AND = 참을 따르지 않는다).
- 트리 어디에든 잘못된 조건이 있으면 `any` 안에 참인 갈래가 있어도 전체를 비공개로 한다
  (먼저 문법을 다 검사한 뒤 평가한다).
- 중첩이 `MAX_DEPTH`를 넘거나 조건 수가 `MAX_NODES`를 넘으면 비공개. JSON에서 읽은 값은 순환할 수
  없지만, 코드가 만든 객체의 자기 참조도 이 한도에 걸려 끝난다.

[상태] 서버 PlaySession의 `state_json`만 받는다. 클라이언트가 보낸 진행 상태를 넣지 않는다.
읽기만 하고 바꾸지 않는다. 저장값 타입이 이상하면(예: 단계가 정수가 아님) 그 조건은 거짓이다.

[값 비교] `flag.eq`와 저장값은 타입까지 같아야 같다(`1`과 `true`, `1`과 `1.0`은 다르다).
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from app.schemas.hint import MAX_HINT_LEVEL

MAX_DEPTH = 8
MAX_NODES = 64

RevealReason = Literal[
    "revealed",
    "not_met",
    "missing",
    "invalid",
    "unknown_condition",
    "unsupported_condition",
    "empty_group",
    "too_deep",
    "too_large",
]

SUPPORTED_CONDITIONS = frozenset(
    {"always", "clue_acquired", "puzzle_completed", "hint_level", "flag", "all", "any"}
)
# 계약에는 있지만 BE에 판정할 상태가 없는 조건
UNSUPPORTED_CONDITIONS = frozenset({"scene_reached", "scene_cleared", "ending_reached"})


@dataclass(frozen=True)
class RevealDecision:
    revealed: bool
    # 왜 그렇게 판정했는지. 콘텐츠 원문 · 정답 · 조건 값은 담지 않는다.
    reason: RevealReason


class _Closed(Exception):
    def __init__(self, reason: RevealReason) -> None:
        self.reason = reason


def evaluate_reveal_when(
    condition: Any, server_state: Mapping[str, Any]
) -> RevealDecision:
    if condition is None:
        return RevealDecision(False, "missing")
    try:
        _check(condition, depth=1, budget=[MAX_NODES])
    except _Closed as closed:
        return RevealDecision(False, closed.reason)
    if _evaluate(condition, server_state):
        return RevealDecision(True, "revealed")
    return RevealDecision(False, "not_met")


def is_revealed(condition: Any, server_state: Mapping[str, Any]) -> bool:
    return evaluate_reveal_when(condition, server_state).revealed


def _is_id(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, str | bool | int | float)


def _check(condition: Any, *, depth: int, budget: list[int]) -> None:
    """문법만 검사한다. 잘못되면 _Closed를 던진다."""

    if depth > MAX_DEPTH:
        raise _Closed("too_deep")
    budget[0] -= 1
    if budget[0] < 0:
        raise _Closed("too_large")
    if not isinstance(condition, Mapping) or len(condition) != 1:
        raise _Closed("invalid")
    [(kind, value)] = condition.items()
    if not isinstance(kind, str):
        raise _Closed("invalid")
    if kind in UNSUPPORTED_CONDITIONS:
        raise _Closed("unsupported_condition")
    if kind not in SUPPORTED_CONDITIONS:
        raise _Closed("unknown_condition")

    if kind == "always":
        if value is not True:
            raise _Closed("invalid")
    elif kind in ("clue_acquired", "puzzle_completed"):
        if not _is_id(value):
            raise _Closed("invalid")
    elif kind == "hint_level":
        if not isinstance(value, Mapping) or set(value) != {"puzzle", "gte"}:
            raise _Closed("invalid")
        level = value["gte"]
        if (
            not _is_id(value["puzzle"])
            or isinstance(level, bool)
            or not isinstance(level, int)
            or not 1 <= level <= MAX_HINT_LEVEL
        ):
            raise _Closed("invalid")
    elif kind == "flag":
        if (
            not isinstance(value, Mapping)
            or set(value) != {"name", "eq"}
            or not _is_id(value["name"])
            or not _is_scalar(value["eq"])
        ):
            raise _Closed("invalid")
    else:  # all · any
        if not isinstance(value, list):
            raise _Closed("invalid")
        if not value:
            raise _Closed("empty_group")
        for child in value:
            _check(child, depth=depth + 1, budget=budget)


def _ids(state: Mapping[str, Any], key: str) -> frozenset[str]:
    value = state.get(key)
    if not isinstance(value, list):
        return frozenset()
    return frozenset(item for item in value if isinstance(item, str))


def _same_value(left: Any, right: Any) -> bool:
    return type(left) is type(right) and left == right


def _evaluate(condition: Mapping[str, Any], state: Mapping[str, Any]) -> bool:
    [(kind, value)] = condition.items()
    if kind == "always":
        return True
    if kind == "clue_acquired":
        return value in _ids(state, "acquired_clue_ids")
    if kind == "puzzle_completed":
        return value in _ids(state, "completed_puzzle_ids")
    if kind == "hint_level":
        levels = state.get("hint_levels")
        stored = levels.get(value["puzzle"], 0) if isinstance(levels, Mapping) else 0
        if isinstance(stored, bool) or not isinstance(stored, int):
            return False
        return stored >= value["gte"]
    if kind == "flag":
        flags = state.get("flags")
        if not isinstance(flags, Mapping) or value["name"] not in flags:
            return False
        return _same_value(flags[value["name"]], value["eq"])
    if kind == "all":
        return all(_evaluate(child, state) for child in value)
    return any(_evaluate(child, state) for child in value)
