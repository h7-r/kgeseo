"""정식 Hint API의 대상 결정 · 서버 상태 기반 접근 조건 v0.1 (PM v0.4.10 §1).

대상 결정(`resolve_hint_target`)
- `puzzle_id`(힌트 버튼) 또는 `hint_ref`(NPC 제안 수락) 중 하나. 스키마가 정확히 하나만 받는다.
- `hint_ref`는 기존 `resolve_hint_ref`로 그 세션 · 고정 fingerprint · 고정 버전 퍼즐 목록에 대조한다.
  레거시(버전 없는) 세션에는 hint_ref가 발급되지 않으므로 불일치다. 오류에는 퍼즐 ID를 싣지 않는다.

접근 조건(`server_state_access_policy`, 새 단계 해금에만 적용. 재열람은 조건 없음)
- **발견한 퍼즐만** 새 단계를 연다. 「발견」은 기존 코드 근거만 쓴다(새 정책을 만들지 않는다).
  1. 현재 구역에서 보이는(`object_states` 반영) Object가 그 퍼즐로 이어지는 상호작용을 가진다
     — NPC가 `hint_ref`를 발급하는 조건(`npc_turn_service._focus_puzzle`)과 같다.
  2. 이미 푼 퍼즐(`completed_puzzle_ids`)
  3. 이미 한 단계 이상 연 퍼즐(`hint_levels ≥ 1`) — 서버가 그때 접근을 허락했다는 기록
  발견하지 않은 퍼즐은 없는 퍼즐과 같은 응답(404)을 낸다. 힌트 유무 · 단계가 드러나지 않는다.
- 선행 단서(`requires_clue_ids`)를 힌트에도 적용할지는 PM 미결정이다(hint_api_v0.1 §3). 계약상 이 필드는
  정답 판정 · 조사 효과의 조건이므로(interaction_puzzle_runtime §7.9) 기본은 적용하지 않는다.
  `HintAccessRules(require_clues=True)`로 켤 수 있다(부족하면 개수만 알리는 409, Q5와 같음).
- 다른 구역 · 완료 퍼즐의 정책(Zone 제한 · 완료 퍼즐 해금)은 위 1~3 밖의 결정이 필요하면 PM에 묻는다.
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from app.schemas.case_content import CaseClientContent
from app.schemas.puzzle_runtime import PuzzleDefinition, PuzzleRuntimeDefinition
from app.services.hint import HintAccessDeniedError, HintAccessPolicy
from app.services.hint_ref import (
    HintRefKeys,
    HintRefKeyUnavailableError,
    HintRefMismatchError,
    resolve_hint_ref,
)
from app.services.object_state import resolve_effective_object_states
from app.services.puzzle_question import PUZZLE_INTERACTION_TYPES

ClientContentLoader = Callable[[str], CaseClientContent]


class PuzzleNotDiscoveredError(HintAccessDeniedError):
    """아직 발견하지 않은 퍼즐이다. 라우터는 없는 퍼즐과 같은 404로 답한다."""


class HintCluesMissingError(HintAccessDeniedError):
    """선행 단서가 부족하다(`require_clues=True`일 때만). 단서 ID 대신 개수만 싣는다."""

    def __init__(self, missing_clue_count: int) -> None:
        super().__init__("required clues are missing")
        self.missing_clue_count = missing_clue_count


@dataclass(frozen=True)
class HintAccessRules:
    # PM 미결정: 힌트에도 선행 단서 조건을 적용할지(기본 미적용)
    require_clues: bool = False


def is_puzzle_discovered(
    client: CaseClientContent, state: dict[str, Any], puzzle_id: str
) -> bool:
    if puzzle_id in (state.get("completed_puzzle_ids") or []):
        return True
    level = (state.get("hint_levels") or {}).get(puzzle_id, 0)
    if isinstance(level, int) and not isinstance(level, bool) and level >= 1:
        return True
    zone_id = state.get("current_zone_id")
    zone = next((z for z in client.zones if z.zone_id == zone_id), None)
    if zone is None:
        return False
    effective = resolve_effective_object_states(client, state.get("object_states", {}))
    return any(
        obj.interaction is not None
        and obj.interaction.type in PUZZLE_INTERACTION_TYPES
        and obj.interaction.target_id == puzzle_id
        and effective[(zone.zone_id, obj.object_id)].visible
        for obj in zone.objects
    )


def server_state_access_policy(
    case_id: str,
    client_content_loader: ClientContentLoader,
    rules: HintAccessRules = HintAccessRules(),
) -> HintAccessPolicy:
    """잠근 세션 상태로 판정한다(`unlock_hint`가 새 단계를 열기 직전에 부른다)."""

    def policy(state: dict[str, Any], puzzle: PuzzleDefinition, level: int) -> None:
        client = client_content_loader(case_id)
        if not is_puzzle_discovered(client, state, puzzle.puzzle_id):
            raise PuzzleNotDiscoveredError(puzzle.puzzle_id)
        if rules.require_clues:
            acquired = set(state.get("acquired_clue_ids") or [])
            missing = [c for c in puzzle.requires_clue_ids if c not in acquired]
            if missing:
                raise HintCluesMissingError(len(missing))

    return policy


def resolve_hint_target(
    *,
    puzzle_id: str | None,
    hint_ref: str | None,
    play_session_id: str,
    content_fingerprint: str | None,
    runtime: PuzzleRuntimeDefinition,
    keys: HintRefKeys | None,
) -> str:
    """요청이 가리키는 내부 puzzle_id. `puzzle_id`는 그대로(존재 · 발견 확인은 서비스가 한다)."""

    if puzzle_id is not None:
        return puzzle_id
    if hint_ref is None:
        raise ValueError("puzzle_id or hint_ref is required")
    if keys is None:
        # 검증 키가 설정되지 않았다(운영 설정 오류). 위조와 구분해 알린다.
        raise HintRefKeyUnavailableError()
    if content_fingerprint is None:
        raise HintRefMismatchError()
    puzzle_ids: Iterable[str] = [puzzle.puzzle_id for puzzle in runtime.puzzles]
    return resolve_hint_ref(
        keys,
        hint_ref,
        play_session_id=play_session_id,
        content_fingerprint=content_fingerprint,
        puzzle_ids=puzzle_ids,
    )
