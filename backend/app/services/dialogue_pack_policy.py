"""일반 대사 팩(dialogue_pack) 정책 검사 단계 v0.1 (PM v0.4.6 §4 · v0.4.13 §1, 기준 미정 · fail closed).

PM 계약: 일반 대사 팩의 사용 조건은 「G3 승인 + 정책 검사 통과」다. 두 조건은 따로 판정 · 표시한다.

- G3 승인: 승인 이력(`npc_approval_reviews`)의 `(dialogue_pack, pack_id, pack_version)` 기록을
  `gate_decisions(required=REQUIRED_GATES["dialogue_pack"])`로 판정한다. 정책 검사가 미정이어도 기록 · 조회할 수 있다.
- 정책 검사: 이 모듈. **구체 기준이 PM 확정 전이다**(v0.4.5 §4 원문 미확인, v0.4.6 · v0.4.13은 이름만 정함).
  그래서 기본 검사(`undefined_dialogue_pack_policy`)는 늘 `UNVERIFIED`를 돌려주고, 일반 팩은 쓰이지 않는다
  (G3 승인이 있어도 `reply: null`).
- 기존 NPC 출력 검사(`npc_generation_policy`, `_ensure_no_protected_text`)는 케이스 하나의 AI 생성 문장 · 승인 대사
  검사다. 일반 팩의 정책 검사로 간주하지 않는다.

검사 함수는 `GeneralLinePack`을 받아 `PackPolicyResult`를 돌려준다. 예외 · 다른 형식의 결과는 `UNVERIFIED`(fail closed).
테스트는 테스트 안에서 만든 검사 함수를 명시적으로 넘긴다(운영 기본값을 바꾸지 않는다).
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from app.schemas.npc_content import GeneralLinePack

PolicyStatus = Literal["PASS", "FAIL", "UNVERIFIED"]


@dataclass(frozen=True)
class PackPolicyResult:
    status: PolicyStatus
    # 이유 코드만(대사 원문을 싣지 않는다)
    reason: str

    @property
    def passed(self) -> bool:
        return self.status == "PASS"


DialoguePackPolicy = Callable[[GeneralLinePack], PackPolicyResult]

POLICY_UNDEFINED = PackPolicyResult("UNVERIFIED", "policy_undefined")


def undefined_dialogue_pack_policy(pack: GeneralLinePack) -> PackPolicyResult:
    """운영 기본값. 정책 검사 기준이 정해지기 전에는 어떤 팩도 통과시키지 않는다."""

    return POLICY_UNDEFINED


DEFAULT_DIALOGUE_PACK_POLICY: DialoguePackPolicy = undefined_dialogue_pack_policy


def run_dialogue_pack_policy(
    policy: DialoguePackPolicy, pack: GeneralLinePack
) -> PackPolicyResult:
    try:
        result = policy(pack)
    except Exception:
        return PackPolicyResult("UNVERIFIED", "policy_error")
    if not isinstance(result, PackPolicyResult) or result.status not in (
        "PASS",
        "FAIL",
        "UNVERIFIED",
    ):
        return PackPolicyResult("UNVERIFIED", "invalid_policy_result")
    return result
