"""공지사항 상태 · 공개 조건 · 정렬(11/16 세진, 계약 `docs/contracts/notices_api_v0.2.md`).

상태는 저장하지 않고 계산한다(`now` 는 UTC naive):
- draft     — published_at 이 없다
- scheduled — published_at > now
- published — published_at <= now
삭제(deleted_at)된 공지는 어떤 상태로도 보이지 않는다(관리자 목록 · 상세도 404 취급, 복구 없음).
그래서 예약 공지는 별도 작업 없이 시각이 지나면 그 순간부터 게시로 바뀐다.
"""

from datetime import UTC, datetime

from sqlalchemy import and_

from app.models.notice import Notice


def to_utc_naive(value: datetime | None) -> datetime | None:
    """timezone 이 있는 시각을 UTC naive 로(저장 형식). 스키마가 timezone 없는 값을 이미 막는다."""

    if value is None:
        return None
    if value.tzinfo is None:
        raise ValueError("published_at must include a timezone.")
    return value.astimezone(UTC).replace(tzinfo=None)


def notice_status(published_at: datetime | None, now: datetime) -> str:
    if published_at is None:
        return "draft"
    return "scheduled" if published_at > now else "published"


def not_deleted():
    return Notice.deleted_at.is_(None)


def public_condition(now: datetime):
    """공개 목록 · 상세에 보이는 공지 — 삭제 안 됨 · 게시 시각 있음 · 게시 시각이 지금이거나 앞."""

    return and_(
        not_deleted(), Notice.published_at.is_not(None), Notice.published_at <= now
    )


def status_condition(status: str, now: datetime):
    if status == "draft":
        return Notice.published_at.is_(None)
    if status == "scheduled":
        return and_(Notice.published_at.is_not(None), Notice.published_at > now)
    return and_(Notice.published_at.is_not(None), Notice.published_at <= now)


# 공개 정렬: 고정 공지 먼저(쪽마다가 아니라 전체 순서의 맨 앞), 그다음 최근 게시 먼저, 같으면 id 로 고정
PUBLIC_ORDER = (Notice.is_pinned.desc(), Notice.published_at.desc(), Notice.id.desc())
# 관리자 정렬: 최근 작성 먼저(상태와 무관)
ADMIN_ORDER = (Notice.created_at.desc(), Notice.id.desc())
