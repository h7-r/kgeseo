# Python과 MySQL 사이의 연결을 담당
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

# MySQL과의 연결 관리
engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    hide_parameters=True,
)


# DB 작업용 세션을 만들어줌
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# get_db()함수는 API가 DB를 사용할 때 세션을 빌려주는 함수
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
