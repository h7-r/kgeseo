"""사이트 공개 상태(관리자 API v0.3 3단계 P3-2 (b) 점검 적용, 해랑 11/13).

`GET /api/v1/site/status` — 인증 없음 · 기록 없음. 웹사이트가 처음 뜰 때 읽어 `maintenance.on` 이면 `/maintenance` 로 보낸다.
관리자 주소(`/admin`)는 예외(점검을 끌 수 있어야 한다). 게임(play) · API 는 이번에 안 막는다(미르 11/13 — 플레이 경로 안 건드림).
"""

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.admin_setting import SiteMaintenance, SiteStatus
from app.services.admin_settings import read_maintenance

router = APIRouter(prefix="/site", tags=["Site"])


@router.get("/status", response_model=SiteStatus)
async def site_status(
    response: Response, db: AsyncSession = Depends(get_db)
) -> SiteStatus:
    response.headers["Cache-Control"] = "no-store"
    value = await read_maintenance(db)
    return SiteStatus(maintenance=SiteMaintenance(on=value.on, message=value.message))
