from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.health import HealthResponse, ReadinessResponse
from app.services.health import ReadinessCheckError, check_database_readiness

router = APIRouter(
    prefix="/health",
    tags=["Health"],
)


@router.get("", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/ready", response_model=ReadinessResponse)
async def get_readiness(
    db: AsyncSession = Depends(get_db),
) -> ReadinessResponse:
    try:
        await check_database_readiness(db)
    except ReadinessCheckError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is not ready.",
        ) from error

    return ReadinessResponse(status="ready")
