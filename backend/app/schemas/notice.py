"""공지사항 요청 · 응답(11/16 세진, 계약 `docs/contracts/notices_api_v0.2.md`).

- 응답 시각은 다른 API 처럼 UTC naive ISO(`2026-11-16T01:00:00`, 끝에 Z 없음).
- 요청의 `published_at` 은 **timezone 이 반드시 있어야 한다**(`Z` · `+09:00` 등). 없으면 422. 서버가 UTC naive 로 바꿔 저장한다.
- 상태(`status`)는 요청으로 받지 않는다 — 서버가 `published_at` 과 지금 시각으로 계산한다. 모르는 필드는 422.
"""

from datetime import datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator

# 스키마는 models 의 상수와 같은 값을 쓴다(값을 바꿀 때 함께 바꾼다 — test_notices 가 대조한다)
NoticeCategory = Literal["maintenance", "event", "update", "info"]
NoticeStatus = Literal["draft", "scheduled", "published"]

TITLE_MAX = 200
BODY_MAX = 20_000


def _not_blank(value: str, name: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError(f"{name} 은 비울 수 없다.")
    return stripped


class NoticeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: NoticeCategory
    title: str = Field(min_length=1, max_length=TITLE_MAX)
    body: str = Field(min_length=1, max_length=BODY_MAX)
    is_pinned: bool = False
    # 없으면(null) 초안. 지금보다 뒤면 예약, 지금이거나 앞이면 게시
    published_at: AwareDatetime | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        return _not_blank(value, "title")

    @field_validator("body")
    @classmethod
    def _body(cls, value: str) -> str:
        return _not_blank(value, "body")


class NoticeUpdate(BaseModel):
    """보낸 필드만 바꾼다. `published_at: null` 을 보내면 초안으로 되돌린다(보내지 않으면 그대로).
    category · title · body · is_pinned 에 null 은 안 된다."""

    model_config = ConfigDict(extra="forbid")

    category: NoticeCategory | None = None
    title: str | None = Field(default=None, min_length=1, max_length=TITLE_MAX)
    body: str | None = Field(default=None, min_length=1, max_length=BODY_MAX)
    is_pinned: bool | None = None
    published_at: AwareDatetime | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("title 은 null 일 수 없다.")
        return _not_blank(value, "title")

    @field_validator("body")
    @classmethod
    def _body(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("body 는 null 일 수 없다.")
        return _not_blank(value, "body")

    @field_validator("category", "is_pinned", mode="before")
    @classmethod
    def _no_null(cls, value):
        if value is None:
            raise ValueError("null 일 수 없다.")
        return value


# --- 공개 ---


class PublicNoticeItem(BaseModel):
    id: str
    category: NoticeCategory
    title: str
    is_pinned: bool
    published_at: datetime


class PublicNoticeDetail(PublicNoticeItem):
    body: str
    updated_at: datetime


class PublicNoticeList(BaseModel):
    items: list[PublicNoticeItem]
    page: int
    page_size: int
    total: int
    total_pages: int


# --- 관리자 ---


class NoticeAuthor(BaseModel):
    user_id: str
    # 회원이 사라졌으면 null
    nickname: str | None


class AdminNoticeItem(BaseModel):
    id: str
    category: NoticeCategory
    title: str
    is_pinned: bool
    status: NoticeStatus
    published_at: datetime | None
    # 만든 관리자 — 그 회원이 지워졌으면(FK SET NULL) null
    created_by: NoticeAuthor | None
    created_at: datetime
    updated_at: datetime


class AdminNotice(AdminNoticeItem):
    body: str


class AdminNoticeList(BaseModel):
    items: list[AdminNoticeItem]
    next_offset: int | None
