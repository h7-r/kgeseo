"""공지사항 공개 조회(11/16 세진, 계약 `docs/contracts/notices_api_v0.2.md`).

- `GET /api/v1/notices` · `GET /api/v1/notices/{notice_id}` — 인증 없음 · 감사 기록 없음 · 감싸개(data 등) 없는 JSON.
- 게시된 공지만 보인다: 삭제 안 됨 · `published_at` 이 있고 지금이거나 앞(초안 · 예약 · 삭제는 목록 · 상세 모두 404/제외).
- 정렬: 고정 공지 먼저 → 최근 게시 먼저 → id. 쪽 나눔은 `page`(1부터) · `page_size`(기본 6, 최대 50).
- 성공 응답은 `Cache-Control: public, max-age=60` — 예약 공지는 게시 시각 뒤 늦어도 60초 안에 보인다. 오류는 no-store.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import error_responses
from app.db.session import get_db
from app.models.notice import Notice
from app.schemas.notice import PublicNoticeDetail, PublicNoticeItem, PublicNoticeList
from app.services.admin_query import invalid_query, parse_int
from app.services.local_auth import utc_now
from app.services.notice import PUBLIC_ORDER, public_condition

PUBLIC_CACHE = "public, max-age=60"
PUBLIC_PAGE_SIZE = 6
PUBLIC_PAGE_SIZE_MAX = 50
PUBLIC_PAGE_MAX = 10_000
CATEGORIES = frozenset({"maintenance", "event", "update", "info"})

router = APIRouter(prefix="/notices", tags=["Notices"])


def _item(row: Notice) -> PublicNoticeItem:
    return PublicNoticeItem(
        id=row.id,
        category=row.category,
        title=row.title,
        is_pinned=row.is_pinned,
        published_at=row.published_at,
    )


@router.get(
    "",
    response_model=PublicNoticeList,
    responses=error_responses.NOTICE_PUBLIC_LIST,
)
async def list_notices(
    response: Response,
    page: str | None = Query(default=None, description="1부터, 기본 1"),
    page_size: str | None = Query(
        default=None, description=f"1~{PUBLIC_PAGE_SIZE_MAX}, 기본 {PUBLIC_PAGE_SIZE}"
    ),
    category: str | None = Query(
        default=None, description="maintenance · event · update · info (없으면 전체)"
    ),
    db: AsyncSession = Depends(get_db),
) -> PublicNoticeList:
    page_number = parse_int(page, "page", default=1, low=1, high=PUBLIC_PAGE_MAX)
    size = parse_int(
        page_size,
        "page_size",
        default=PUBLIC_PAGE_SIZE,
        low=1,
        high=PUBLIC_PAGE_SIZE_MAX,
    )
    if category is not None and category not in CATEGORIES:
        raise invalid_query("category must be one of maintenance, event, update, info.")
    now = utc_now()
    condition = public_condition(now)
    if category is not None:
        condition = condition & (Notice.category == category)
    total = int(
        (
            await db.execute(select(func.count()).select_from(Notice).where(condition))
        ).scalar_one()
    )
    rows = (
        (
            await db.execute(
                select(Notice)
                .where(condition)
                .order_by(*PUBLIC_ORDER)
                .offset((page_number - 1) * size)
                .limit(size)
            )
        )
        .scalars()
        .all()
    )
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return PublicNoticeList(
        items=[_item(row) for row in rows],
        page=page_number,
        page_size=size,
        total=total,
        total_pages=(total + size - 1) // size,
    )


@router.get(
    "/{notice_id}",
    response_model=PublicNoticeDetail,
    responses=error_responses.NOTICE_PUBLIC_DETAIL,
)
async def read_notice(
    notice_id: str, response: Response, db: AsyncSession = Depends(get_db)
) -> PublicNoticeDetail:
    """게시된 공지 하나. 없음 · 초안 · 예약 · 삭제는 모두 같은 404(있는지 알리지 않는다)."""

    row = (
        await db.execute(
            select(Notice).where(
                Notice.id == notice_id.lower(), public_condition(utc_now())
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Notice not found.",
            headers={"Cache-Control": "no-store"},
        )
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return PublicNoticeDetail(
        **_item(row).model_dump(), body=row.body, updated_at=row.updated_at
    )
