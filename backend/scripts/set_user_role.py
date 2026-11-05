"""계정 권한을 바꾼다. 관리자 권한은 API 로 줄 수 없고 서버에서 이 명령으로만 준다.

python -m scripts.set_user_role someone@example.com admin
"""

import asyncio
import sys

from sqlalchemy import select

from app.db.session import AsyncSessionLocal, engine
from app.models.app_user import AppUser

ROLES = ("user", "admin")


async def set_role(email: str, role: str) -> bool:
    async with AsyncSessionLocal() as db:
        user = await db.scalar(
            select(AppUser).where(AppUser.email == email.strip().lower())
        )
        if user is not None:
            user.role = role
            await db.commit()
    await engine.dispose()
    return user is not None


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[2] not in ROLES:
        sys.exit("사용법: python -m scripts.set_user_role <이메일> <user|admin>")
    found = asyncio.run(set_role(sys.argv[1], sys.argv[2]))
    sys.exit(0 if found else f"계정을 찾지 못했습니다: {sys.argv[1]}")
