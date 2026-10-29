"""세 계약이 함께 쓰는 값.

[기존 계약을 그대로 옮긴 것]
  아래 Literal 들은 backend 계약의 닫힌 목록을 **복사**한 것이다.
  backend 코드를 import 하지 않는 이유는 실험 환경이 backend 의 DB 설정이나
  Python 3.13 환경에 묶이지 않게 하려는 것이다. 대신 tests/test_backend_compat.py 가
  backend 원본과 값이 같은지 검사해, 한쪽만 바뀌면 테스트가 깨진다.
"""

import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

CONTRACT_VERSION = "0.1"

# backend/app/services/puzzle_runtime.py 의 CASE_ID_PATTERN 과 같다.
CASE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")

# ── backend/app/schemas/interaction_api.py ──────────────────────
InteractionAction = Literal["inspect", "navigate", "input", "select", "combine_clues"]
InteractionTargetType = Literal["object", "puzzle", "clue", "zone"]
ExternalInteractionResultType = Literal[
    "ok", "correct", "incorrect", "already_completed"
]

# ── backend/app/schemas/interaction.py (state_changes 닫힌 목록) ──
StateChangeType = Literal[
    "puzzle_completed",
    "clue_acquired",
    "zone_unlocked",
    "current_zone_changed",
    "hint_level_changed",
    "flag_updated",
    "object_revealed",
    "object_hidden",
    "object_unlocked",
]

# ── backend/app/schemas/play_session.py (object_states 속성) ────
ObjectStateField = Literal["visible", "enabled"]

# ── origin/dev 파이프라인 설계요청 v2.1 §4.4 (Puzzle Type 7종) ──
PuzzleType = Literal[
    "code_input",
    "text_input",
    "single_choice",
    "multiple_choice",
    "observation",
    "navigation",
    "clue_combination",
]

# ── NPC 힌트 수준 (제안) ───────────────────────────────────────
#   backend 의 hint_levels(0 미열람 · 1 힌트 · 2 정답 공개)와 **다른 축**이다.
#   NPC 는 어떤 수준에서도 정답을 말하지 않는다.
#     0 = 개입 없음 / 잡담
#     1 = 주의 환기 — 어디를 다시 볼지
#     2 = 방향 제시 — 다음 생각·행동의 방향 (정답·정확한 조작은 아님)
NpcHintLevel = Literal[0, 1, 2]

# RAG 문서의 스포일러 등급(제안). NpcHintLevel 과 같은 눈금이다.
#   정답과 같은 정보(등급 3에 해당)는 ScenarioPack 에 아예 들어가지 않는다.
SpoilerTier = Literal[0, 1, 2]

Id = Annotated[str, Field(min_length=1, max_length=64)]


def _require_timezone(value: datetime) -> datetime:
    # backend interaction_api.py 와 같은 규칙: 시각은 반드시 offset 을 가진다.
    if value.utcoffset() is None:
        raise ValueError("timestamp must include a timezone offset")
    return value


AwareDatetime = Annotated[datetime, AfterValidator(_require_timezone)]


def _check_case_id(value: str) -> str:
    if CASE_ID_PATTERN.fullmatch(value) is None:
        raise ValueError("case_id must match ^[A-Za-z0-9_-]+$")
    return value


CaseId = Annotated[
    str, Field(min_length=1, max_length=64), AfterValidator(_check_case_id)
]


class ContractModel(BaseModel):
    # 정의하지 않은 필드는 받지 않는다 — accepted_answers 같은 값이 섞여 들어오는 걸 막는다.
    model_config = ConfigDict(extra="forbid", frozen=True)


class PlaySessionStateSnapshot(ContractModel):
    """backend PlaySessionState 와 같은 모양 (GET /play-sessions/{id} 의 data.state).

    backend 가 나중에 state 에 key 를 더해도 NPC 가 멈추지 않도록, 이 모델만은
    모르는 key 를 거부하지 않고 버린다(backend PlaySessionState 의 기본 동작과 같다).
    """

    model_config = ConfigDict(extra="ignore", frozen=True)

    current_zone_id: str | None = None
    completed_puzzle_ids: list[str]
    completed_inspect_ids: list[str] = Field(default_factory=list)
    acquired_clue_ids: list[str]
    # 정식 힌트 해금 단계(0 미열람 · 1 힌트 · 2 정답 공개). NpcHintLevel 과 다른 축이다.
    hint_levels: dict[str, int]
    attempt_counts: dict[str, int] = Field(default_factory=dict)
    flags: dict[str, object]
    # zone_id → object_id → {"visible" | "enabled": bool}. 기록한 속성만 담는다.
    object_states: dict[str, dict[str, dict[ObjectStateField, bool]]] = Field(
        default_factory=dict
    )


def find_duplicates(values: list[str]) -> list[str]:
    seen: set[str] = set()
    duplicates: list[str] = []
    for value in values:
        if value in seen and value not in duplicates:
            duplicates.append(value)
        seen.add(value)
    return duplicates
