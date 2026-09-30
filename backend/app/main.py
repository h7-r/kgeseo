from fastapi import FastAPI

# 익명 세션 Router
from app.api.v1.anonymous_sessions import (
    router as anonymous_sessions_router,
)
from app.api.v1.cases import router as cases_router
from app.api.v1.health import router as health_router
from app.api.v1.interactions import router as interactions_router

# 플레이 세션 Router
from app.api.v1.play_sessions import (
    router as play_sessions_router,
)

# FastAPI 애플리케이션 생성
app = FastAPI(
    title="왜곡 Backend API",
    version="0.1.0",
)


# 자동화된 프로세스 상태 확인용 API 등록
app.include_router(
    health_router,
    prefix="/api/v1",
)


# 익명 세션 API 등록
#
# 최종 경로:
# /api/v1/anonymous-sessions
app.include_router(
    anonymous_sessions_router,
    prefix="/api/v1",
)


# 플레이 세션 API 등록
#
# 최종 경로:
# /api/v1/play-sessions
app.include_router(
    play_sessions_router,
    prefix="/api/v1",
)


# 게임 Interaction API 등록
#
# 최종 경로:
# /api/v1/play-sessions/{play_session_id}/interactions
app.include_router(
    interactions_router,
    prefix="/api/v1",
)


# Frontend 공개용 정적 Case Bundle API 등록
#
# 최종 경로:
# /api/v1/cases/{case_id}/bundle
app.include_router(
    cases_router,
    prefix="/api/v1",
)


# 서버 기본 동작 확인용 API
@app.get("/")
async def root():
    return {"message": "왜곡 Backend API is running"}
