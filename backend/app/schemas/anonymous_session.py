from datetime import datetime

from pydantic import BaseModel


# 익명 세션 생성 후 클라이언트에게 돌려줄 실제 데이터 구조
class AnonymousSessionData(BaseModel):
    # 새로 발급된 익명 세션의 UUID
    anonymous_session_id: str

    # 이 익명 세션이 만료되는 시각
    expires_at: datetime


# POST /api/v1/anonymous-sessions 의 최종 응답 구조
class AnonymousSessionCreateResponse(BaseModel):
    # 요청이 정상적으로 처리되었는지 나타내는 값
    success: bool

    # 실제 익명 세션 정보
    data: AnonymousSessionData
