from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.anonymous_session import AnonymousSession


async def create_anonymous_session(
    db: AsyncSession,
) -> AnonymousSession:
    """
    새로운 익명 세션을 생성하고 DB에 저장한다.
    """

    # 현재 UTC 시간을 구한다.
    # timezone.utc를 사용해 서버 위치와 관계없이 기준 시간을 UTC로 통일한다.
    now_utc = datetime.now(timezone.utc)

    # 익명 세션의 유효기간은 현재 정책상 24시간이다.
    expires_at_utc = now_utc + timedelta(hours=24)

    # MySQL DATETIME은 timezone 정보를 자체적으로 저장하지 않는다.
    # 따라서 'UTC 기준 시간'이라는 규칙을 유지하면서
    # timezone 정보만 제거한 값을 DB에 저장한다.
    created_at_db = now_utc.replace(tzinfo=None)
    expires_at_db = expires_at_utc.replace(tzinfo=None)

    # 실제 DB에 저장할 ORM 객체를 만든다.
    anonymous_session = AnonymousSession(
        # uuid4()가 UUID를 만들고 str()로 CHAR(36)에 저장 가능한 문자열로 변환한다.
        id=str(uuid4()),
        # 생성 시각
        created_at=created_at_db,
        # 생성 시각으로부터 24시간 뒤의 만료 시각
        expires_at=expires_at_db,
    )

    # 아직 이 단계에서는 Python 객체만 존재한다.
    # add()를 통해 현재 DB 작업에 INSERT 대상으로 등록한다.
    db.add(anonymous_session)

    # 실제 DB에 변경 내용을 저장한다.
    await db.commit()

    # DB에 저장된 최신 값을 다시 ORM 객체에 반영한다.
    await db.refresh(anonymous_session)

    # Router에서 응답으로 사용할 수 있도록 생성된 객체를 반환한다.
    return anonymous_session
