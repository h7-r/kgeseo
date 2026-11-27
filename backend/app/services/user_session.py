"""쿠키 로그인 세션과 로그인 시도 제한."""

import hashlib
import math
import secrets
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import and_, case, delete, null, or_, select, update
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.util import identity_key

from app.core.config import settings
from app.db.session import get_db
from app.models.account_data import LoginThrottle, UserSession
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.services.local_auth import normalize_email, utc_now

# 운영(https)은 __Host- 쿠키다. Secure · Path=/ · Domain 없음을 브라우저가 강제해 API 주소에만 묶인다.
# 로컬 http 에서는 __Host- 를 쓸 수 없어 이름만 다르다.
SESSION_COOKIE = (
    "__Host-waegok_session" if settings.session_cookie_secure else "waegok_session"
)
SESSION_COOKIE_OPTIONS = {
    "path": "/",
    "httponly": True,
    "samesite": "lax",
    "secure": settings.session_cookie_secure,
}
SESSION_LIFETIME = timedelta(days=14)

THROTTLE_WINDOW = timedelta(minutes=15)
MAX_FAILURES_PER_EMAIL = 5
MAX_FAILURES_PER_IP = 30
# 실패 기록 쓰기가 다른 요청 · 정리 작업과 겹쳐 MySQL 이 트랜잭션을 되돌렸을 때(교착 1213 · 잠금 대기 초과 1205)
# 처음부터 다시 하는 횟수. 되돌린 트랜잭션은 아무것도 남기지 않으므로 다시 해도 두 번 세지 않는다.
FAILURE_WRITE_ATTEMPTS = 3
RETRYABLE_MYSQL_ERRORS = frozenset({1205, 1213})


def wait_phrase(seconds: int) -> str:
    """429 본문의 「n초 뒤」 · 「n분 뒤」 — `Retry-After` 와 같은 숫자를 말한다(웹의 waitPhrase 와 같은 셈, 1분 넘으면 분으로 올림)."""

    if seconds < 60:
        return f"{seconds}초 뒤"
    return f"{math.ceil(seconds / 60)}분 뒤"


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class WithdrawnAccountError(Exception):
    """탈퇴한 계정에 세션을 내주거나 데이터를 쓰려 했다(탈퇴와 겹친 요청). 호출한 경로가 자기 오류 응답으로 바꾼다."""


class PasswordChangedDuringLoginError(Exception):
    """이메일 로그인이 확인한 비밀번호가 세션을 만들기 전에 바뀌었다(찾기 완료 · 변경과 겹친 로그인, 11/25).

    옛 비밀번호로 확인한 로그인이 「모든 세션 끊기」 뒤에 새 세션을 남기지 못하게 한다. 호출한 경로가 로그인 실패로 답한다."""


def _active_flag(user_id: str, *, share: bool):
    """회원 행을 잠그고 「탈퇴 안 함」 여부를 읽는다 — 1/True = 회원, 0/False = 탈퇴, None = 행 없음.

    잠금 읽기라 이 트랜잭션의 스냅숏이 아니라 다른 트랜잭션이 커밋한 최신 값을 본다. 탈퇴 트랜잭션은 같은 행을 배타 잠금으로
    먼저 쥐므로, 겹친 요청은 탈퇴가 끝날 때까지 기다렸다가 `deleted_at` 이 채워진 행을 읽는다(그 반대 순서면 탈퇴가 기다린다)."""

    statement = select(AppUser.deleted_at.is_(None)).where(AppUser.id == user_id)
    return statement.with_for_update(read=share)


def _is_withdrawn(flag) -> bool:
    return flag is not None and not flag


async def ensure_member_for_write(db: AsyncSession, user_id: str) -> None:
    """회원 데이터(게임 저장 · 캐릭터 · 문의)를 쓰기 전에 부른다 — 회원 행 공유 잠금 + 탈퇴 여부 확인.

    탈퇴 트랜잭션이 저장을 지운 바로 뒤에, 그 전에 세션 확인을 마친 요청이 저장을 다시 만드는 경합을 막는다(공유 잠금이라
    같은 회원의 쓰기끼리는 서로 막지 않는다). 탈퇴했으면 `WithdrawnAccountError`."""

    if _is_withdrawn(await db.scalar(_active_flag(user_id, share=True))):
        raise WithdrawnAccountError


