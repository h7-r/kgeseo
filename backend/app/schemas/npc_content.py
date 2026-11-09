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

[PM v0.4.3 추가 필드] 레거시 읽기에서는 없으면 「없음(미제공)」이다. 빈 목록과 구별한다.
PM v0.4.15: 게시 시 ng 및 proper_nouns는 필수다([] 유효). 모델의 None은 기존 게시본을 읽기 위한 호환 표현이다.
- `npc_scenario`: `address`(호칭) · `avoid_topics`(회피 주제) — 생성 대화 model_context에 들어가는 공개 설정.
- `ng[]`: `text` · `patterns` — 금지 왜곡. 서버 정책 검사 전용, model_context에 넣지 않는다.
- `open[]`: `text` · `patterns` — 해석 유보(U) 주제. 단정을 막는다. `text`만 공개 주제 이름으로 쓴다.
- `fallback_lines[]`: `line_id` · `text` · `use` — 생성 대사가 막혔을 때의 승인 대체 대사(G3 승인 필요).
  `use` 값의 목록 · 뜻은 정해지지 않아 비어 있지 않은 문자열만 확인한다.
항목에 ID가 없는 `ng` · `open`은 정책 검사 결과에서 위치(`ng[0]`)를 규칙 ID로 쓴다.

[계약 v0.4.16 상황 대사 — 스키마 버전은 그대로 `npc-pack 0.1`, 선택 필드만 더한다]
- `situations[]`(§4 · §8-1): `code`(§9-4의 11개) · `cooldown_seconds`(선택, 없으면 서버 기본값) ·
  `lines[]{line_id, text, focus_object_id?}`. `line_id`는 케이스 안에서 유일하다(기존 중복 검사에 포함).
  없으면(None) 「상황 대사 미제공」(v0.4.16 이전 팩), `[]`는 「상황 대사 없음」이다. 둘 다 상황 대사를 내지 않는다.
  같은 `code`를 두 항목에 나눠 적지 않는다(쿨다운 값이 둘이 되므로).
- `general_nudges[]`의 선택 `zone_id`(§9-7, 잡담 구역). 계약 문구는 `general_nudges[].lines[]`지만 이 팩의
  `general_nudges[]`는 항목 하나가 대사 한 줄이라 항목에 둔다. 퍼즐 넛지에는 받지 않는다.
- 상황 대사에는 계약 §4대로 `reveal_when`이 없다(어느 상태에서나 나올 수 있다). 그래서 게시 검사는 「아무것도
  공개되지 않은 상태」로 미공개 단서 · 힌트 겹침을 본다(`app.services.npc_content_validation`).
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

# v0.3 §2 런타임 ID 규칙(대문자 + 밑줄, 종류 접두어)
NUDGE_CONTENT_ID_PATTERN = r"^NUDGE_[A-Z0-9_]+$"
# NPC 클라이언트 대사 최대 글자 수(AI_PROVIDER_CONFIG.maxTextLength)와 맞춘 값
MAX_NUDGE_TEXT_LENGTH = 200

NonBlank = Annotated[str, StringConstraints(strip_whitespace=False, min_length=1)]
# Zone · Object ID 길이 상한(NPC 턴 요청의 focus_object_id · situation.zone_id와 같다)
MAX_RUNTIME_REF_LENGTH = 64
RuntimeRef = Annotated[str, Field(min_length=1, max_length=MAX_RUNTIME_REF_LENGTH)]

# 계약 v0.4.16 §9-4 상황 코드 11개(§3 표를 대신함). 겹칠 때 FE가 보내는 차례(§9-5)대로 적는다.
# 코드를 늘리려면 계약을 먼저 고친다. NPC 턴 요청(`app.schemas.npc_turn`)도 이 목록을 쓴다.
NpcSituationCode = Literal[
    "BREATH_LOW",
    "SENT_BACK",
    "ITEM_MISSING",
    "ITEM_LEFT_BEHIND",
    "ITEM_NOT_PICKED",
    "REPEATED_MISTAKE",
    "OFF_OBJECTIVE",
    "NO_PROGRESS",
    "STEP_ARRIVED",
    "STEP_DONE",
    "QUIET",
]


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


