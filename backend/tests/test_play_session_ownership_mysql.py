"""Play Session 소유권 · 게스트 세션 · 로그인 승계 · Origin · asset_base_path(11/6 PM)를 격리 MySQL 에서 검증한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`, 전용 빈 schema,
datadir 대조, 끝나면 테이블을 지운다). 전체 migration 체인(새 revision `d8f2a6c4e1b9` 포함)을 적용한 실제
테이블에 실제 라우터를 ASGI 로 부른다. `real_play_auth` 표시라 쿠키 주체 · 소유권 · Origin 검사를 대체하지 않는다.
콘텐츠 · 계정 · 닉네임은 모두 가상 테스트 값이다.
"""

import asyncio
import hashlib
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.api.v1 import auth as auth_api
from app.api.v1.play_sessions import get_new_session_publication_guard
from app.db.session import get_db
from app.main import app
from app.models.anonymous_session import AnonymousSession
from app.models.guest_session import GuestSession, GuestSessionTransfer
from app.models.play_session import PlaySession
from app.schemas.auth import SocialAccountUser, SocialUserResponse
from app.services import guest_session as guest_service
from app.services.guest_session import GUEST_COOKIE
from app.services.local_auth import utc_now
from app.services.pinned_content import ContentPin, PinnedContent
from app.services.session_content import get_pinned_content_store
from app.services.user_session import SESSION_COOKIE
from tests.conftest import published_guard
from tests.test_hint_balance_mysql import (
    CASE,
    pinned,
    runtime_with_two_hinted_puzzles,
    store_with,
)
from tests.test_npc_turn import make_client, npc_pack
from tests.test_npc_turn_idempotency_mysql import mysql_run, pytestmark  # noqa: F401

pytestmark = [pytestmark, pytest.mark.real_play_auth]

ORIGIN = "http://localhost:5175"  # 기본 CORS_ORIGINS(개발) 안의 값
PASSWORD = "Synthetic-Only-9!"
STAMP = "2026-11-06T12:00:00+09:00"


class Browser:
    """쿠키 저장소가 따로 있는 브라우저 하나."""

    def __init__(self, origin: str | None = ORIGIN) -> None:
        headers = {"Origin": origin} if origin else {}
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
            headers=headers,
        )

    async def close(self) -> None:
        await self.client.aclose()

    def cookie(self, name: str) -> str | None:
        return self.client.cookies.get(name)

    async def anonymous(self) -> httpx.Response:
        return await self.client.post("/api/v1/anonymous-sessions")

    async def start(self, anonymous_id: str, version: int | None = 1) -> httpx.Response:
        body = {"anonymous_session_id": anonymous_id, "case_id": CASE}
        if version is not None:
            body["content_version"] = version
        return await self.client.post("/api/v1/play-sessions", json=body)

    async def guest_play(self) -> tuple[str, str]:
        anonymous = (await self.anonymous()).json()["data"]["anonymous_session_id"]
        created = await self.start(anonymous)
        assert created.status_code == 201, created.text
        return anonymous, created.json()["data"]["play_session_id"]

    async def register(self, tag: str) -> httpx.Response:
        return await self.client.post(
            "/api/v1/auth/register",
            json={
                "email": f"it-{tag}-{uuid4().hex[:8]}@example.invalid",
                "password": PASSWORD,
                "nickname": f"가상{uuid4().int % 100000:05d}",
                "consent": {"terms": True, "privacy": True, "age": True},
            },
        )

    async def login(self, email: str) -> httpx.Response:
        return await self.client.post(
            "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
        )

    async def interaction(self, session_id: str, event_id: str) -> httpx.Response:
        return await self.client.post(
            f"/api/v1/play-sessions/{session_id}/interactions",
            json={
                "client_event_id": event_id,
                "client_timestamp": STAMP,
                "zone_id": "ZONE_A",
                "action": "inspect",
                "target_type": "object",
                "target_id": "OBJ_TEST",
                "payload": {},
            },
        )

    async def hint(self, session_id: str) -> httpx.Response:
        return await self.client.post(
            f"/api/v1/play-sessions/{session_id}/hints",
            json={
                "client_event_id": str(uuid4()),
                "client_timestamp": STAMP,
                "puzzle_id": "PZ_A",
                "target_level": 1,
            },
        )

    async def hint_alias(self, session_id: str) -> httpx.Response:
        return await self.client.post(
            f"/api/v1/play-sessions/{session_id}/puzzles/PZ_A/hints",
            json={
                "client_event_id": str(uuid4()),
                "client_timestamp": STAMP,
                "target_level": 1,
            },
        )

    async def npc(self, session_id: str) -> httpx.Response:
        return await self.client.post(
            f"/api/v1/play-sessions/{session_id}/npc/turns",
            json={
                "client_event_id": str(uuid4()),
                "client_timestamp": STAMP,
                "trigger": "auto",
            },
        )

    async def reads(self, session_id: str) -> list[httpx.Response]:
        base = f"/api/v1/play-sessions/{session_id}"
        return [
            await self.client.get(base),
            await self.client.get(f"{base}/clues"),
            await self.client.get(f"{base}/bundle"),
        ]


