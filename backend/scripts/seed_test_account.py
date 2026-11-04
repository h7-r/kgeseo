"""개발용 테스트 계정(test123@naver.com / test123)을 넣는다. 여러 번 돌려도 한 벌만 남는다.

비밀번호가 가입 규칙에 안 맞아 가입 API 로는 만들 수 없다. 운영 DB 에는 돌리지 않는다.

    python -m scripts.seed_test_account
"""

import asyncio
from uuid import UUID

from sqlalchemy import select

from app.db.session import AsyncSessionLocal, engine
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.services.local_auth import hash_password, utc_now

EMAIL = "test123@naver.com"
PASSWORD = "test123"
NICKNAME = "TEST"
TERMS_VERSION = "2026-09"
# 웹사이트 쪽 테스트 계정과 같은 아이디 — 팀원 기기마다 같아야 한다.
USER_ID = str(UUID("00000000-0000-4000-8000-000000000001"))
IDENTITY_ID = str(UUID("00000000-0000-4000-8000-000000000002"))


async def seed() -> str:
    async with AsyncSessionLocal() as db:
        user = await db.scalar(select(AppUser).where(AppUser.email == EMAIL))
        now = utc_now()
        if user is None:
            user = AppUser(
                id=USER_ID,
                email=EMAIL,
                nickname=NICKNAME,
                region="전남",
                terms_version=TERMS_VERSION,
                terms_accepted_at=now,
                privacy_accepted_at=now,
                age_confirmed_at=now,
                created_at=now,
                updated_at=now,
            )
            db.add(user)
            await db.flush()

        identity = await db.scalar(
            select(AuthIdentity).where(
                AuthIdentity.provider == "local",
                AuthIdentity.provider_subject == EMAIL,
            )
        )
        if identity is None:
            db.add(
                AuthIdentity(
                    id=IDENTITY_ID,
                    app_user_id=user.id,
                    provider="local",
                    provider_subject=EMAIL,
                    password_hash=hash_password(PASSWORD),
                    created_at=now,
                    updated_at=now,
                )
            )
            result = "만들었습니다"
        else:
            identity.password_hash = hash_password(PASSWORD)
            identity.updated_at = now
            result = "비밀번호를 다시 맞췄습니다"
        await db.commit()
    await engine.dispose()
    return result


if __name__ == "__main__":
    print(f"{EMAIL}: {asyncio.run(seed())}")