def last_login_update(user_id: str, now: datetime):
    """최근 로그인 갱신(미르 11/16) — 더 최근 값만 쓴다. 동시 로그인에서 늦게 커밋된 이른 시각이 앞선 값을 되돌리지 않는다
    (MySQL UPDATE 의 WHERE 는 잠금 읽기라 다른 트랜잭션이 커밋한 최신 값으로 다시 판단한다). 프로필 updated_at 은 적지 않는다."""

    return (
        update(AppUser)
        .where(
            AppUser.id == user_id,
            or_(AppUser.last_login_at.is_(None), AppUser.last_login_at < now),
        )
        .values(last_login_at=now)
        .execution_options(synchronize_session=False)
    )


async def start_session(
    db: AsyncSession,
    response: Response,
    user_id: str,
    *,
    verified_password_hash: str | None = None,
) -> None:
    """세션을 새로 만들어 HttpOnly 쿠키로 내려 준다. 원문 토큰은 DB 에 남지 않는다.

    새 세션 INSERT 와 회원의 `last_login_at` 갱신은 **한 트랜잭션**으로 커밋한다 — 둘 중 하나만 남는 일이 없다. 갱신이 실패하면
    되돌리고 다시 던진다(세션도 남지 않고 쿠키도 내려가지 않는다). 이 함수는 로그인 성공 공통 처리(`auth._establish_login`)에서만
    부른다: 이메일 가입 · 이메일 로그인 · Google · Naver · 소셜 가입 완료.

    순서가 중요하다: **회원 행 UPDATE(배타 잠금)를 먼저, 세션 INSERT 를 뒤에**. 세션 INSERT 는 FK 확인으로 부모(app_users) 행에
    공유 잠금을 거는데, 같은 회원이 동시에 로그인할 때 INSERT 를 먼저 하면 두 트랜잭션이 공유 잠금을 쥔 채 서로의 UPDATE 를
    기다려 데드락(1213)이 난다. UPDATE 를 먼저 하면 둘째 로그인은 첫째가 커밋할 때까지 기다렸다가 차례로 처리된다.

    탈퇴(11/17): UPDATE 로 회원 행을 쥔 다음 같은 행을 잠금 읽기로 다시 읽어 탈퇴 여부를 본다. 비밀번호 확인이 탈퇴 커밋 전에
    끝났더라도 UPDATE 가 탈퇴 트랜잭션을 기다린 뒤 최신 행을 보므로, 탈퇴한 계정이면 되돌리고 `WithdrawnAccountError` 를 던진다
    (세션 · 쿠키 · 최근 로그인 모두 남지 않는다). 잠그는 행 · 순서는 그대로라 교착이 새로 생기지 않는다.

    비밀번호 찾기 · 변경(11/25): 이메일 로그인은 자기가 확인한 비밀번호 해시(`verified_password_hash`)를 넘긴다. 회원 행을 쥔
    다음 이메일 수단의 해시를 잠금 읽기(최신 커밋)로 다시 보고, 다르면(그 사이 새 비밀번호 저장이 커밋됐다) 되돌리고
    `PasswordChangedDuringLoginError` 를 던진다. 비밀번호를 바꾸는 쪽도 회원 행을 먼저 쥐므로 둘은 차례로 처리된다 —
    시각 비교가 아니라 해시 비교라 시계 · 커밋 순서의 틈이 없다.
    """
    token = secrets.token_urlsafe(32)
    now = utc_now()
    try:
        await db.execute(last_login_update(user_id, now))
        if _is_withdrawn(await db.scalar(_active_flag(user_id, share=False))):
            raise WithdrawnAccountError
        if verified_password_hash is not None:
            identity = await db.scalar(
                select(AuthIdentity)
                .where(
                    AuthIdentity.app_user_id == user_id,
                    AuthIdentity.provider == "local",
                )
                .with_for_update(read=True)
            )
            if (
                isinstance(identity, AuthIdentity)
                and identity.password_hash != verified_password_hash
            ):
                raise PasswordChangedDuringLoginError
        db.add(
            UserSession(
                id=str(uuid4()),
                app_user_id=user_id,
                token_hash=_hash(token),
                created_at=now,
                expires_at=now + SESSION_LIFETIME,
            )
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_LIFETIME.total_seconds()),
        **SESSION_COOKIE_OPTIONS,
    )


