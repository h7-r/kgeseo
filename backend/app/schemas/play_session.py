from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# POST /api/v1/play-sessions 요청 Body
class PlaySessionCreateRequest(BaseModel):
    # 어떤 익명 사용자가 게임을 시작하는지 식별한다.
    anonymous_session_id: str

    # 어떤 사건(Case)을 시작하는지 나타낸다.
    #
    # 현재는 cases 테이블이 아직 없기 때문에
    # 문자열 ID 형태로 전달받는다.
    case_id: str = Field(min_length=1, max_length=64)


# 플레이 진행 상태를 API에서 표현하는 구조
class PlaySessionState(BaseModel):
    # 현재 위치. 과거 state_json에는 이 key가 없을 수 있다.
    current_zone_id: str | None = None

    # 완료한 퍼즐 ID 목록
    completed_puzzle_ids: list[str]

    # 현재까지 획득한 단서 ID 목록
    acquired_clue_ids: list[str]

    # 퍼즐별 힌트 열람 단계
    #
    # 예:
    # {
    #   "puzzle_01": 1,
    #   "puzzle_02": 0
    # }
    hint_levels: dict[str, int]

    # 퍼즐별 실제 채점 횟수. 과거 state_json에는 이 key가 없을 수 있다.
    attempt_counts: dict[str, int] = Field(default_factory=dict)

    # 게임 진행 중 필요한 기타 상태값
    #
    # 예:
    # {
    #   "archive_unlocked": true
    # }
    flags: dict[str, Any]


# 생성된 PlaySession의 실제 응답 데이터
class PlaySessionData(BaseModel):
    # 새로 생성된 플레이 세션 UUID
    play_session_id: str

    # 플레이 중인 사건 ID
    case_id: str

    # 플레이를 시작한 시각
    created_at: datetime

    # 현재 게임 진행 상태
    state: PlaySessionState


# POST /api/v1/play-sessions 최종 응답 구조
class PlaySessionCreateResponse(BaseModel):
    # 요청 처리 성공 여부
    success: bool

    # 생성된 PlaySession 정보
    data: PlaySessionData


# 저장된 PlaySession을 다시 조회할 때 반환할 데이터 구조
class PlaySessionReadData(BaseModel):
    play_session_id: str
    case_id: str
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    state: PlaySessionState


# GET /api/v1/play-sessions/{play_session_id} 최종 응답 구조
class PlaySessionReadResponse(BaseModel):
    success: bool
    data: PlaySessionReadData
