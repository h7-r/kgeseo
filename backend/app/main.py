from contextlib import asynccontextmanager

from fastapi import FastAPI

# 익명 세션 Router
from app.api.v1.anonymous_sessions import (
    router as anonymous_sessions_router,
)
from app.api.v1.auth import router as auth_router
from app.api.v1.cases import router as cases_router
from app.api.v1.health import router as health_router
from app.api.v1.hints import router as hints_router
from app.api.v1.interactions import router as interactions_router
from app.api.v1.npc import router as npc_router

# 플레이 세션 Router
from app.api.v1.play_sessions import (
    router as play_sessions_router,
)
from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.services.content_release import restore_on_startup
from app.services.session_content import get_pinned_content_store


@asynccontextmanager
async def lifespan(app: FastAPI):
    # DB 게시 상태와 게시 루트의 원본으로 세션 콘텐츠 저장소를 다시 채운다(설정이 없으면 하지 않는다).
    await restore_on_startup(
        settings.published_content_root, AsyncSessionLocal, get_pinned_content_store()
    )
    yield


# FastAPI 애플리케이션 생성
app = FastAPI(
    title="왜곡 Backend API",
    version="0.1.0",
    lifespan=lifespan,
)


# 자동화된 프로세스 상태 확인용 API 등록
app.include_router(
    health_router,
    prefix="/api/v1",
)


# Google 계정 로그인 API 등록
app.include_router(
    auth_router,
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


# NPC 턴 API 등록 (PM v0.4.3 · 일반 대화 생성 OFF · 승인 이력 없으면 대사 없음)
#
# 최종 경로:
# /api/v1/play-sessions/{play_session_id}/npc/turns
app.include_router(
    npc_router,
    prefix="/api/v1",
)


# 정식 Hint API 등록 (PM v0.4.8 · v0.4.9: 힌트 잔액 · 원자적 차감. LLM 표현 생성 없음)
#
# 최종 경로:
# /api/v1/play-sessions/{play_session_id}/puzzles/{puzzle_id}/hints
app.include_router(
    hints_router,
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
