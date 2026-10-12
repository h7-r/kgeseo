from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

# 익명 세션 Router
from app.api.v1.anonymous_sessions import (
    router as anonymous_sessions_router,
)
from app.api.v1.auth import router as auth_router
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
