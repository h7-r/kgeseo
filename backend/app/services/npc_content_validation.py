"""NPC 콘텐츠 묶음의 게시 전 검증 v0.1 (팀 검토 대기, 로더 · 서비스에 연결하지 않음).

세 단계를 나눠 판정한다. 셋 다 통과해야 실제로 내보낼 대상(`servable`)이다.

1. 스키마 — `NpcContentPack` 모델 검증 + `reveal_when` 문법(평가기 `npc_reveal`과 같은 판정).
   문법 오류는 스키마 오류다(`schema_valid=False`). 모델은 서비스를 모르므로 문법은 여기서 본다.
2. 교차 참조 — Server Runtime · 정식 힌트 원본과 대조 (v0.3 PUB-REF · PUB-REVEAL · PUB-LEAK 일부)
3. 게시 승인 — **v0.1은 늘 미승인이다.** 승인 기록 형식과 공식 fingerprint가 정해지기 전에는
   `status="published"`와 승인 기록이 있어도 승인으로 보지 않는다(기본 비공개).

결과(이슈)에는 코드 · 위치 · ID만 담는다. 대사 · 정답 · 힌트 원문 · 조건 값은 담지 않는다.
"""

from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import ValidationError

from app.schemas.npc_content import NpcContentPack, NpcNudgeContent
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.hint import HintSource
from app.services.npc import NpcContentUnsafeError, _ensure_no_protected_text
from app.services.npc_reveal import evaluate_reveal_when

# 평가기가 빈 상태로 이 이유를 내면 문법은 맞다. 장면 · 엔딩 조건은 문법은 맞지만 게시할 수 없다.
_SYNTAX_OK_REASONS = frozenset({"revealed", "not_met", "unsupported_condition"})

NpcContentIssueCode = Literal[
    "SCHEMA_INVALID",
    "CASE_ID_MISMATCH",
    "UNKNOWN_PUZZLE",
    "UNKNOWN_CLUE",
    "UNKNOWN_FLAG",
    "UNDEFINED_HINT_LEVEL",
    "UNSUPPORTED_CONDITION",
    "PROTECTED_TEXT",
    "APPROVAL_UNVERIFIED",
]


@dataclass(frozen=True)
class NpcContentIssue:
    code: NpcContentIssueCode
    # 문제가 난 곳 (예: "puzzles[PZ_A].nudges[NUDGE_A]", "$.general_nudges.0.text")
    location: str
    # 관련 ID(퍼즐 · 단서 · flag 이름 등). 원문 · 정답은 넣지 않는다.
    reference: str | None = None


@dataclass(frozen=True)
class NpcContentReadiness:
    schema_valid: bool
    links_valid: bool
    publish_approved: bool
    issues: tuple[NpcContentIssue, ...] = field(default_factory=tuple)

    @property
    def servable(self) -> bool:
        return self.schema_valid and self.links_valid and self.publish_approved


def assess_npc_content(
    raw: Any,
    runtime: PuzzleRuntimeDefinition,
    *,
    hint_source: HintSource,
) -> NpcContentReadiness:
    try:
        pack = NpcContentPack.model_validate(raw)
    except ValidationError as error:
        return NpcContentReadiness(
            schema_valid=False,
            links_valid=False,
            publish_approved=False,
            issues=tuple(
                NpcContentIssue(
                    "SCHEMA_INVALID",
                    "$." + ".".join(str(part) for part in item["loc"]),
                    item["type"],
                )
                for item in error.errors(include_input=False, include_url=False)
            ),
        )

    syntax_issues = reveal_when_syntax_issues(pack)
    if syntax_issues:
        return NpcContentReadiness(
            schema_valid=False,
            links_valid=False,
            publish_approved=False,
            issues=syntax_issues,
        )

    link_issues = validate_npc_content_links(pack, runtime, hint_source=hint_source)
    # v0.1: 승인 판정 규칙이 정해지지 않았으므로 어떤 묶음도 승인으로 보지 않는다.
    approval_issue = NpcContentIssue("APPROVAL_UNVERIFIED", "$.approvals")
    return NpcContentReadiness(
        schema_valid=True,
        links_valid=not link_issues,
        publish_approved=False,
        issues=(*link_issues, approval_issue),
    )


def reveal_when_syntax_issues(pack: NpcContentPack) -> tuple[NpcContentIssue, ...]:
    """`reveal_when` 문법 오류. 이유 코드만 싣고 조건 값은 싣지 않는다."""

    issues: list[NpcContentIssue] = []
    for location, nudge in _located_nudges(pack):
        reason = evaluate_reveal_when(nudge.reveal_when, {}).reason
        if reason not in _SYNTAX_OK_REASONS:
            issues.append(
                NpcContentIssue("SCHEMA_INVALID", f"{location}.reveal_when", reason)
            )
    return tuple(issues)


