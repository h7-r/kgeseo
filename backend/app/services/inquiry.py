"""1:1 문의 — 접수 번호 · IP 표시 · 집계 도우미(관리자 API v0.3 3단계 P3-1, 해랑 11/13)."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inquiry import Inquiry, InquiryReply
from app.services.local_auth import utc_now

KST = timezone(timedelta(hours=9))

CATEGORY_LABELS = {
    "account": "계정",
    "gameplay": "게임플레이",
    "payment": "결제",
    "tech": "기술지원",
    "other": "기타",
}


def inquiry_number(seq: int, created_at: datetime) -> str:
    """`INQ-YYYYMMDD-NNNNN` — 날짜는 KST 접수일(보기용), 유일성은 `seq`(DB AUTO_INCREMENT)가 보장한다."""

    kst_day = created_at.replace(tzinfo=None) + timedelta(hours=9)
    return f"INQ-{kst_day:%Y%m%d}-{seq:05d}"


def ip_display(ip: str | None) -> str | None:
    """IP 원문은 저장만 하고 화면엔 앞 두 자리(미르 11/13). IPv4 `203.0.*.*` · IPv6 `2001:db8:*`."""

    if not ip:
        return None
    if ":" in ip:
        groups = ip.split(":")
        return ":".join(groups[:2]) + ":*"
    parts = ip.split(".")
    if len(parts) != 4:
        return "*"
    return f"{parts[0]}.{parts[1]}.*.*"


async def create_inquiry(
    db: AsyncSession,
    *,
    category: str,
    title: str,
    body: str,
    email: str,
    app_user_id: str | None,
    client_ip: str | None,
) -> Inquiry:
    """접수 — 삽입 → flush 로 `seq` 를 받아 같은 트랜잭션에서 번호를 채운다. 어디서 실패하든 통째로 되돌아간다(세진 ①)."""

    now = utc_now()
    row = Inquiry(
        id=str(uuid4()),
        number=None,
        app_user_id=app_user_id,
        email=email,
        category=category,
        title=title,
        body=body,
        status="open",
        priority="normal",
        client_ip=client_ip,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    row.number = inquiry_number(row.seq, now)
    await db.commit()
    await db.refresh(row)
    return row


async def replies_of(
    db: AsyncSession, inquiry_ids: list[str]
) -> dict[str, list[InquiryReply]]:
    if not inquiry_ids:
        return {}
    rows = (
        await db.execute(
            select(InquiryReply)
            .where(InquiryReply.inquiry_id.in_(inquiry_ids))
            .order_by(InquiryReply.created_at.asc(), InquiryReply.id.asc())
        )
    ).scalars()
    found: dict[str, list[InquiryReply]] = {}
    for reply in rows:
        found.setdefault(reply.inquiry_id, []).append(reply)
    return found


async def reply_counts(db: AsyncSession, inquiry_ids: list[str]) -> dict[str, int]:
    if not inquiry_ids:
        return {}
    rows = await db.execute(
        select(InquiryReply.inquiry_id, func.count())
        .where(InquiryReply.inquiry_id.in_(inquiry_ids))
        .group_by(InquiryReply.inquiry_id)
    )
    return {inquiry_id: int(count) for inquiry_id, count in rows.all()}


async def average_first_reply_hours(db: AsyncSession) -> float | None:
    """답변이 있는 문의의 (첫 답변 − 접수) 평균(시간, 소수 1자리). 없으면 None."""

    first_reply = (
        select(
            InquiryReply.inquiry_id.label("inquiry_id"),
            func.min(InquiryReply.created_at).label("first_at"),
        )
        .group_by(InquiryReply.inquiry_id)
        .subquery()
    )
    rows = (
        await db.execute(
            select(Inquiry.created_at, first_reply.c.first_at).join(
                first_reply, first_reply.c.inquiry_id == Inquiry.id
            )
        )
    ).all()
    if not rows:
        return None
    total = sum(
        (first_at - created_at).total_seconds() for created_at, first_at in rows
    )
    return round(total / len(rows) / 3600, 1)


def kst_today_start_utc(now: datetime | None = None) -> datetime:
    """오늘(KST) 0시의 UTC naive 시각 — 「오늘 접수」 셈에 쓴다."""

    current = now or utc_now()
    offset = timedelta(hours=9)
    local = current + offset
    return local.replace(hour=0, minute=0, second=0, microsecond=0) - offset