async def end_session(db: AsyncSession, request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await db.execute(
            update(UserSession)
            .where(UserSession.token_hash == _hash(token))
            .values(revoked_at=utc_now())
        )
        await db.commit()
    response.delete_cookie(SESSION_COOKIE, **SESSION_COOKIE_OPTIONS)


async def _find_session_user(db: AsyncSession, token: str) -> AppUser | None:
    statement = (
        select(AppUser)
        .join(UserSession, UserSession.app_user_id == AppUser.id)
        .where(
            UserSession.token_hash == _hash(token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > utc_now(),
            # 탈퇴하면 세션 행을 지우지만, 한 겹 더 — 탈퇴한 계정의 세션은 어떤 경우에도 로그인으로 보지 않는다
            AppUser.deleted_at.is_(None),
        )
    )
    return await db.scalar(statement)


# 게스트 세션(app.services.guest_session)이 같은 토큰 규칙을 쓰도록 공개한다.
hash_session_token = _hash


async def session_user_from_request(
    db: AsyncSession, request: Request
) -> AppUser | None:
    """로그인 쿠키가 유효하면 그 사용자. 없거나 만료 · 폐기면 None(오류를 내지 않는다)."""
    token = request.cookies.get(SESSION_COOKIE)
    return await _find_session_user(db, token) if token else None


def require_same_origin(request: Request) -> None:
    """쓰기 요청이 다른 사이트에서 오지 못하게 막는다(CSRF). 쿠키 SameSite 위의 한 겹이다."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    if request.headers.get("origin") not in settings.cors_origins:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Origin not allowed.")


async def current_user(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AppUser:
    """쿠키의 세션으로만 사용자를 정한다. 요청에 적힌 사용자 id 는 믿지 않는다."""
    response.headers["Cache-Control"] = "no-store"
    token = request.cookies.get(SESSION_COOKIE)
    user = await _find_session_user(db, token) if token else None
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Login required.",
            headers={"Cache-Control": "no-store"},
        )
    return user


async def optional_current_user(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AppUser | None:
    """로그인이 필수가 아닌 곳(1:1 문의 접수) — 쿠키 세션이 유효하면 사용자, 아니면 None. 401 을 내지 않는다."""
    response.headers["Cache-Control"] = "no-store"
    token = request.cookies.get(SESSION_COOKIE)
    return await _find_session_user(db, token) if token else None


async def current_admin(user: AppUser = Depends(current_user)) -> AppUser:
    if user.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Admin only.",
            headers={"Cache-Control": "no-store"},
        )
    return user


def _throttle_keys(request: Request, email: str) -> list[tuple[str, int]]:
    ip = request.client.host if request.client else "unknown"
    return [
        (_hash(f"email:{normalize_email(email)}"), MAX_FAILURES_PER_EMAIL),
        (_hash(f"ip:{ip}"), MAX_FAILURES_PER_IP),
    ]


async def login_lock_remaining_seconds(
    db: AsyncSession, request: Request, email: str
) -> int | None:
    """로그인이 막혀 있으면 풀릴 때까지 남은 초(올림, 1 이상), 아니면 None.

    잠금은 실패 한도에 닿은 순간 `locked_until = 그때 + THROTTLE_WINDOW`로 기록된다(`record_login_failure`).
    이메일 · IP 잠금이 둘 다 걸려 있으면 둘 다 풀려야 로그인할 수 있으므로 더 늦게 풀리는 쪽을 돌려준다.
    """

    now = utc_now()
    remaining: int | None = None
    for key, _ in _throttle_keys(request, email):
        # 같은 세션이 앞서 읽어 둔 객체가 아니라 지금 DB 값을 본다(다른 요청이 방금 센 실패 · 잠금)
        row = await db.get(LoginThrottle, key, populate_existing=True)
        if (
            isinstance(row, LoginThrottle)
            and row.locked_until
            and row.locked_until > now
        ):
            seconds = max(1, math.ceil((row.locked_until - now).total_seconds()))
            remaining = seconds if remaining is None else max(remaining, seconds)
    return remaining


async def is_login_locked(db: AsyncSession, request: Request, email: str) -> bool:
    return await login_lock_remaining_seconds(db, request, email) is not None


def _failure_upsert(key: str, limit: int, now: datetime):
    """실패 하나를 한 문장으로 센다(`INSERT … ON DUPLICATE KEY UPDATE`). 읽고 나서 쓰지 않으므로 동시 요청이 서로의 집계를
    덮지 않고, 첫 실패가 겹쳐도 중복 키 오류가 없다. 행이 그 사이 지워졌으면(정기 파기) 새 창으로 다시 만든다.

    규칙(기존과 같음): 창이 15분을 「넘게」 지났으면 새 창(1회)으로, 아니면 +1. 한도에 닿으면 `지금 + 15분` 까지 잠근다.
    동시 요청을 위한 보완: 이미 진행 중인 잠금은 늘리지도 풀지도 않는다(잠금 확인을 지난 뒤 겹쳐 들어온 실패가 잠금을
    연장하거나, 창이 바뀌었다고 풀어 버리지 않게).

    MySQL 은 UPDATE 절의 대입을 **왼쪽부터** 하고, 뒤의 식은 앞에서 바뀐 값을 본다. 그래서 잠금 → 횟수 → 창 시작 순서로
    둔다 — 잠금 · 횟수를 정하는 식이 모두 바뀌기 전의 횟수 · 창 시작을 본다(`tests/test_login_throttle_concurrency_mysql.py`).
    """
    table = LoginThrottle.__table__
    expired = table.c.window_started_at < now - THROTTLE_WINDOW
    lock_active = and_(table.c.locked_until.is_not(None), table.c.locked_until > now)
    next_count = case((expired, 1), else_=table.c.failed_count + 1)
    lock_at = now + THROTTLE_WINDOW
    insert = mysql_insert(table).values(
        key_hash=key,
        failed_count=1,
        window_started_at=now,
        locked_until=lock_at if limit <= 1 else None,
    )
    return insert.on_duplicate_key_update(
        [
            (
                "locked_until",
                case(
                    (lock_active, table.c.locked_until),
                    (next_count >= limit, lock_at),
                    (expired, null()),
                    else_=table.c.locked_until,
                ),
            ),
            ("failed_count", next_count),
            (
                "window_started_at",
                case((expired, now), else_=table.c.window_started_at),
            ),
        ]
    )


def _mysql_error_code(error: OperationalError) -> int | None:
    args = getattr(error.orig, "args", None)
    return args[0] if args and isinstance(args[0], int) else None


def _forget_throttle_rows(db: AsyncSession, keys: list[str]) -> None:
    """세션에 남은 옛 `LoginThrottle` 객체를 버린다(문장으로 바꾼 행은 ORM 객체에 반영되지 않는다)."""
    for key in keys:
        cached = db.identity_map.get(identity_key(LoginThrottle, key))
        if cached is not None:
            db.expunge(cached)


async def _write_throttle_rows(db: AsyncSession, statements) -> None:
    """실패 기록 문장들을 한 트랜잭션으로 커밋한다. MySQL 이 교착 · 잠금 대기 초과로 되돌리면 정해진 횟수만큼 처음부터
    다시 한다(되돌린 트랜잭션은 남긴 것이 없어 두 번 세지 않는다). 다른 오류 · 마지막 실패는 그대로 올린다 — 숨기지 않는다.

    호출자는 읽기만 했거나 앞선 트랜잭션을 끝낸 상태여야 한다. 미반영 ORM 변경은 여기서 막지만, 이미 실행한 Core SQL이나
    flush한 변경은 이 검사로 알 수 없다. 로그인 실패는 읽기만 했고, 탈퇴 · 비밀번호 변경 실패는 먼저 rollback한다."""
    if db.new or db.dirty or db.deleted:
        raise RuntimeError(
            "login throttle writes need a session without pending changes"
        )
    for attempt in range(1, FAILURE_WRITE_ATTEMPTS + 1):
        try:
            for statement in statements():
                await db.execute(statement)
            await db.commit()
            return
        except OperationalError as error:
            await db.rollback()
            if (
                _mysql_error_code(error) not in RETRYABLE_MYSQL_ERRORS
                or attempt == FAILURE_WRITE_ATTEMPTS
            ):
                raise


async def record_login_failure(db: AsyncSession, request: Request, email: str) -> None:
    """이메일 · IP 키마다 실패 하나를 센다(동시 요청에도 유실 · 중복 키 없음). 이 함수가 커밋한다.

    키는 해시 순서로 쓴다 — 키를 둘씩 잡는 요청끼리 늘 같은 순서로 행을 잠가 서로 기다리다 막히지 않게 한다."""
    keys = sorted(_throttle_keys(request, email))

    def statements():
        now = utc_now()  # 다시 할 때마다 그때 시각으로
        return [_failure_upsert(key, limit, now) for key, limit in keys]

    await _write_throttle_rows(db, statements)
    _forget_throttle_rows(db, [key for key, _ in keys])


async def clear_login_failures(db: AsyncSession, request: Request, email: str) -> None:
    """성공하면 그 이메일의 실패만 지운다. IP 집계는 남겨 여러 계정을 돌려 보는 공격을 막는다.

    읽지 않고 조건으로 지운다 — 그 사이 다른 요청 · 정기 파기가 행을 지웠거나 새로 썼어도 오류 없이 지금 행을 지운다."""
    key, _ = _throttle_keys(request, email)[0]
    await _write_throttle_rows(
        db, lambda: [delete(LoginThrottle).where(LoginThrottle.key_hash == key)]
    )
    _forget_throttle_rows(db, [key])