class NpcGeneralNudgeContent(NpcNudgeContent):
    """퍼즐과 무관한 넛지(잡담 포함, 계약 v0.4.16 §6). `zone_id`가 있으면 그 구역 잡담이다(§9-7)."""

    zone_id: RuntimeRef | None = None

    @model_validator(mode="after")
    def validate_zone(self) -> "NpcGeneralNudgeContent":
        if self.zone_id is not None:
            _require_text(self.zone_id, f"Nudge '{self.line_id}' zone_id")
        return self


class NpcSituationLine(NpcContentModel):
    """상황 대사 한 줄(계약 v0.4.16 §4 · §8-1). 고정 문장만(§8-7, 치환 없음)."""

    line_id: NonBlank
    text: NonBlank = Field(max_length=MAX_NUDGE_TEXT_LENGTH)
    # 있으면 「코드 + 같은 Object」일 때 먼저 고른다(§8-1). 판정 없는 걸음 대사가 쓴다.
    focus_object_id: RuntimeRef | None = None

    @model_validator(mode="after")
    def validate_text(self) -> "NpcSituationLine":
        _require_text(self.line_id, "Situation line line_id")
        _require_text(self.text, f"Situation line '{self.line_id}' text")
        if self.focus_object_id is not None:
            _require_text(
                self.focus_object_id, f"Situation line '{self.line_id}' focus_object_id"
            )
        return self


class NpcSituationContent(NpcContentModel):
    """상황 코드 하나의 대사 묶음(계약 v0.4.16 §4)."""

    code: NpcSituationCode
    # 코드별 쿨다운(초). 없으면 서버 기본값(§4). 자동 개입 설정과 같이 1 이상의 정수만 받는다.
    cooldown_seconds: Annotated[int, Field(strict=True, ge=1)] | None = None
    # 퍼즐 넛지(`puzzles[].nudges`)와 같이 대사가 하나도 없는 항목은 받지 않는다.
    lines: list[NpcSituationLine] = Field(min_length=1)


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


class NpcScenario(NpcContentModel):
    # 호칭 · 회피 주제. 공개 설정이라 model_context에 들어간다.
    address: NonBlank
    avoid_topics: list[NonBlank] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_text(self) -> "NpcScenario":
        _require_text(self.address, "npc_scenario.address")
        for topic in self.avoid_topics:
            _require_text(topic, "npc_scenario.avoid_topics")
        return self


class NpcPolicyRule(NpcContentModel):
    """NG · U(open) 규칙 한 줄. patterns가 비어 있으면 text로 맞춘다(NG)."""

    text: NonBlank
    patterns: list[NonBlank] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_text(self) -> "NpcPolicyRule":
        _require_text(self.text, "policy rule text")
        for pattern in self.patterns:
            _require_text(pattern, "policy rule pattern")
        return self


class NpcFallbackLine(NpcContentModel):
    line_id: NonBlank
    text: NonBlank = Field(max_length=MAX_NUDGE_TEXT_LENGTH)
    use: NonBlank

    @model_validator(mode="after")
    def validate_text(self) -> "NpcFallbackLine":
        for field in ("line_id", "text", "use"):
            _require_text(getattr(self, field), f"Fallback line {field}")
        return self


PositiveInt = Annotated[int, Field(strict=True, ge=1)]


class NpcAutoNudgeConfig(NpcContentModel):
    """케이스별 자동 개입 설정(PM v0.4.7). 적은 필드만 서버 기본값을 덮어쓴다(필드 이름은 PM 확인 필요).

    값이 없는 필드는 서버 기본값을 그대로 쓴다. 세션당 상한의 서버 기본값은 「제한 없음」이다.
    """

    consecutive_incorrect_min: PositiveInt | None = None
    idle_seconds: PositiveInt | None = None
    max_per_puzzle: PositiveInt | None = None
    max_per_session: PositiveInt | None = None
    suggestion_cooldown_seconds: PositiveInt | None = None
    decline_cooldown_seconds: PositiveInt | None = None


