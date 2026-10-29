from pydantic import BaseModel

from app.schemas.puzzle_runtime import ClueCarrierKind


# 획득한 단서 하나의 공개 표시 정보
#
# Server 단서 정의를 그대로 직렬화하지 않고 공개할 필드만 옮겨 담는다.
# 단서 정의가 없는 콘텐츠에서는 title/summary/body/carrier_kind가 null이다.
class PlaySessionClue(BaseModel):
    clue_id: str
    title: str | None
    summary: str | None
    body: str | None
    carrier_kind: ClueCarrierKind | None


class PlaySessionCluesData(BaseModel):
    play_session_id: str

    # 획득한 순서(acquired_clue_ids 순서)
    clues: list[PlaySessionClue]


# GET /api/v1/play-sessions/{play_session_id}/clues 최종 응답 구조
class PlaySessionCluesResponse(BaseModel):
    success: bool
    data: PlaySessionCluesData
