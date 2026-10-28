"""AI 일반 대화 처리 흐름 v0.1 (PM v0.4.3, 순수 함수 · 라우터 미연결 · 실제 LLM 연결 없음).

    model_context → 생성기 1회 → 정책 검사 → 통과: reply.source = "generated"
                                         → 실패: 생성 문장 폐기 · 재생성 없음
                                                → 승인된 fallback_lines → 승인된 일반 팩 대사 → 발화 없음

[승인] fallback_lines · 일반 팩 대사의 승인 · 버전 관리는 아직 BE 에 없다. 그래서 이 모듈은 파일이나 승인 기록을
만들지 않고, 검증된 게시 절차가 넘기는 공급자(`ApprovedLineProvider`)만 쓴다. `approved=True` 인 줄만 쓴다.

[기록] 결과에는 생성 여부 · 정책 검사 결과(code · rule_id) · 대체 경로만 남긴다. 차단된 생성 문장은 어디에도
남기지 않는다(반환값 · 예외 메시지 포함).
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.hint import HintSource
from app.services.npc import NpcContentUnsafeError, _ensure_no_protected_text
from app.services.npc_generation_policy import (
    PolicyCheckResult,
    PolicyRules,
    check_generated_line,
)
from app.services.npc_model_context import ModelContext

# model_context.to_model_input() → 생성 문장. 실제 LLM 연결은 이번 단계에 없다.
ModelGenerator = Callable[[dict[str, Any]], str]
FallbackKind = Literal["fallback_line", "general_pack_line"]
GeneralNoReplyReason = Literal[
    "policy_blocked_no_fallback", "generation_failed_no_fallback"
]


@dataclass(frozen=True)
class ApprovedLine:
    line_id: str
    text: str
    approved: bool


ApprovedLineProvider = Callable[[], Sequence[ApprovedLine]]


@dataclass(frozen=True)
class GeneralDialogueResult:
    # 보여 줄 문장(생성 통과 문장 또는 승인 대체 대사). 없으면 None.
    text: str | None
    # 대체 대사일 때 line_id
    line_id: str | None
    generated: bool
    fallback: FallbackKind | None
    no_reply_reason: GeneralNoReplyReason | None
    # 생성 문장의 정책 검사 결과. 생성에 실패했으면 None.
    policy: PolicyCheckResult | None


def generate_general_reply(
    context: ModelContext,
    *,
    generator: ModelGenerator,
    case_id: str,
    runtime: PuzzleRuntimeDefinition,
    state: Mapping[str, Any],
    hint_source: HintSource,
    rules: PolicyRules,
    fallback_lines: ApprovedLineProvider | None = None,
    general_pack_lines: ApprovedLineProvider | None = None,
) -> GeneralDialogueResult:
    try:
        draft = generator(context.to_model_input())
    except Exception:
        # 생성기 오류 내용은 남기지 않는다(원문이 섞일 수 있다).
        draft = None

    if draft is None or not draft.strip():
        policy = None
        reason: GeneralNoReplyReason = "generation_failed_no_fallback"
    else:
        policy = check_generated_line(
            draft,
            case_id=case_id,
            runtime=runtime,
            state=state,
            hint_source=hint_source,
            rules=rules,
            public_texts=context.public_texts(),
        )
        if policy.passed:
            return GeneralDialogueResult(draft, None, True, None, None, policy)
        reason = "policy_blocked_no_fallback"
    # 여기서부터 draft 는 쓰지 않는다(폐기 · 재생성 없음).
    del draft

    for kind, provider in (
        ("fallback_line", fallback_lines),
        ("general_pack_line", general_pack_lines),
    ):
        line = _first_approved(provider, case_id, runtime, hint_source)
        if line is not None:
            return GeneralDialogueResult(
                line.text, line.line_id, False, kind, None, policy
            )
    return GeneralDialogueResult(None, None, False, None, reason, policy)


def _first_approved(
    provider: ApprovedLineProvider | None,
    case_id: str,
    runtime: PuzzleRuntimeDefinition,
    hint_source: HintSource,
) -> ApprovedLine | None:
    if provider is None:
        return None
    for line in provider():
        if not (line.approved and line.line_id.strip() and line.text.strip()):
            continue
        try:
            # 승인된 대사도 정답 · 힌트 원문이 섞였으면 쓰지 않는다(nudge 와 같은 검사).
            _ensure_no_protected_text(
                line.text, case_id, runtime, hint_source, allowed_puzzle_id=None
            )
        except NpcContentUnsafeError:
            continue
        return line
    return None
