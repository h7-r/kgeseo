"""로비 입장권 발급 API(로비 설계 v0.19 2 · 2.1 · 2.2 · 3절).

`POST /api/v1/lobby/ticket` — 로그인한 모집 참가자에게 짧게 유효한 입장권을 준다. 응답별 화면 처리는 설계 2절 표:
200 로비 입장 시도 · 401 게스트(혼자) · 403 명단에 없음 또는 다른 출처(이번 방문 재시도 없음) ·
429 `Retry-After` 뒤 재시도 · 503 로비 중단 · 발급 불가(일시적 실패 규칙).

머리 위에 뜨는 이름은 서버 DB 에 저장된 값만 쓴다(2.2절). 캐릭터를 만든 계정은 **조사관명**
(`user_characters.display_name`), 아직 없거나 공개 이름 규칙에 맞지 않으면 계정 닉네임(가입 때 닉네임 규칙을
이미 통과한 값). 브라우저가 보낸 이름은 쓰지 않는다.
"""

import re
import unicodedata

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import error_responses
from app.db.session import get_db
from app.models.account_data import UserCharacter
from app.models.app_user import AppUser
from app.schemas.lobby import LobbyTicketResponse
from app.services.lobby_config import LobbyIssuerState, get_lobby_issuer_state
from app.services.lobby_ticket import (
    BetaListUnavailable,
    IssueRateLimiter,
    get_beta_list,
    get_issue_rate_limiter,
    issue_ticket,
)
from app.services.nickname_policy import LEET, RESERVED, forbidden_terms_in
from app.services.user_session import current_user, require_same_origin

router = APIRouter(
    prefix="/lobby", tags=["Lobby"], dependencies=[Depends(require_same_origin)]
)

NO_STORE = {"Cache-Control": "no-store"}

# 캐릭터 생성 화면 규칙과 같다(naju01/src/characterCreation/nameRules.ts DEFAULT_NAME_RULES):
# 2~12자, 한글·영문·숫자, 낱말 사이 한 칸 공백. 저장 API(PUT /me/character)는 길이만 보므로 여기서 다시 본다.
INVESTIGATOR_NAME = re.compile(
    r"[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9]+( [가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9]+)*"
)


def public_investigator_name(raw: str) -> str | None:
    """남에게 보여도 되는 조사관명이면 정규화한 이름, 아니면 None.

    제어·보이지 않는 문자(유니코드 C 분류), 형식·길이, 닉네임과 같은 예약어(운영자 등)·금칙어를 거른다.
    """
    if any(unicodedata.category(c).startswith("C") for c in raw):
        return None
    name = re.sub(r"\s+", " ", unicodedata.normalize("NFC", raw).strip())
    if not 2 <= len(name) <= 12 or INVESTIGATOR_NAME.fullmatch(name) is None:
        return None
    key = name.casefold().replace(" ", "")
    if {key, key.translate(LEET), key.rstrip("0123456789")} & RESERVED:
        return None
    if forbidden_terms_in(name.replace(" ", "")):
        return None
    return name


async def lobby_display_name(db: AsyncSession, user: AppUser) -> str:
    """조사관명(캐릭터 이름)이 공개 이름 규칙에 맞으면 그것, 아니면 계정 닉네임."""
    character = await db.get(UserCharacter, user.id)
    name = public_investigator_name(character.display_name) if character else None
    return name or user.nickname


@router.post(
    "/ticket",
    response_model=LobbyTicketResponse,
    responses=error_responses.LOBBY_TICKET,
)
async def issue_lobby_ticket(
    request: Request,
    response: Response,
    user: AppUser = Depends(current_user),
    state: LobbyIssuerState = Depends(get_lobby_issuer_state),
    limiter: IssueRateLimiter = Depends(get_issue_rate_limiter),
    db: AsyncSession = Depends(get_db),
) -> LobbyTicketResponse:
    response.headers["Cache-Control"] = "no-store"
    config = state.config
    if config is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Lobby is unavailable.",
            headers=NO_STORE,
        )
    try:
        membership = get_beta_list(config.beta_list_path).lookup(user.id)
    except BetaListUnavailable:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Lobby is unavailable.",
            headers=NO_STORE,
        ) from None
    if not membership.eligible:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Not on the lobby beta list.",
            headers=NO_STORE,
        )
    # Uvicorn 이 판별한 주소만 쓴다. 요청이 가져온 X-Forwarded-For 원문은 쓰지 않는다(2.2절 IP 판별)
    ip = request.client.host if request.client else "unknown"
    ip_exempt = config.loadtest_ip_exempt and membership.loadtest
    retry_after = limiter.try_acquire(user.id, ip, ip_exempt=ip_exempt)
    if retry_after:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many lobby ticket requests.",
            headers={**NO_STORE, "Retry-After": str(retry_after)},
        )
    # 발급 제한을 통과한 요청만 DB 를 한 번 더 읽는다
    name = await lobby_display_name(db, user)
    return LobbyTicketResponse(ticket=issue_ticket(config, user.id, name))
