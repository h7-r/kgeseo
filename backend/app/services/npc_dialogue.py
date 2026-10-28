"""NPC 플레이어 메시지 응답 v0.1 (PM v0.4.3, 팀 검토 대기 · 라우터 미등록 · 상태 · 이벤트를 쓰지 않음).

플레이어가 NPC에게 말을 걸면 먼저 퍼즐 풀이 질문인지 가른다(`app.services.puzzle_question`).

- 퍼즐 질문: 일반 대화 생성기를 **부르지 않는다**.
  1. 대상 퍼즐(또는 대상이 없으면 일반 nudge)에서 공개 조건(`reveal_when`)을 충족하고 승인된 nudge가 있으면
     그 원문을 그대로 돌려준다(바꿔 쓰지 않는다).
  2. 없으면 PM 확정 기본 안내 문구를 고른다. 대상 퍼즐을 하나로 정할 수 있고 server.json에 그 퍼즐의 정식
     힌트가 있으면 `suggest_hint`를 붙인다 — 힌트 버튼을 보여 주라는 안내일 뿐, Hint API 호출 · 해금이 아니다.
  3. 대상 퍼즐을 하나로 정할 수 없으면(후보가 없거나 여럿) 퍼즐을 임의로 고르지 않는다(`suggest_hint` 없음).
- 일반 대화: 생성 기능은 꺼져 있다(PM v0.4.2 C10 · 기본 OFF). 생성기를 부르지 않고 발화 없음으로 끝낸다.
  켜려면 생성 대사 정책 검사(C3)와 승인 대체 대사(C4)가 먼저 있어야 해서, 지금은 켜면 오류다.

[reply.source] PM 확정 값은 둘뿐이다.
  `generated`     AI 생성 일반 대화(이번 단계에서는 만들지 않는다)
  `approved_line` 승인된 원문 대사. `line_id` 필수
발화가 없으면 reply 객체를 만들지 않고 `NpcDialogueOutcome.no_reply_reason`으로만 남긴다.

[기본 안내 문구] `PM_GENERIC_PUZZLE_LINES`는 PM v0.4.3 확정 원문이다. 문구를 바꾸지 않는다.
일반 팩의 승인 · 버전 관리에 아직 연결되지 않았으므로, 이 모듈은 승인 기록을 만들지 않고 **승인된 것으로
보지 않는다**. 호출하는 쪽이 `generic_line_approval`(검증된 게시 절차)로 승인을 확인해 줄 때만 내보내고,
없으면 발화 없음(`generic_line_unapproved`)이다. 테스트는 개발용 승인 함수를 따로 넘긴다.

[기본 안내 선택 — 임시] 어느 상황에 어느 문구를 쓸지는 PM이 정하지 않았다. 지금은 임시로
「대상 퍼즐이 하나이고 server.json 힌트가 있으면 02, 그 밖에는 01」을 쓴다. 03의 사용 조건은 정하지 않았으므로
쓰지 않는다. PM 기준이 정해지면 `_select_generic_line()`만 바꾼다.

이 함수는 PlaySession `state_json` · `hint_levels`를 읽기만 한다. 정식 힌트 원문을 응답에 싣지 않는다.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

from app.schemas.case_content import CaseClientContent
from app.schemas.npc_content import NpcContentPack, NpcNudgeContent
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.hint import HintSource
from app.services.npc import NpcLineSource, _ensure_no_protected_text
from app.services.npc_reveal import is_revealed
from app.services.puzzle_question import (
    PuzzleQuestionDiagnosis,
    classify_puzzle_question,
    public_puzzle_contexts,
)

# PM v0.4.3 확정 기본 안내 문구 — 수정하지 않는다. 승인 · 버전 관리 연결 전이다(위 설명).
PM_GENERIC_PUZZLE_LINES: Mapping[str, str] = {
    "NPC_GENERIC_PUZZLE_01": (
        "그건 직접 살펴봐야 알 수 있을 것 같아요. 아직 안 본 곳이 있는지 둘러볼까요?"
    ),
    "NPC_GENERIC_PUZZLE_02": "답을 바로 알려 드릴 수는 없어요. 막혔다면 힌트를 열어 볼까요?",
    "NPC_GENERIC_PUZZLE_03": (
        "지금까지 찾은 단서를 다시 한번 맞춰 보면 길이 보일지도 몰라요."
    ),
}
# 임시 선택 규칙에서 쓰는 두 문구(03은 사용 조건 미정)
GENERIC_WITHOUT_TARGET = "NPC_GENERIC_PUZZLE_01"
GENERIC_WITH_HINT_SUGGESTION = "NPC_GENERIC_PUZZLE_02"

# PM 확정 reply.source 값
ReplySource = Literal["generated", "approved_line"]
NoReplyReason = Literal["generation_disabled", "generic_line_unapproved"]
# 일반 대화 생성기(이번 단계에서는 부르지 않는다). 입력 · 출력 계약은 정해지지 않았다.
GeneralGenerator = Callable[..., str]
# line_id → 이 기본 안내 문구를 운영에 내보내도 되는가(검증된 게시 절차가 넘긴다)
GenericLineApproval = Callable[[str], bool]


class GeneralGenerationDisabledError(Exception):
    """일반 대화 생성은 정책 검사(C3) · 승인 대체 대사(C4) 구현 전이라 켤 수 없다."""


@dataclass(frozen=True)
class NpcReply:
    """실제로 보여 줄 발화 하나. 발화가 없으면 이 객체를 만들지 않는다."""

    source: ReplySource
    text: str
    line_id: str | None = None

    def __post_init__(self) -> None:
        if self.source not in ("generated", "approved_line"):
            raise ValueError("reply.source must be 'generated' or 'approved_line'")
        if not self.text.strip():
            raise ValueError("reply.text must not be blank")
        if self.source == "approved_line" and not (
            self.line_id and self.line_id.strip()
        ):
            raise ValueError("approved_line reply requires line_id")


@dataclass(frozen=True)
class SuggestHint:
    """힌트 버튼 표시 안내. Hint API 호출 · 해금이 아니다."""

    puzzle_id: str


@dataclass(frozen=True)
class NpcDialogueOutcome:
    """처리 결과. `reply`와 `no_reply_reason` 중 정확히 하나만 있다."""

    reply: NpcReply | None
    no_reply_reason: NoReplyReason | None
    suggest_hint: SuggestHint | None
    diagnosis: PuzzleQuestionDiagnosis
    # 개발 · 진단용: 고른 기본 안내 문구가 승인되지 않아 내보내지 못했을 때의 ID(원문 없음)
    unserved_line_id: str | None = None

    def __post_init__(self) -> None:
        if (self.reply is None) == (self.no_reply_reason is None):
            raise ValueError("exactly one of reply / no_reply_reason is required")
        if self.suggest_hint is not None and self.reply is None:
            raise ValueError("suggest_hint requires a reply")


def respond_to_player_message(
    message: str,
    *,
    case_id: str,
    state: Mapping[str, Any],
    client: CaseClientContent,
    runtime: PuzzleRuntimeDefinition,
    npc_pack: NpcContentPack | None,
    npc_id: str,
    line_source: NpcLineSource,
    hint_source: HintSource,
    puzzle_titles: Mapping[str, str] | None = None,
    generic_line_approval: GenericLineApproval | None = None,
    general_generator: GeneralGenerator | None = None,
    generation_enabled: bool = False,
) -> NpcDialogueOutcome:
    contexts = public_puzzle_contexts(
        client, runtime, state, puzzle_titles=puzzle_titles
    )
    diagnosis = classify_puzzle_question(message, contexts)

    if not diagnosis.is_puzzle_question:
        if generation_enabled:
            raise GeneralGenerationDisabledError()
        # general_generator는 받아도 부르지 않는다(기능 OFF).
        return NpcDialogueOutcome(None, "generation_disabled", None, diagnosis)

    puzzle_id = diagnosis.puzzle_id
    nudge = _revealed_approved_nudge(
        npc_pack, npc_id, puzzle_id, state, case_id, line_source
    )
    if nudge is not None:
        _ensure_no_protected_text(
            nudge.text, case_id, runtime, hint_source, allowed_puzzle_id=None
        )
        reply = NpcReply("approved_line", nudge.text, nudge.line_id)
        return NpcDialogueOutcome(reply, None, None, diagnosis)

    hint_target = (
        puzzle_id
        if puzzle_id is not None and _has_server_hint(case_id, puzzle_id, hint_source)
        else None
    )
    line_id = _select_generic_line(hint_target)
    if generic_line_approval is None or not generic_line_approval(line_id):
        return NpcDialogueOutcome(
            None,
            "generic_line_unapproved",
            None,
            diagnosis,
            unserved_line_id=line_id,
        )
    text = PM_GENERIC_PUZZLE_LINES[line_id]
    _ensure_no_protected_text(
        text, case_id, runtime, hint_source, allowed_puzzle_id=None
    )
    suggest = SuggestHint(hint_target) if hint_target is not None else None
    return NpcDialogueOutcome(
        NpcReply("approved_line", text, line_id), None, suggest, diagnosis
    )


def _select_generic_line(hint_target: str | None) -> str:
    # 임시 규칙(PM 미정): 힌트를 권할 대상이 하나면 02, 그 밖에는 01. 03은 쓰지 않는다.
    return GENERIC_WITH_HINT_SUGGESTION if hint_target else GENERIC_WITHOUT_TARGET


def _revealed_approved_nudge(
    pack: NpcContentPack | None,
    npc_id: str,
    puzzle_id: str | None,
    state: Mapping[str, Any],
    case_id: str,
    line_source: NpcLineSource,
) -> NpcNudgeContent | None:
    if pack is None or pack.npc_id != npc_id:
        return None
    if puzzle_id is None:
        candidates = pack.general_nudges
    else:
        candidates = next(
            (entry.nudges for entry in pack.puzzles if entry.puzzle_id == puzzle_id),
            [],
        )
    for nudge in candidates:
        if not is_revealed(nudge.reveal_when, state):
            continue
        # 승인 여부는 팩 파일이 아니라 line_source(검증된 게시 절차)로만 본다.
        line = line_source(case_id, npc_id, nudge.line_id)
        if (
            line is not None
            and line.approved
            and line.kind == "nudge"
            and line.line_id == nudge.line_id
            and line.text == nudge.text
            and (line.puzzle_id or None) == puzzle_id
        ):
            return nudge
    return None


def _has_server_hint(case_id: str, puzzle_id: str, hint_source: HintSource) -> bool:
    text = hint_source(case_id, puzzle_id, 1)
    return text is not None and bool(text.strip())