class NpcProperNoun(NpcContentModel):
    """PM v0.4.15 인물 · 장소 검수 목록(생성 컨텍스트에는 제공하지 않는다)."""

    text: NonBlank
    kind: Literal["person", "place"]
    aliases: list[NonBlank]

    @model_validator(mode="after")
    def validate_text(self) -> "NpcProperNoun":
        for value in (self.text, *self.aliases):
            _require_text(value, "proper_nouns text/alias")
        return self


class NpcContentPack(NpcContentModel):
    schema_version: Literal["npc-pack 0.1"]
    case_id: NonBlank
    npc_id: NonBlank
    status: Literal["draft", "published"]
    content_version: int | None = Field(default=None, ge=1)
    content_fingerprint: NonBlank | None = None
    approvals: list[NpcApprovalRecord] = Field(default_factory=list)
    # 퍼즐과 무관한 일반 nudge(잡담은 선택 zone_id)
    general_nudges: list[NpcGeneralNudgeContent] = Field(default_factory=list)
    # 퍼즐별 nudge
    puzzles: list[NpcPuzzleNudges] = Field(default_factory=list)
    # PM v0.4.3 — None은 「제공하지 않음」(정책 검사 불가), []는 「규칙 없음」
    npc_scenario: NpcScenario | None = None
    # 레거시 읽기 호환용 None. 게시에서는 ng/proper_nouns 모두 필수다.
    proper_nouns: list[NpcProperNoun] | None = None
    ng: list[NpcPolicyRule] | None = None
    open: list[NpcPolicyRule] | None = None
    fallback_lines: list[NpcFallbackLine] = Field(default_factory=list)
    # PM v0.4.7 — 없으면 서버 기본 자동 개입 설정
    auto_nudge: NpcAutoNudgeConfig | None = None
    # 계약 v0.4.16 §4 — None은 「미제공」(이전 팩), []는 「상황 대사 없음」
    situations: list[NpcSituationContent] | None = None

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "NpcContentPack":
        for field in ("case_id", "npc_id"):
            _require_text(getattr(self, field), field)
        seen_puzzles: set[str] = set()
        for entry in self.puzzles:
            if entry.puzzle_id in seen_puzzles:
                raise ValueError(f"Duplicate puzzle entry: '{entry.puzzle_id}'")
            seen_puzzles.add(entry.puzzle_id)
        seen_codes: set[str] = set()
        for situation in self.situations or ():
            if situation.code in seen_codes:
                raise ValueError(f"Duplicate situation entry: '{situation.code}'")
            seen_codes.add(situation.code)
        seen_lines: set[str] = set()
        line_ids = (
            [nudge.line_id for nudge in self.all_nudges()]
            + [line.line_id for line in self.fallback_lines]
            + [line.line_id for line in self.situation_lines()]
        )
        for line_id in line_ids:
            if line_id in seen_lines:
                raise ValueError(f"Duplicate line_id: '{line_id}'")
            seen_lines.add(line_id)
        return self

    def all_nudges(self) -> list[NpcNudgeContent]:
        return [
            *self.general_nudges,
            *(nudge for entry in self.puzzles for nudge in entry.nudges),
        ]

    def situation_lines(self) -> list[NpcSituationLine]:
        return [line for entry in self.situations or () for line in entry.lines]


class GeneralLinePack(NpcContentModel):
    """케이스와 무관한 일반 팩 대사(계약 준비 v0.1 — 파일 위치 · 게시 절차 미정).

    PM 기본 안내 문구(NPC_GENERIC_PUZZLE_*) 같은 공용 대사를 담는다. 승인은 팩 내용의 해시
    (`app.services.npc_line_supply.general_pack_fingerprint`)에 대한 G1~G3 승인 이력으로만 정한다.
    """

    schema_version: Literal["npc-general-pack 0.1"]
    pack_id: NonBlank
    pack_version: int = Field(ge=1)
    lines: list[NpcFallbackLine] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "GeneralLinePack":
        _require_text(self.pack_id, "pack_id")
        line_ids = [line.line_id for line in self.lines]
        if len(line_ids) != len(set(line_ids)):
            raise ValueError("Duplicate line_id in general pack")
        return self
