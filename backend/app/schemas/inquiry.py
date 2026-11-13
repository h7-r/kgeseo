"""1:1 문의 요청 · 응답(관리자 API v0.3 3단계 P3-1). 시각은 다른 관리자 API 처럼 UTC naive ISO."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# 스키마는 services 를 가져오지 않는다(test_npc_content 규칙) — 이메일 형식은 라우터가 registration_input_policy 로 본다
MAX_EMAIL_LENGTH = 254

InquiryCategory = Literal["account", "gameplay", "payment", "tech", "other"]
InquiryStatus = Literal["open", "answered", "closed"]
InquiryPriority = Literal["normal", "urgent"]

TITLE_MAX = 100
BODY_MAX = 4000


def _not_blank(value: str, name: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError(f"{name} 은 비울 수 없다.")
    return stripped


class InquiryCreate(BaseModel):
    category: InquiryCategory
    title: str = Field(min_length=1, max_length=TITLE_MAX)
    body: str = Field(min_length=1, max_length=BODY_MAX)
    email: str = Field(min_length=3, max_length=MAX_EMAIL_LENGTH)

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        return _not_blank(value, "title")

    @field_validator("body")
    @classmethod
    def _body(cls, value: str) -> str:
        return _not_blank(value, "body")

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        return value.strip()


class InquiryCreated(BaseModel):
    id: str
    number: str
    created_at: datetime


class MyInquiryReply(BaseModel):
    body: str
    created_at: datetime


class MyInquiry(BaseModel):
    id: str
    number: str
    category: InquiryCategory
    title: str
    body: str
    status: InquiryStatus
    created_at: datetime
    answered_at: datetime | None
    replies: list[MyInquiryReply]


class MyInquiryList(BaseModel):
    items: list[MyInquiry]


# --- 관리자 ---


class AdminInquiryStats(BaseModel):
    total: int
    open: int
    today: int
    # 답변이 있는 문의의 (첫 답변 − 접수) 평균 시간. 없으면 null
    avg_first_reply_hours: float | None


class AdminInquiryListItem(BaseModel):
    id: str
    number: str
    title: str
    category: InquiryCategory
    status: InquiryStatus
    priority: InquiryPriority
    # 목록은 가림(1단계 규칙)
    email: str
    nickname: str | None
    user_id: str | None
    created_at: datetime
    answered_at: datetime | None
    reply_count: int


class AdminInquiryList(BaseModel):
    stats: AdminInquiryStats
    items: list[AdminInquiryListItem]
    next_offset: int | None


class AdminInquiryReply(BaseModel):
    id: str
    body: str
    created_at: datetime
    admin_user_id: str | None
    admin_nickname: str | None


class AdminInquiryDetail(BaseModel):
    id: str
    number: str
    title: str
    body: str
    category: InquiryCategory
    status: InquiryStatus
    priority: InquiryPriority
    # 상세는 전체 이메일(1단계 규칙)
    email: str
    nickname: str | None
    user_id: str | None
    # 서버가 확인한 요청 IP 의 앞 두 자리(`203.0.*.*`). 없으면 null
    client_ip_display: str | None
    created_at: datetime
    updated_at: datetime
    answered_at: datetime | None
    replies: list[AdminInquiryReply]


class InquiryReplyCreate(BaseModel):
    body: str = Field(min_length=1, max_length=BODY_MAX)

    @field_validator("body")
    @classmethod
    def _body(cls, value: str) -> str:
        return _not_blank(value, "body")


class InquiryPatch(BaseModel):
    status: InquiryStatus | None = None
    priority: InquiryPriority | None = None
