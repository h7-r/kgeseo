"""1:1 문의 공개 접수(관리자 API v0.3 3단계 P3-1, 해랑 11/13).

- 로그인 없이도 접수된다. 로그인 쿠키가 있으면 `app_user_id` 를 채워 마이페이지 「내 문의」에서 답변을 볼 수 있다.
- 비회원 접수는 서버에 메일 발송 수단이 없어 운영팀이 입력한 이메일로 따로 답한다(화면이 접수 전에 안내한다 — 세진 ②).
- 요청 빈도 제한: IP 당 `rate_limit_inquiry_window_sec`(기본 600초) 안 `rate_limit_inquiry_create`(기본 5)건.
- 첨부는 없다(파일 저장소가 없다).
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import error_responses
from app.db.session import get_db
from app.models.app_user import AppUser
from app.schemas.inquiry import InquiryCreate, InquiryCreated
from app.services.inquiry import create_inquiry
from app.services.registration_input_policy import (
    InvalidEmailError,
    validate_registration_email,
)
from app.services.request_rate_limit import (
    INQUIRY_CREATE,
    SlidingWindowLimiter,
    client_ip,
    enforce_rate_limit,
    get_request_rate_limiter,
)
from app.services.user_session import optional_current_user, require_same_origin

router = APIRouter(
    prefix="/inquiries", tags=["Inquiries"], dependencies=[Depends(require_same_origin)]
)


@router.post(
    "",
    response_model=InquiryCreated,
    status_code=status.HTTP_201_CREATED,
    responses=error_responses.INQUIRY_CREATE,
)
async def create_inquiry_endpoint(
    payload: InquiryCreate,
    request: Request,
    response: Response,
    user: AppUser | None = Depends(optional_current_user),
    db: AsyncSession = Depends(get_db),
    limiter: SlidingWindowLimiter = Depends(get_request_rate_limiter),
) -> InquiryCreated:
    response.headers["Cache-Control"] = "no-store"
    try:
        validate_registration_email(payload.email)
    except InvalidEmailError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "invalid_email",
                "message": "답변 받을 이메일 형식이 아니다.",
            },
            headers={"Cache-Control": "no-store"},
        ) from None
    enforce_rate_limit(limiter, INQUIRY_CREATE, request)
    row = await create_inquiry(
        db,
        category=payload.category,
        title=payload.title,
        body=payload.body,
        email=payload.email,
        app_user_id=user.id if user else None,
        client_ip=client_ip(request),
    )
    return InquiryCreated(id=row.id, number=row.number or "", created_at=row.created_at)
