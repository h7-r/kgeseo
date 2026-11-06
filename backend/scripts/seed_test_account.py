"""개발용 테스트 계정(test123@naver.com / test123)을 넣는다. 여러 번 돌려도 한 벌만 남는다.

비밀번호가 가입 규칙에 안 맞아 가입 API 로는 만들 수 없다. 운영 DB 에 들어가면 누구나 아는 비밀번호의
실계정이 되므로, 아래를 모두 지킬 때만 쓴다(하나라도 어긋나면 아무것도 쓰지 않고 종료 코드 2).

1. 접속 주소(DB_HOST)가 이 PC(127.0.0.1 · localhost · ::1)다.
2. DB 이름(DB_NAME)이 개발·테스트용이다 — test_ 로 시작하거나 _test · _dev · _local 로 끝난다.
3. --execute 와 함께 --confirm-db 로 DB 이름을 한 번 더 적는다. --execute 가 없으면 무엇을 할지만 보여 준다.
4. 접속한 서버가 알려 주는 DB 이름 · 호스트 이름(@@hostname)이 이 PC 와 같다.
   SSH 터널이나 포트 포워딩으로 127.0.0.1 이 다른 서버를 가리키는 경우를 막는다.
5. 테스트 계정 말고 계정이 MAX_EXISTING_USERS 개를 넘지 않는다. 넘으면 실데이터가 든 DB 로 본다.

    python -m scripts.seed_test_account                                     # 확인만(DB 에 접속하지 않음)
    python -m scripts.seed_test_account --execute --confirm-db waegok_dev   # 넣기
"""

import argparse
import asyncio
import re
import socket
import sys
from uuid import UUID

from sqlalchemy import func, select, text

from app.core.config import settings
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

# 이름으로만 비교한다. DNS 를 풀지 않는다 — 풀린 주소가 바뀌어도 판정이 흔들리지 않게.
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
DEV_DB_NAME = re.compile(r"test_[a-z0-9_]+|[a-z0-9_]+_(?:test|dev|local)")
MAX_EXISTING_USERS = 200

EXIT_REFUSED = 2


class SeedRefused(Exception):
    """시드를 거부한 까닭. 문구를 그대로 출력한다."""


def check_target(
    *, db_host: str, db_name: str, execute: bool, confirm_db: str | None
) -> None:
    """접속하기 전에 설정만 보고 막는다(1~3)."""
    if db_host.strip().lower() not in LOOPBACK_HOSTS:
        raise SeedRefused(
            f"DB_HOST={db_host!r} 는 이 PC 가 아닙니다. 127.0.0.1 · localhost · ::1 만 허용합니다."
        )
    if not DEV_DB_NAME.fullmatch(db_name):
        raise SeedRefused(
            f"DB_NAME={db_name!r} 는 개발·테스트용 이름이 아닙니다. "
            "test_ 로 시작하거나 _test · _dev · _local 로 끝나야 합니다."
        )
    if execute and confirm_db != db_name:
        raise SeedRefused(
            f"--confirm-db 가 DB_NAME({db_name}) 과 다릅니다. 넣으려면 --confirm-db {db_name} 을 적으세요."
        )


def _short_host(name: str) -> str:
    return name.strip().lower().split(".")[0]


def check_server(
    *,
    db_name: str,
    server_db: str | None,
    server_hostname: str,
    local_hostname: str,
    existing_users: int,
) -> None:
    """접속한 뒤, 쓰기 전에 서버가 알려 주는 값으로 한 번 더 막는다(4~5)."""
    if server_db != db_name:
        raise SeedRefused(f"접속한 DB({server_db}) 가 DB_NAME({db_name}) 과 다릅니다.")
    if _short_host(server_hostname) != _short_host(local_hostname):
        raise SeedRefused(
            f"접속한 MySQL 서버({server_hostname}) 가 이 PC({local_hostname}) 가 아닙니다. "
            "터널·포트 포워딩으로 다른 서버에 닿았을 수 있습니다."
        )
    if existing_users > MAX_EXISTING_USERS:
        raise SeedRefused(
            f"계정이 {existing_users}개 있습니다(한도 {MAX_EXISTING_USERS}). 실데이터가 든 DB 로 보고 멈춥니다."
        )


async def seed() -> str:
    async with AsyncSessionLocal() as db:
        server_db, server_hostname = (
            await db.execute(text("SELECT DATABASE(), @@hostname"))
        ).one()
        existing_users = await db.scalar(
            select(func.count()).select_from(AppUser).where(AppUser.email != EMAIL)
        )
        check_server(
            db_name=settings.db_name,
            server_db=server_db,
            server_hostname=server_hostname,
            local_hostname=socket.gethostname(),
            existing_users=existing_users or 0,
        )

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
    return result


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--execute", action="store_true", help="실제로 넣는다(없으면 확인만 한다)"
    )
    parser.add_argument(
        "--confirm-db", default=None, help="넣을 DB 이름. DB_NAME 과 같아야 한다"
    )
    return parser.parse_args(argv)


async def _run_seed() -> str:
    try:
        return await seed()
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    target = f"db={settings.db_name} host={settings.db_host}:{settings.db_port}"
    try:
        check_target(
            db_host=settings.db_host,
            db_name=settings.db_name,
            execute=args.execute,
            confirm_db=args.confirm_db,
        )
        if not args.execute:
            print(
                f"[DRY-RUN] {target}: 넣으려면 --execute --confirm-db {settings.db_name}"
            )
            return 0
        result = asyncio.run(_run_seed())
    except SeedRefused as error:
        print(f"[REFUSED] {target}: {error}", file=sys.stderr)
        return EXIT_REFUSED
    print(f"[OK] {target} {EMAIL}: {result}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
