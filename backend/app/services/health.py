from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession


class ReadinessCheckError(Exception):
    pass


async def check_database_readiness(db: AsyncSession) -> None:
    try:
        await db.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        raise ReadinessCheckError() from error