def run(scenario, store=None):
    """실제 라우터 + 격리 DB. 플레이 주체 · 소유권 · Origin 은 대체하지 않는다."""

    async def wrapped(sessions):
        async def override_get_db():
            async with sessions() as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_pinned_content_store] = lambda: (
            store or store_with(pinned())
        )
        app.dependency_overrides[get_new_session_publication_guard] = lambda: (
            published_guard
        )
        try:
            await scenario(sessions)
        finally:
            for dependency in (
                get_db,
                get_pinned_content_store,
                get_new_session_publication_guard,
            ):
                app.dependency_overrides.pop(dependency, None)

    mysql_run(wrapped)


async def scalar(sessions, statement):
    async with sessions() as db:
        return await db.scalar(statement)


async def owner_of(sessions, session_id: str) -> tuple[str | None, str | None]:
    async with sessions() as db:
        row = (
            await db.execute(
                select(
                    PlaySession.owner_user_id, PlaySession.owner_anonymous_session_id
                ).where(PlaySession.id == session_id)
            )
        ).one()
        return row[0], row[1]


def passed_ownership(response: httpx.Response) -> bool:
    """쿠키 · Origin · 소유권 검사를 지났는가. 그 뒤 콘텐츠 단계의 404(Object 없음 등)는 상관없다."""
    if response.status_code in (401, 403):
        return False
    if response.status_code == 404:
        return response.json().get("detail") != "Play session not found."
    return True


