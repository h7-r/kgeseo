from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.interaction import HintLevelChangedStateChange
from app.schemas.play_session import PlaySessionState

# 0 = 미열람, 1 = 힌트 보기, 2 = 정답 보기 (Puzzle Contract v0.3.1 §7)
HintLevel = Literal[1, 2]
MAX_HINT_LEVEL = 2

HintUnlockResultType = Literal["hint_unlocked", "already_unlocked"]


class HintUnlockRequest(BaseModel):
    # interaction_events.client_event_id(CHAR(36))에 저장한다.
    client_event_id: str = Field(min_length=1, max_length=36)
    client_timestamp: datetime | None = None
    target_level: HintLevel


class HintUnlockResult(BaseModel):
    """이벤트 response_json에 저장하는 해금 결과. 힌트 원문은 담지 않는다."""

    result_type: HintUnlockResultType
    puzzle_id: str
    # 처리 후 이 퍼즐의 힌트 단계
    hint_level: int
    state: PlaySessionState
    state_changes: list[HintLevelChangedStateChange]
    # 처리 후 이 회차의 힌트 잔액 · 도움 사용 수(PM v0.4.8 §3). 재전송은 처음 응답 값을 그대로 준다.
    hint_balance: int
    help_used: int


class HintText(BaseModel):
    level: HintLevel
    text: str


class HintUnlockProcessResult(BaseModel):
    interaction_id: str
    result: HintUnlockResult
    # 요청한 단계의 원문. 저장하지 않고 응답할 때마다 힌트 원본에서 읽는다.
    hint: HintText


class PuzzleHintState(BaseModel):
    puzzle_id: str
    hint_level: int
    # 해금한 단계의 원문만 담는다.
    unlocked: list[HintText]
