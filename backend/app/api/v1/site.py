"""사이트 공개 상태(관리자 API v0.3 3단계 P3-2 (b) 점검 적용, 해랑 11/13).

`GET /api/v1/site/status` — 인증 없음 · 기록 없음. 웹사이트가 처음 뜰 때 읽어 `maintenance.on` 이면 `/maintenance` 로 보낸다.
관리자 주소(`/admin`)는 예외(점검을 끌 수 있어야 한다). 게임(play) · API 는 이번에 안 막는다(미르 11/13 — 플레이 경로 안 건드림).
`social.google` · `social.naver` 는 소셜 로그인이 서버에 설정돼 있는지만(11/18, 계약 docs/contracts/account_me_v0.1.md §3).
"""

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.schemas.admin_setting import SiteMaintenance, SiteSocial, SiteStatus
from app.services.admin_settings import read_maintenance
from app.services.google_auth import google_auth_configured
from app.services.naver_auth import naver_auth_configured

router = APIRouter(prefix="/site", tags=["Site"])


def social_readiness() -> SiteSocial:
    """소셜 로그인 준비 여부 — 로그인 API 가 503 을 내는 바로 그 판정을 미리 알려 준다. 값은 싣지 않는다."""
    return SiteSocial(
        google=google_auth_configured(settings.google_client_id),
        naver=naver_auth_configured(
            settings.naver_client_id,
            settings.naver_client_secret,
            settings.naver_redirect_uri,
        ),
    )


@router.get("/status", response_model=SiteStatus)
async def site_status(
    response: Response, db: AsyncSession = Depends(get_db)
) -> SiteStatus:
    response.headers["Cache-Control"] = "no-store"
    value = await read_maintenance(db)
    return SiteStatus(
        maintenance=SiteMaintenance(on=value.on, message=value.message),
        social=social_readiness(),
    )
