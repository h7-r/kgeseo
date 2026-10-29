from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.interaction import HintLevelChangedStateChange
from app.schemas.play_session import PlaySessionState

# 0 = 미열람, 1 = 힌트 보기, 2 = 정답 보기 (Puzzle Contract v0.3.1 §7)
HintLevel = Literal[1, 2]
MAX_HINT_LEVEL = 2

HintUnlockResultType = Literal["hint_unlocked", "already_unlocked"]


class HintUnlockRequest(BaseModel):
    client_event_id: str
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
