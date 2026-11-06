from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from app.api.v1.admin import router as admin_router

# 익명 세션 Router
from app.api.v1.anonymous_sessions import (
    router as anonymous_sessions_router,
)
from app.api.v1.auth import router as auth_router
from app.api.v1.cases import router as cases_router
from app.api.v1.health import router as health_router
from app.api.v1.hints import router as hints_router
from app.api.v1.interactions import router as interactions_router
from app.api.v1.lobby import router as lobby_router
from app.api.v1.me import router as me_router
from app.api.v1.npc import router as npc_router

# 플레이 세션 Router
from app.api.v1.play_sessions import (
    router as play_sessions_router,
)
from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.services.content_release import restore_on_startup
from app.services.lobby_config import get_lobby_issuer_state
from app.services.session_content import get_pinned_content_store


@asynccontextmanager
async def lifespan(app: FastAPI):
    # DB 게시 상태와 게시 루트의 원본으로 세션 콘텐츠 저장소를 다시 채운다(설정이 없으면 하지 않는다).
    await restore_on_startup(
        settings.published_content_root, AsyncSessionLocal, get_pinned_content_store()
    )
    # 로비 입장권 발급 설정을 읽어 결과(활성 여부 · 실패 항목)를 로그에 남긴다. 실패해도 본편은 그대로 뜬다.
    get_lobby_issuer_state()
    yield


# FastAPI 애플리케이션 생성
app = FastAPI(
    title="왜곡 Backend API",
    version="0.1.0",
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
    # 로비 입장권 429 의 다음 발급까지 남은 초를 게임 화면이 읽을 수 있게 한다(로비 설계 2.2절)
    expose_headers=["Retry-After"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


FIELD_ERRORS = {
    "email": ("invalid_email", "올바른 이메일 형식이 아닙니다."),
    "password": ("invalid_password", "비밀번호 형식을 확인해 주세요."),
    "nickname": ("invalid_nickname", "사용할 수 없는 닉네임입니다."),
}
# Routes whose validation errors never echo inputs, with fields checked in order.
SENSITIVE_INPUT_FIELDS = {
    "/api/v1/auth/register": ("email", "password", "nickname"),
    "/api/v1/auth/login": ("email", "password"),
    "/api/v1/auth/social-onboarding/complete": ("nickname",),
}


@app.exception_handler(RequestValidationError)
async def sensitive_input_validation_error(
    request: Request, error: RequestValidationError
):
    checked_fields = SENSITIVE_INPUT_FIELDS.get(request.url.path)
    if request.method != "POST" or checked_fields is None:
        return await request_validation_exception_handler(request, error)
    # Pydantic errors can contain submitted passwords or onboarding proofs.
    fields = {item["loc"][1] for item in error.errors() if len(item["loc"]) > 1}
    code, message = next(
        (FIELD_ERRORS[field] for field in checked_fields if field in fields),
        ("invalid_input", "입력값을 다시 확인해 주세요."),
    )
    return JSONResponse(
        status_code=422,
        content={"detail": {"code": code, "message": message}},
        headers={"Cache-Control": "no-store"},
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


# 로그인한 사용자 자신의 데이터 · 관리자 조회 API 등록
app.include_router(
    me_router,
    prefix="/api/v1",
)
app.include_router(
    admin_router,
    prefix="/api/v1",
)


# 로비 입장권 발급 API 등록
#
# 최종 경로:
# /api/v1/lobby/ticket
app.include_router(
    lobby_router,
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
