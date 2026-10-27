from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app


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

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_db, None)
