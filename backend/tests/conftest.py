from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from app.api.v1.play_sessions import get_new_session_publication_guard
from app.db.session import get_db
from app.main import app
from app.services.play_principal import (
    PlayPrincipal,
    current_play_principal,
    require_play_origin,
    require_play_session_owner,
)


class FakeAsyncSession:
    def __init__(self) -> None:
        self.get_result: Any = None
        self.scalar_result: Any = None
        self.added: list[Any] = []
        self.get_calls: list[tuple[type[Any], str]] = []
        self.get_options: list[dict[str, Any]] = []
        self.scalar_calls: list[Any] = []
        self.execute_calls: list[Any] = []
        self.operation_log: list[str] = []
        self.commit_count = 0
        self.refresh_count = 0
        self.rollback_count = 0
        self.commit_error: Exception | None = None
        self.execute_error: Exception | None = None

    async def get(
        self,
        model: type[Any],
        entity_id: str,
        **options: Any,
    ) -> Any:
        self.get_calls.append((model, entity_id))
        self.get_options.append(options)
        self.operation_log.append("get")
        return self.get_result

    def add(self, entity: Any) -> None:
        self.added.append(entity)

    async def scalar(self, statement: Any) -> Any:
        self.scalar_calls.append(statement)
        self.operation_log.append("scalar")
        if isinstance(self.scalar_result, list):
            if not self.scalar_result:
                return None
            return self.scalar_result.pop(0)
        return self.scalar_result

    async def execute(self, statement: Any) -> None:
        self.execute_calls.append(statement)
        if self.execute_error is not None:
            raise self.execute_error

    async def commit(self) -> None:
        self.commit_count += 1
        self.operation_log.append("commit")
        if self.commit_error is not None:
            raise self.commit_error

    async def refresh(self, entity: Any) -> None:
        self.refresh_count += 1

    async def rollback(self) -> None:
        self.rollback_count += 1
        self.operation_log.append("rollback")


class _ExpiringProxy:
    """읽어 온 뒤 rollback이 있었으면 속성 접근이 실패한다.

    실제 SQLAlchemy는 rollback 때 객체를 만료시키고, AsyncSession에서 만료된 속성을 읽으면
    암묵적 다시 읽기가 일어난다.
    """

    def __init__(self, target: Any, db: FakeAsyncSession) -> None:
        object.__setattr__(self, "_target", target)
        object.__setattr__(self, "_db", db)
        object.__setattr__(self, "_loaded_at_rollback", db.rollback_count)

    def __getattr__(self, name: str) -> Any:
        if self._db.rollback_count > self._loaded_at_rollback:
            raise AssertionError(f"rollback 뒤 만료된 속성 접근: {name}")
        return getattr(self._target, name)

    def __setattr__(self, name: str, value: Any) -> None:
        setattr(self._target, name, value)


class ExpiringSession(FakeAsyncSession):
    async def get(self, model, entity_id, **options):
        found = await super().get(model, entity_id, **options)
        return None if found is None else _ExpiringProxy(found, self)

    async def scalar(self, statement):
        found = await super().scalar(statement)
        return None if found is None else _ExpiringProxy(found, self)


@pytest.fixture
def db_session() -> FakeAsyncSession:
    return FakeAsyncSession()


@pytest.fixture
def client(db_session: FakeAsyncSession) -> Iterator[TestClient]:
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    # 가짜 DB 세션에는 게시 상태 테이블이 없다. 고정 세션 생성의 게시 상태 확인만 기록용 guard로 바꾼다.
    # 운영 guard 연결 · 게시 상태별 차단은 test_content_release(_mysql)가 확인한다.
    app.dependency_overrides[get_new_session_publication_guard] = lambda: (
        published_guard
    )

    try:
        with TestClient(app, headers={"Origin": "http://localhost:5175"}) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_new_session_publication_guard, None)


async def published_guard(db: Any, pin: Any) -> None:
    """테스트용 게시 상태 guard: 저장소에 등록된 버전을 게시 중으로 본다(DB 게시 상태 테이블 없이)."""


async def _legacy_play_principal(request: Request) -> PlayPrincipal:
    """소유권 도입(11/6) 전에 쓰인 테스트용 주체 — 쿠키 대신 본문의 익명 세션을 게스트 주체로 본다.

    새 Play Session 은 그 익명 세션 소유가 되고, 익명 세션 없음 · 만료 오류는 예전처럼 서비스가 낸다.
    실제 쿠키 · 소유권 · Origin 검사는 `real_play_auth` 표시 테스트가 MySQL 로 확인한다.
    """
    anonymous_session_id = None
    if request.method == "POST" and request.url.path.rstrip("/").endswith("/play-sessions"):
        try:
            body = await request.json()
        except Exception:
            body = None
        if isinstance(body, dict) and isinstance(body.get("anonymous_session_id"), str):
            anonymous_session_id = body["anonymous_session_id"]
    return PlayPrincipal(kind="guest", anonymous_session_id=anonymous_session_id)


async def _legacy_owner_check() -> None:
    return None


@pytest.fixture(autouse=True)
def legacy_play_auth(request: pytest.FixtureRequest) -> Iterator[None]:
    """기존 테스트에서만 플레이 API 의 쿠키 주체 · 소유권 · Origin 의존성을 예전 동작으로 바꾼다."""
    if request.node.get_closest_marker("real_play_auth") is not None:
        yield
        return
    overrides = {
        current_play_principal: _legacy_play_principal,
        require_play_session_owner: _legacy_owner_check,
        require_play_origin: _legacy_owner_check,
    }
    app.dependency_overrides.update(overrides)
    try:
        yield
    finally:
        for dependency in overrides:
            app.dependency_overrides.pop(dependency, None)


@pytest.fixture(autouse=True)
def fresh_request_rate_limiter(monkeypatch) -> None:
    """IP 기준 요청 빈도 제한(PR B)의 프로세스 카운터를 테스트마다 새로 둔다.

    테스트 클라이언트는 모두 같은 주소라, 공유하면 앞 테스트의 가입 · 확인 요청이 뒤 테스트의 한도를 깎는다.
    한 테스트 안에서는 실제 한도가 그대로 적용된다.
    """

    from app.services import request_rate_limit

    monkeypatch.setattr(
        request_rate_limit, "_limiter", request_rate_limit.SlidingWindowLimiter()
    )
