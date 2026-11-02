"""NPC 콘텐츠 묶음(`<case_id>.npc.json` 제안) 최소 스키마 v0.1 (팀 검토 대기).

NPC 콘텐츠 데이터 계약 v0.3의 부분집합이다. nudge와 힌트 단계 참조를 담는다.

- 정식 힌트 원문 · 정답은 담지 않는다(PM v0.4.1: 힌트 원문은 server.json 한 곳에만 둔다).
  `puzzles[].hints[]`는 `{"level": 1}` · `{"level": 2}` 단계 참조만 받는다. 원문(`text` 등)이나
  다른 필드가 오면 모든 모델이 `extra="forbid"`라 검증 오류다. `accepted_answers`도 마찬가지다.
- 힌트 단계 참조는 해금 권한을 주지 않는다. 재표시는 서버의 현재 `hint_levels` 확인을 거친다.
- 이 모듈은 필드 형식만 검사하고 서비스 계층을 가져다 쓰지 않는다. `reveal_when`은 객체인지만
  보고, 문법은 `app.services.npc_content_validation`이 평가기(`npc_reveal`)로 검사한다.
  그래서 이 모델을 통과했다고 게시 가능한 묶음이 아니다 — 판정은 `assess_npc_content()`로 한다.
- `content_version` · `content_fingerprint` · `approvals`는 형식만 받는다. 공식 fingerprint 정의와
  G3 승인 해시 검증은 정해지지 않았으므로 여기서 판정하지 않는다.
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

# v0.3 §2 런타임 ID 규칙(대문자 + 밑줄, 종류 접두어)
NUDGE_CONTENT_ID_PATTERN = r"^NUDGE_[A-Z0-9_]+$"
# NPC 클라이언트 대사 최대 글자 수(AI_PROVIDER_CONFIG.maxTextLength)와 맞춘 값
MAX_NUDGE_TEXT_LENGTH = 200

NonBlank = Annotated[str, StringConstraints(strip_whitespace=False, min_length=1)]


class NpcContentModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _require_text(value: str, field: str) -> None:
    if not value.strip():
        raise ValueError(f"{field} must not be blank")


class NpcNudgeContent(NpcContentModel):
    line_id: str = Field(pattern=NUDGE_CONTENT_ID_PATTERN)
    text: NonBlank = Field(max_length=MAX_NUDGE_TEXT_LENGTH)
    # 없으면 비공개가 아니라 검증 오류다(v0.3 PUB-REVEAL: 모든 항목에 reveal_when 필요).
    reveal_when: dict[str, Any]

    @model_validator(mode="after")
    def validate_fields(self) -> "NpcNudgeContent":
        _require_text(self.text, f"Nudge '{self.line_id}' text")
        return self


class NpcHintLevelRef(NpcContentModel):
    """정식 힌트 한 단계를 가리키는 참조. 원문은 server.json(공식 HintSource)에만 있다."""

    # bool · 문자열 · 실수는 받지 않는다.
    level: Annotated[int, Field(strict=True, ge=1, le=2)]


class NpcPuzzleNudges(NpcContentModel):
    puzzle_id: NonBlank
    nudges: list[NpcNudgeContent] = Field(min_length=1)
    hints: list[NpcHintLevelRef] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_puzzle_id(self) -> "NpcPuzzleNudges":
        _require_text(self.puzzle_id, "puzzle_id")
        levels = [hint.level for hint in self.hints]
        if len(levels) != len(set(levels)):
            raise ValueError(f"Puzzle '{self.puzzle_id}' has duplicate hint levels")
        return self


class NpcApprovalRecord(NpcContentModel):
    """승인 기록 형식만 받는다. 해시 일치 · 승인 효력은 판정하지 않는다."""

    gate: Literal["G1", "G2", "G3"]
    decision: Literal["approved", "rejected"]
    target_hash: NonBlank
    at: datetime


class NpcContentPack(NpcContentModel):
    schema_version: Literal["npc-pack 0.1"]
    case_id: NonBlank
    npc_id: NonBlank
    status: Literal["draft", "published"]
    content_version: int | None = Field(default=None, ge=1)
    content_fingerprint: NonBlank | None = None
    approvals: list[NpcApprovalRecord] = Field(default_factory=list)
    # 퍼즐과 무관한 일반 nudge
    general_nudges: list[NpcNudgeContent] = Field(default_factory=list)
    # 퍼즐별 nudge
    puzzles: list[NpcPuzzleNudges] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "NpcContentPack":
        for field in ("case_id", "npc_id"):
            _require_text(getattr(self, field), field)
        seen_puzzles: set[str] = set()
        for entry in self.puzzles:
            if entry.puzzle_id in seen_puzzles:
                raise ValueError(f"Duplicate puzzle entry: '{entry.puzzle_id}'")
            seen_puzzles.add(entry.puzzle_id)
        seen_lines: set[str] = set()
        for nudge in self.all_nudges():
            if nudge.line_id in seen_lines:
                raise ValueError(f"Duplicate line_id: '{nudge.line_id}'")
            seen_lines.add(nudge.line_id)
        return self

    def all_nudges(self) -> list[NpcNudgeContent]:
        return [
            *self.general_nudges,
            *(nudge for entry in self.puzzles for nudge in entry.nudges),
        ]