def hashed(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ── 게스트 발급 · 재사용 · 만료 · 폐기 · Origin ──


def test_guest_issue_reuse_expire_revoke_and_origin():
    async def scenario(sessions):
        a = Browser()
        try:
            first = await a.anonymous()
            assert first.status_code == 201
            token = a.cookie(GUEST_COOKIE)
            assert token and "set-cookie" in first.headers
            anonymous_id = first.json()["data"]["anonymous_session_id"]
            guest = await scalar(
                sessions,
                select(GuestSession).where(GuestSession.token_hash == hashed(token)),
            )
            assert (
                guest.anonymous_session_id == anonymous_id and guest.revoked_at is None
            )
            assert token not in (guest.token_hash, guest.id)

            # 유효한 게스트: 같은 익명 세션, 새 게스트 · 쿠키 없음
            again = await a.anonymous()
            assert again.json()["data"]["anonymous_session_id"] == anonymous_id
            assert "set-cookie" not in again.headers
            assert (
                await scalar(sessions, select(func.count()).select_from(GuestSession))
                == 1
            )

            # 만료된 게스트 쿠키는 재사용하지 않는다 → 새 게스트
            async with sessions() as db:
                await db.execute(
                    update(GuestSession).values(
                        expires_at=utc_now() - timedelta(seconds=1)
                    )
                )
                await db.commit()
            expired = await a.anonymous()
            assert expired.json()["data"]["anonymous_session_id"] != anonymous_id
            assert a.cookie(GUEST_COOKIE) != token

            # 폐기된 게스트도 마찬가지
            current = a.cookie(GUEST_COOKIE)
            async with sessions() as db:
                await db.execute(
                    update(GuestSession)
                    .where(GuestSession.token_hash == hashed(current))
                    .values(revoked_at=utc_now())
                )
                await db.commit()
            revoked = await a.anonymous()
            assert (
                revoked.json()["data"]["anonymous_session_id"]
                != expired.json()["data"]["anonymous_session_id"]
            )
            assert (
                await scalar(sessions, select(func.count()).select_from(GuestSession))
                == 3
            )
        finally:
            await a.close()

        # Origin 없음 · 다른 Origin → 403, 게스트를 만들지 않는다
        for origin in (None, "https://evil.invalid"):
            stranger = Browser(origin=origin)
            try:
                response = await stranger.anonymous()
                assert response.status_code == 403
                assert response.json()["detail"] == "Origin not allowed."
                assert stranger.cookie(GUEST_COOKIE) is None
            finally:
                await stranger.close()
        assert (
            await scalar(sessions, select(func.count()).select_from(GuestSession)) == 3
        )

    run(scenario)


# ── 소유권 · 401 · 403 · 404 · 재전송 · asset_base_path ──


def test_guest_ownership_routes_replay_and_asset_path():
    async def scenario(sessions):
        a, b, nobody, evil = (
            Browser(),
            Browser(),
            Browser(),
            Browser(origin="https://evil.invalid"),
        )
        try:
            anonymous_a, session_a = await a.guest_play()
            anonymous_b, _ = await b.guest_play()
            assert await owner_of(sessions, session_a) == (None, anonymous_a)

            # 생성 · 조회 응답의 asset_base_path(고정 버전)
            created = (await a.reads(session_a))[0]
            assert created.status_code == 200
            assert created.json()["data"]["asset_base_path"] == f"/c/{CASE}/v1"

            # 내 세션: 읽기 3종은 소유권 통과(콘텐츠 결과는 상관없이 401 · 403 · 404 아님)
            for response in await a.reads(session_a):
                assert passed_ownership(response), response.text
            for response in (
                await a.interaction(session_a, str(uuid4())),
                await a.hint(session_a),
                await a.npc(session_a),
            ):
                assert passed_ownership(response), response.text

            # 남의 세션 = 없는 세션: 같은 404 · 같은 본문
            missing = str(uuid4())
            not_found = (await b.reads(missing))[0]
            assert not_found.status_code == 404
            for response in [
                *(await b.reads(session_a)),
                await b.interaction(session_a, str(uuid4())),
                await b.hint(session_a),
                await b.hint_alias(session_a),
                await b.npc(session_a),
            ]:
                assert response.status_code == 404, response.text
                assert response.json() == not_found.json()

            # 같은 client_event_id 재전송도 소유자만 — 저장된 결과를 남에게 재생하지 않는다
            event_id = str(uuid4())
            owner_first = await a.interaction(session_a, event_id)
            assert (await b.interaction(session_a, event_id)).status_code == 404
            assert (
                await a.interaction(session_a, event_id)
            ).status_code == owner_first.status_code

            # 쿠키 없음 → 401(읽기 · 쓰기 · 생성)
            for response in [
                *(await nobody.reads(session_a)),
                await nobody.interaction(session_a, str(uuid4())),
                await nobody.start(anonymous_a),
            ]:
                assert response.status_code == 401, response.text
                assert response.json()["detail"] == "Play session cookie required."

            # Origin 이 다르면 쿠키가 있어도 403(쓰기)
            evil.client.cookies.set(GUEST_COOKIE, a.cookie(GUEST_COOKIE))
            for response in (
                await evil.interaction(session_a, str(uuid4())),
                await evil.npc(session_a),
                await evil.hint(session_a),
            ):
                assert response.status_code == 403, response.text

            # 본문의 남의 익명 세션으로는 만들 수 없다(권한 아님)
            stolen = await a.start(anonymous_b)
            assert (
                stolen.status_code == 404
                and stolen.json()["detail"] == "Anonymous session not found."
            )

            # 소유자 없는(레거시) 행은 아무도 못 본다
            legacy_id = str(uuid4())
            async with sessions() as db:
                now = utc_now()
                db.add(
                    PlaySession(
                        id=legacy_id,
                        anonymous_session_id=anonymous_a,
                        case_id=CASE,
                        state_json={},
                        created_at=now,
                        updated_at=now,
                        hint_balance=0,
                        help_used=0,
                    )
                )
                await db.commit()
            assert (await a.reads(legacy_id))[0].status_code == 404

            # 레거시(버전 없음) 세션의 asset_base_path 는 null
            unpinned = await a.start(anonymous_a, version=None)
            if unpinned.status_code == 201:
                assert unpinned.json()["data"]["asset_base_path"] is None
        finally:
            for browser in (a, b, nobody, evil):
                await browser.close()

    run(scenario)


def test_asset_path_stays_on_the_pinned_version_after_a_new_publication():
    store = store_with(pinned())

    async def scenario(sessions):
        a = Browser()
        try:
            _, session_a = await a.guest_play()
            # 같은 케이스의 새 버전이 게시돼도(저장소에 v2 등록) 기존 세션 경로는 v1 그대로
            fingerprint = "sha256:" + "f" * 64
            store.add(
                PinnedContent(
                    ContentPin(CASE, 2, fingerprint),
                    client=make_client(),
                    server=runtime_with_two_hinted_puzzles(),
                    npc=npc_pack(content_version=2, content_fingerprint=fingerprint),
                    idmap=None,
                )
            )
            read = (await a.reads(session_a))[0]
            assert read.json()["data"]["asset_base_path"] == f"/c/{CASE}/v1"
            # 새로 시작한 세션은 v2 경로, 기존 세션은 계속 v1
            anonymous_a = (await a.anonymous()).json()["data"]["anonymous_session_id"]
            newer = await a.start(anonymous_a, version=2)
            assert newer.status_code == 201, newer.text
            assert newer.json()["data"]["asset_base_path"] == f"/c/{CASE}/v2"
            again = (await a.reads(session_a))[0]
            assert again.json()["data"]["asset_base_path"] == f"/c/{CASE}/v1"
        finally:
            await a.close()

    run(scenario, store=store)


# ── 로그인 승계 · 로그인 쿠키 우선 ──


def test_local_login_transfers_guest_progress_once():
    async def scenario(sessions):
        a, other = Browser(), Browser()
        try:
            anonymous_a, first = await a.guest_play()
            second = (await a.start(anonymous_a)).json()["data"]["play_session_id"]
            guest_token = a.cookie(GUEST_COOKIE)

            completed_at = utc_now()
            async with sessions.begin() as db:
                completed = await db.get(PlaySession, second)
                completed.state_json = {
                    **completed.state_json,
                    "completed_puzzle_ids": ["PZ_A"],
                }
                completed.completed_at = completed_at
                completed.hint_balance = 1

            registered = await a.register("a")
            assert registered.status_code == 201, registered.text
            user_id = registered.json()["user"]["user_id"]
            email = registered.json()["user"]["email"]
            assert a.cookie(SESSION_COOKIE)
            assert a.cookie(GUEST_COOKIE) is None  # 승계 뒤 게스트 쿠키를 지운다
            for session_id in (first, second):
                assert await owner_of(sessions, session_id) == (user_id, None)
                assert (await a.reads(session_id))[0].status_code == 200
            async with sessions() as db:
                completed = await db.get(PlaySession, second)
                assert completed.state_json["completed_puzzle_ids"] == ["PZ_A"]
                assert completed.completed_at == completed_at
                assert completed.hint_balance == 1
            guest = await scalar(
                sessions,
                select(GuestSession).where(
                    GuestSession.token_hash == hashed(guest_token)
                ),
            )
            assert guest.revoked_at is not None
            transfer = await scalar(sessions, select(GuestSessionTransfer))
            assert (
                transfer.app_user_id,
                transfer.play_session_count,
                transfer.guest_session_id,
            ) == (user_id, 2, guest.id)

            # 같은 게스트 쿠키로 다시 로그인(반복 콜백)해도 결과가 같다 — 기록은 하나
            a.client.cookies.set(GUEST_COOKIE, guest_token)
            again = await a.login(email)
            assert again.status_code == 200
            assert (
                await scalar(
                    sessions, select(func.count()).select_from(GuestSessionTransfer)
                )
                == 1
            )

            # 다른 사용자 · 게스트는 못 본다
            await other.register("other")
            assert (await other.reads(first))[0].status_code == 404

            # 로그인 쿠키가 게스트 쿠키보다 우선 — 새 세션의 소유자는 계정
            fresh_guest = Browser()
            try:
                await fresh_guest.anonymous()
                a.client.cookies.set(GUEST_COOKIE, fresh_guest.cookie(GUEST_COOKIE))
            finally:
                await fresh_guest.close()
            anonymous_for_user = (await a.anonymous()).json()["data"][
                "anonymous_session_id"
            ]
            created = await a.start(anonymous_for_user)
            assert created.status_code == 201, created.text
            assert await owner_of(
                sessions, created.json()["data"]["play_session_id"]
            ) == (user_id, None)
        finally:
            await a.close()
            await other.close()

    run(scenario)


def test_concurrent_logins_transfer_once():
    async def scenario(sessions):
        owner = Browser()
        try:
            registered = await owner.register("c")
            email = registered.json()["user"]["email"]
        finally:
            await owner.close()
        a = Browser()
        try:
            _, session_a = await a.guest_play()
            token = a.cookie(GUEST_COOKIE)
            clients = []
            for _ in range(3):
                browser = Browser()
                browser.client.cookies.set(GUEST_COOKIE, token)
                clients.append(browser)
            results = await asyncio.gather(
                *(browser.login(email) for browser in clients)
            )
            assert all(result.status_code == 200 for result in results)
            assert (
                await scalar(
                    sessions, select(func.count()).select_from(GuestSessionTransfer)
                )
                == 1
            )
            assert (await owner_of(sessions, session_a))[0] == registered.json()[
                "user"
            ]["user_id"]
            for browser in clients:
                await browser.close()
        finally:
            await a.close()

    run(scenario)


@pytest.mark.parametrize("provider", ["google", "naver"])
def test_social_login_transfers_guest_progress(monkeypatch, provider):
    async def scenario(sessions):
        account = Browser()
        try:
            registered = (await account.register(provider)).json()["user"]
        finally:
            await account.close()
        social_user = SocialUserResponse(
            user=SocialAccountUser(**{**registered, "provider": provider})
        )

        async def authenticate(db, profile):
            return social_user

        monkeypatch.setattr(
            auth_api, "verify_google_credential", lambda *args: object()
        )
        monkeypatch.setattr(
            auth_api, "verify_naver_authorization_code", lambda *args: object()
        )
        monkeypatch.setattr(auth_api, "authenticate_social_user", authenticate)

        a = Browser()
        try:
            _, session_a = await a.guest_play()
            body = (
                {"credential": "synthetic"}
                if provider == "google"
                else {"code": "synthetic", "state": "synthetic"}
            )
            response = await a.client.post(f"/api/v1/auth/{provider}", json=body)
            assert response.status_code == 200, response.text
            assert await owner_of(sessions, session_a) == (registered["user_id"], None)
            assert a.cookie(GUEST_COOKIE) is None and a.cookie(SESSION_COOKIE)
            assert (
                await scalar(
                    sessions, select(func.count()).select_from(GuestSessionTransfer)
                )
                == 1
            )
        finally:
            await a.close()

    run(scenario)


@pytest.mark.parametrize(
    "failure",
    [
        RuntimeError("synthetic transfer failure"),
        IntegrityError(None, None, ValueError()),
    ],
)
def test_failed_transfer_keeps_guest_progress(monkeypatch, failure):
    async def scenario(sessions):
        a = Browser()
        try:
            anonymous_a, session_a = await a.guest_play()
            token = a.cookie(GUEST_COOKIE)

            def broken_transfer_record(*args, **kwargs):
                raise failure

            # Fail after the ownership UPDATE, before the audit record is added.
            monkeypatch.setattr(
                guest_service, "GuestSessionTransfer", broken_transfer_record
            )
            registered = await a.register("fail")
            # 로그인은 성공, 게스트 진행 · 쿠키는 그대로(다음 로그인 때 다시 옮긴다)
            assert registered.status_code == 201
            assert await owner_of(sessions, session_a) == (None, anonymous_a)
            guest = await scalar(
                sessions,
                select(GuestSession).where(GuestSession.token_hash == hashed(token)),
            )
            assert guest.revoked_at is None
            assert (
                await scalar(
                    sessions, select(func.count()).select_from(GuestSessionTransfer)
                )
                == 0
            )
            assert a.cookie(GUEST_COOKIE) == token
            monkeypatch.undo()

            # 고친 뒤 다시 로그인하면 옮겨진다
            relogin = await a.login(registered.json()["user"]["email"])
            assert relogin.status_code == 200
            assert (await owner_of(sessions, session_a))[0] == registered.json()[
                "user"
            ]["user_id"]
        finally:
            await a.close()

    run(scenario)


def test_anonymous_sessions_issue_guest_but_login_owns_the_play():
    async def scenario(sessions):
        a = Browser()
        try:
            registered = await a.register("user")
            before = await scalar(
                sessions, select(func.count()).select_from(GuestSession)
            )
            response = await a.anonymous()
            assert response.status_code == 201
            assert a.cookie(GUEST_COOKIE) is not None
            assert (
                await scalar(sessions, select(func.count()).select_from(GuestSession))
                == before + 1
            )
            reused = await a.anonymous()
            assert reused.json() == response.json()
            assert "set-cookie" not in reused.headers
            created = await a.start(response.json()["data"]["anonymous_session_id"])
            assert created.status_code == 201
            assert await owner_of(
                sessions, created.json()["data"]["play_session_id"]
            ) == (registered.json()["user"]["user_id"], None)
            assert (
                await scalar(
                    sessions,
                    select(func.count())
                    .select_from(AnonymousSession)
                    .where(
                        AnonymousSession.id
                        == response.json()["data"]["anonymous_session_id"]
                    ),
                )
                == 1
            )
        finally:
            await a.close()

    run(scenario)


def test_play_creation_rechecks_guest_after_concurrent_transfer():
    async def scenario(sessions):
        guest = Browser()
        login = Browser()
        reached_guard = asyncio.Event()
        release_create = asyncio.Event()

        async def paused_guard(db, pin):
            reached_guard.set()
            await release_create.wait()

        try:
            anonymous_id, existing_play = await guest.guest_play()
            login.client.cookies.set(GUEST_COOKIE, guest.cookie(GUEST_COOKIE))
            app.dependency_overrides[get_new_session_publication_guard] = lambda: (
                paused_guard
            )
            async with asyncio.TaskGroup() as tasks:
                create = tasks.create_task(guest.start(anonymous_id))
                try:
                    await asyncio.wait_for(reached_guard.wait(), timeout=10)
                    registered = await asyncio.wait_for(
                        login.register("racing"), timeout=10
                    )
                    assert registered.status_code == 201
                finally:
                    release_create.set()

            assert create.result().status_code == 401
            assert await owner_of(sessions, existing_play) == (
                registered.json()["user"]["user_id"],
                None,
            )
            assert (
                await scalar(sessions, select(func.count()).select_from(PlaySession))
                == 1
            )
        finally:
            await guest.close()
            await login.close()

    run(scenario)


def test_concurrent_cookie_less_requests_get_distinct_reusable_guests():
    async def scenario(sessions):
        browsers = [Browser(), Browser()]
        try:
            first = await asyncio.gather(*(browser.anonymous() for browser in browsers))
            assert all(response.status_code == 201 for response in first)
            ids = {
                response.json()["data"]["anonymous_session_id"] for response in first
            }
            tokens = {browser.cookie(GUEST_COOKIE) for browser in browsers}
            assert len(ids) == len(tokens) == 2 and None not in tokens

            second = await asyncio.gather(
                *(browser.anonymous() for browser in browsers)
            )
            assert [response.json() for response in second] == [
                response.json() for response in first
            ]
            assert all("set-cookie" not in response.headers for response in second)
            assert (
                await scalar(sessions, select(func.count()).select_from(GuestSession))
                == 2
            )
            assert (
                await scalar(
                    sessions, select(func.count()).select_from(AnonymousSession)
                )
                == 2
            )
        finally:
            for browser in browsers:
                await browser.close()

    run(scenario)