def validate_npc_content_links(
    pack: NpcContentPack,
    runtime: PuzzleRuntimeDefinition,
    *,
    hint_source: HintSource,
) -> tuple[NpcContentIssue, ...]:
    issues: list[NpcContentIssue] = []
    if pack.case_id != runtime.case_id:
        issues.append(NpcContentIssue("CASE_ID_MISMATCH", "$.case_id", pack.case_id))

    defined_puzzles = {puzzle.puzzle_id for puzzle in runtime.puzzles}
    # 완료 조건은 정의된 퍼즐과, 효과가 완료로 표시하는 마커 ID(정의 없는 complete_puzzle_ids)를 받는다.
    completion_ids = defined_puzzles | {
        puzzle_id
        for effect in _effects(runtime)
        for puzzle_id in effect.complete_puzzle_ids
    }
    known_clues = {clue.clue_id for clue in runtime.clues} | {
        clue_id for effect in _effects(runtime) for clue_id in effect.grant_clue_ids
    }
    known_flags = {name for effect in _effects(runtime) for name in effect.set_flags}

    for index, entry in enumerate(pack.puzzles):
        if entry.puzzle_id not in defined_puzzles:
            issues.append(
                NpcContentIssue(
                    "UNKNOWN_PUZZLE", f"$.puzzles.{index}.puzzle_id", entry.puzzle_id
                )
            )

    for location, nudge in _located_nudges(pack):
        issues.extend(
            _condition_issues(
                nudge,
                location,
                case_id=runtime.case_id,
                defined_puzzles=defined_puzzles,
                completion_ids=completion_ids,
                known_clues=known_clues,
                known_flags=known_flags,
                hint_source=hint_source,
            )
        )
        try:
            # nudge에는 정답 예외가 없다. 모든 퍼즐의 정답 · 힌트 원문과 겹치면 막는다.
            _ensure_no_protected_text(
                nudge.text,
                runtime.case_id,
                runtime,
                hint_source,
                allowed_puzzle_id=None,
            )
        except NpcContentUnsafeError as error:
            issues.append(
                NpcContentIssue("PROTECTED_TEXT", f"{location}.text", str(error))
            )
    return tuple(issues)


def _effects(runtime: PuzzleRuntimeDefinition):
    yield from (puzzle.on_correct for puzzle in runtime.puzzles)
    yield from (inspection.on_inspect for inspection in runtime.inspections)
    yield from (combination.on_success for combination in runtime.clue_combinations)


def _located_nudges(pack: NpcContentPack) -> Iterator[tuple[str, NpcNudgeContent]]:
    for index, nudge in enumerate(pack.general_nudges):
        yield f"$.general_nudges.{index}", nudge
    for entry_index, entry in enumerate(pack.puzzles):
        for index, nudge in enumerate(entry.nudges):
            yield f"$.puzzles.{entry_index}.nudges.{index}", nudge


def _leaf_conditions(condition: Mapping[str, Any]) -> Iterator[tuple[str, Any]]:
    """스키마를 통과한(깊이 · 크기 제한 안) 조건 트리의 잎을 돌려준다."""

    [(kind, value)] = condition.items()
    if kind in ("all", "any"):
        for child in value:
            yield from _leaf_conditions(child)
    else:
        yield kind, value


def _condition_issues(
    nudge: NpcNudgeContent,
    location: str,
    *,
    case_id: str,
    defined_puzzles: set[str],
    completion_ids: set[str],
    known_clues: set[str],
    known_flags: set[str],
    hint_source: HintSource,
) -> list[NpcContentIssue]:
    where = f"{location}.reveal_when"
    reason = evaluate_reveal_when(nudge.reveal_when, {}).reason
    if reason == "unsupported_condition":
        # 장면 · 엔딩 조건: 계약에는 있지만 BE에 판정할 상태가 없다 → 게시 불가.
        return [NpcContentIssue("UNSUPPORTED_CONDITION", where)]
    if reason not in _SYNTAX_OK_REASONS:
        # 이 함수를 직접 부른 경우에도 문법 오류 조건은 통과시키지 않는다.
        return [NpcContentIssue("SCHEMA_INVALID", where, reason)]

    issues: list[NpcContentIssue] = []
    for kind, value in _leaf_conditions(nudge.reveal_when):
        if kind == "clue_acquired" and value not in known_clues:
            issues.append(NpcContentIssue("UNKNOWN_CLUE", where, value))
        elif kind == "puzzle_completed" and value not in completion_ids:
            issues.append(NpcContentIssue("UNKNOWN_PUZZLE", where, value))
        elif kind == "flag" and value["name"] not in known_flags:
            issues.append(NpcContentIssue("UNKNOWN_FLAG", where, value["name"]))
        elif kind == "hint_level":
            puzzle_id, level = value["puzzle"], value["gte"]
            if puzzle_id not in defined_puzzles:
                issues.append(NpcContentIssue("UNKNOWN_PUZZLE", where, puzzle_id))
            else:
                text = hint_source(case_id, puzzle_id, level)
                if text is None or not text.strip():
                    issues.append(
                        NpcContentIssue(
                            "UNDEFINED_HINT_LEVEL", where, f"{puzzle_id}:{level}"
                        )
                    )
    return issues
