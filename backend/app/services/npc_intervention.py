"""NPC 자동 개입 권한 v0.1 (PM v0.4.3, 라우터 미연결).

`intervention_level`은 NPC 판단층이 제안하는 **개입 강도**다. PlaySession `hint_levels`(정식 힌트 해금
상태, Hint API만 바꾼다)와 다른 값이며, 서로 바꿔 쓰거나 비교하지 않는다.

    0 = 개입 없음
    1 = 주의 환기
    2 = 방향 제시 또는 힌트 안내

가장 높은 단계에서도 자동 개입이 할 수 있는 것은 승인된 nudge 원문과 힌트 안내(`suggest_hint`, 버튼 표시)
까지다. 정식 힌트 원문 · 정답 공개 · Hint API 호출 · `hint_levels` 변경은 어느 단계에서도 허용하지 않는다.
힌트 재표시는 플레이어 요청 경로(`process_npc_request` 의 `hint_reshow`)만 쓴다.
"""

from typing import Literal

InterventionLevel = Literal[0, 1, 2]
AutoInterventionAction = Literal["nudge", "hint_guidance"]

_ALLOWED: dict[int, frozenset[AutoInterventionAction]] = {
    0: frozenset(),
    1: frozenset({"nudge"}),
    2: frozenset({"nudge", "hint_guidance"}),
}
# 어느 단계에서도 자동 개입으로는 하지 않는 것(문서 · 테스트용 목록)
NEVER_AUTO_ACTIONS = frozenset(
    {"hint_text", "hint_reshow", "hint_unlock", "answer_reveal", "hint_level_change"}
)


class InvalidInterventionLevelError(ValueError):
    pass


def allowed_auto_actions(
    intervention_level: int,
) -> frozenset[AutoInterventionAction]:
    # bool은 int의 하위형이라 따로 막는다.
    if isinstance(intervention_level, bool) or intervention_level not in _ALLOWED:
        raise InvalidInterventionLevelError("intervention_level must be 0, 1 or 2")
    return _ALLOWED[intervention_level]


def is_auto_action_allowed(intervention_level: int, action: str) -> bool:
    return action in allowed_auto_actions(intervention_level)
