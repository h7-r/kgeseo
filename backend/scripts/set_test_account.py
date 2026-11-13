"""팀 테스트 계정 표시(app_users.is_test)를 바꾼다(미르 11/13). 이 값은 API 로 바꿀 수 없고 서버에서 이 명령으로만 바꾼다.

관리자 통계는 기본(include_internal=false)으로 관리자와 is_test=true 계정을 뺀다. 과거 날짜 통계도 조회 시점의 현재 값으로
다시 세므로, 표시를 바꾸면 그 계정의 과거 숫자도 함께 빠지거나 다시 든다.

    python -m scripts.set_test_account <회원 UUID> <true|false>                              # 확인만(바꾸지 않는다)
    python -m scripts.set_test_account <회원 UUID> <true|false> --execute --confirm <회원 UUID>  # 바꾸기

- 대상은 회원 UUID(app_users.id)로만 고른다. 이메일 · 닉네임으로 찾지 않는다.
- 출력에는 DB 이름 · 회원 UUID · role · 바꾸기 전후 is_test 만 나온다. 이메일 · 닉네임 · 비밀번호 · 토큰은 읽지도 내지도 않는다.
- --execute 가 없으면 지금 값과 바뀔 값만 보여 준다. --execute 에는 --confirm 으로 같은 UUID 를 한 번 더 적어야 한다.
- 종료 코드: 0 = 바꿈 · 확인만 · 이미 그 값, 2 = 잘못된 사용(바꾸지 않음), 3 = 그런 회원 없음.
"""

import argparse
import asyncio
import sys
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import AsyncSessionLocal, engine
from app.models.app_user import AppUser

EXIT_USAGE = 2
EXIT_NOT_FOUND = 3
VALUES = {"true": True, "false": False}


class UsageError(Exception):
    """잘못된 사용. 문구를 그대로 출력하고 아무것도 바꾸지 않는다."""


@dataclass(frozen=True)
class Outcome:
    user_id: str
    role: str
    before: bool
    after: bool
    changed: bool


def normalize_user_id(value: str) -> str:
    """UUID 형식만 받는다. 저장 형식(소문자 하이픈 36자)으로 바꿔 돌려준다."""
    try:
        return str(UUID(value.strip()))
    except (ValueError, AttributeError) as error:
        raise UsageError(f"회원 UUID 형식이 아닙니다: {value!r}") from error


def parse_value(value: str) -> bool:
    key = value.strip().lower()
    if key not in VALUES:
        raise UsageError(f"값은 true 또는 false 만 됩니다: {value!r}")
    return VALUES[key]


def check_confirm(*, user_id: str, execute: bool, confirm: str | None) -> None:
    if not execute:
        return
    if confirm is None:
        raise UsageError(
            f"--execute 에는 --confirm {user_id} 로 대상 UUID 를 한 번 더 적어야 합니다."
        )
    if normalize_user_id(confirm) != user_id:
        raise UsageError("--confirm 의 UUID 가 대상과 다릅니다.")


async def apply(
    db: AsyncSession, user_id: str, value: bool, *, execute: bool
) -> Outcome | None:
    """대상 회원의 is_test 를 읽고, execute 면 바꾼다. 없는 회원이면 None(아무것도 쓰지 않는다).

    읽는 칸은 id · role · is_test 뿐이다. 바꿀 때는 행을 잠가(FOR UPDATE) 읽은 값과 쓴 값이 같은 트랜잭션에 있게 한다.
    """
    statement = select(AppUser.id, AppUser.role, AppUser.is_test).where(
        AppUser.id == user_id
    )
    if execute:
        statement = statement.with_for_update()
    row = (await db.execute(statement)).first()
    if row is None:
        await db.rollback()
        return None
    found_id, role, before = row[0], row[1], bool(row[2])
    changed = before != value
    if execute and changed:
        # 전체 행(이메일 등)을 불러오지 않고 그 칸만 쓴다
        await db.execute(
            update(AppUser).where(AppUser.id == found_id).values(is_test=value)
        )
        await db.commit()
    else:
        await db.rollback()
    return Outcome(
        user_id=found_id,
        role=role,
        before=before,
        after=value if execute else before,
        changed=execute and changed,
    )


def flag(value: bool) -> str:
    return "true" if value else "false"


def describe(outcome: Outcome, value: bool, *, execute: bool, target: str) -> str:
    head = f"{target} user_id={outcome.user_id} role={outcome.role}"
    if not execute:
        if outcome.before == value:
            return f"[DRY-RUN] {head} is_test={flag(outcome.before)} (이미 그 값 — 바꿀 것 없음)"
        return (
            f"[DRY-RUN] {head} is_test: {flag(outcome.before)} -> {flag(value)} "
            f"(바꾸려면 --execute --confirm {outcome.user_id})"
        )
    if not outcome.changed:
        return f"[UNCHANGED] {head} is_test={flag(outcome.before)} (이미 그 값)"
    return f"[OK] {head} is_test: {flag(outcome.before)} -> {flag(outcome.after)}"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("user_id", help="대상 회원 UUID(app_users.id)")
    parser.add_argument("value", help="true 또는 false")
    parser.add_argument(
        "--execute", action="store_true", help="실제로 바꾼다(없으면 확인만)"
    )
    parser.add_argument(
        "--confirm", default=None, help="--execute 때 대상 UUID 를 한 번 더 적는다"
    )
    return parser.parse_args(argv)


async def _run(user_id: str, value: bool, execute: bool) -> Outcome | None:
    try:
        async with AsyncSessionLocal() as db:
            return await apply(db, user_id, value, execute=execute)
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    target = f"db={settings.db_name}"
    try:
        user_id = normalize_user_id(args.user_id)
        value = parse_value(args.value)
        check_confirm(user_id=user_id, execute=args.execute, confirm=args.confirm)
    except UsageError as error:
        print(f"[REFUSED] {target}: {error}", file=sys.stderr)
        return EXIT_USAGE
    outcome = asyncio.run(_run(user_id, value, args.execute))
    if outcome is None:
        print(
            f"[NOT FOUND] {target} user_id={user_id}: 그런 회원이 없습니다",
            file=sys.stderr,
        )
        return EXIT_NOT_FOUND
    print(describe(outcome, value, execute=args.execute, target=target))
    return 0


if __name__ == "__main__":
    sys.exit(main())
