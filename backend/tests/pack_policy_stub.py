"""테스트 전용 일반 팩 정책 검사(가상). 운영 기본값이 아니다.

PM v0.4.13: 일반 팩은 G3 승인 + 정책 검사 통과일 때만 쓴다. 정책 검사 기준은 미정이라 운영 기본값
(`DEFAULT_DIALOGUE_PACK_POLICY`)은 늘 UNVERIFIED다. 승인 · 공급 · 선택 로직을 시험하는 테스트만 이 통과 검사를
명시적으로 넘긴다(정책 검사의 실제 기준을 뜻하지 않는다).
"""

from app.schemas.npc_content import GeneralLinePack
from app.services.dialogue_pack_policy import PackPolicyResult

TEST_ONLY_PASS = PackPolicyResult("PASS", "test_only_pass")


def passing_test_policy(pack: GeneralLinePack) -> PackPolicyResult:
    return TEST_ONLY_PASS
