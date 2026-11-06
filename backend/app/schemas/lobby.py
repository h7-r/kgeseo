from pydantic import BaseModel


class LobbyTicketResponse(BaseModel):
    """로비 입장권. 브라우저 메모리에만 두고 로비 매칭 인증 헤더로 보낸다(URL · 웹 저장소에 넣지 않는다)."""

    ticket: str
