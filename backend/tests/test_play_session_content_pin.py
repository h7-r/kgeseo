import io
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import INTEGER, VARCHAR, create_engine
from sqlalchemy.orm import Session

from alembic import command
from app.db.base import Base
from app.models.anonymous_session import AnonymousSession
from app.models.play_session import (
    CONTENT_FINGERPRINT_MAX_LENGTH,
    ContentPinColumnsError,
    PlaySession,
    check_content_pin_columns,
)
from app.services.play_session import create_play_session
from tests.conftest import FakeAsyncSession

BACKEND_DIR = Path(__file__).resolve().parents[1]
NEW_REVISION = "c9e1a4b7d2f0"
PREVIOUS_HEAD = "b8a7c6d5e4f3"
FINGERPRINT = "sha256:" + "0" * 64  # 불투명 문자열(가상)
NOW = datetime(2026, 10, 27, 1, 2, 3)


def play_session(**pin: Any) -> PlaySession:
    return PlaySession(
        id="p" * 36,
        anonymous_session_id="a" * 36,
        case_id="case_pin_test",
        state_json={
            "completed_puzzle_ids": [],
            "acquired_clue_ids": [],
            "hint_levels": {},
            "flags": {},
        },
        created_at=NOW,
        updated_at=NOW,
        completed_at=None,
        **pin,
    )


# --- 칼럼 정의 ---


def test_columns_are_nullable_with_expected_types() -> None:
    columns = PlaySession.__table__.columns

    assert columns["content_version"].nullable is True
    assert isinstance(columns["content_version"].type, INTEGER)
    assert columns["content_fingerprint"].nullable is True
    assert isinstance(columns["content_fingerprint"].type, VARCHAR)
    assert (
        columns["content_fingerprint"].type.length
        == CONTENT_FINGERPRINT_MAX_LENGTH
        == 128
    )
    # DB CHECK 제약은 MySQL 버전 확인 전이라 두지 않았다.
    assert [
        c
        for c in PlaySession.__table__.constraints
        if c.__class__.__name__ == "CheckConstraint"
    ] == []


# --- NULL 조합 규칙 ---


@pytest.mark.parametrize(
    ("version", "fingerprint"),
    [(None, None), (1, FINGERPRINT), (42, "opaque-value")],
)
def test_valid_pin_column_pairs(version: Any, fingerprint: Any) -> None:
    check_content_pin_columns(version, fingerprint)


@pytest.mark.parametrize(
    ("version", "fingerprint"),
    [
        (1, None),
        (None, FINGERPRINT),
        (0, FINGERPRINT),
        (-1, FINGERPRINT),
        (True, FINGERPRINT),
        ("1", FINGERPRINT),
        (1.0, FINGERPRINT),
        (1, ""),
        (1, "   "),
        (1, 7),
        (1, "x" * (CONTENT_FINGERPRINT_MAX_LENGTH + 1)),
    ],
)
def test_invalid_pin_column_pairs(version: Any, fingerprint: Any) -> None:
    with pytest.raises(ContentPinColumnsError) as raised:
        check_content_pin_columns(version, fingerprint)

    if isinstance(fingerprint, str) and fingerprint.strip():
        assert fingerprint not in str(raised.value)


# --- ORM 저장 · 조회 (SQLite 메모리 DB, 실제 MySQL 아님) ---


@pytest.fixture
def sqlite_session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(
            AnonymousSession(
                id="a" * 36, created_at=NOW, expires_at=NOW + timedelta(days=1)
            )
        )
        session.commit()
        yield session
    engine.dispose()


def test_legacy_session_without_pin_saves_and_reads_back(
    sqlite_session: Session,
) -> None:
    sqlite_session.add(play_session())
    sqlite_session.commit()
    sqlite_session.expire_all()

    saved = sqlite_session.get(PlaySession, "p" * 36)
    assert (saved.content_version, saved.content_fingerprint) == (None, None)


def test_pinned_session_saves_and_reads_back(sqlite_session: Session) -> None:
    sqlite_session.add(play_session(content_version=3, content_fingerprint=FINGERPRINT))
    sqlite_session.commit()
    sqlite_session.expire_all()

    saved = sqlite_session.get(PlaySession, "p" * 36)
    assert (saved.content_version, saved.content_fingerprint) == (3, FINGERPRINT)


@pytest.mark.parametrize(
    "pin",
    [
        {"content_version": 3},
        {"content_fingerprint": FINGERPRINT},
        {"content_version": 0, "content_fingerprint": FINGERPRINT},
        {"content_version": 3, "content_fingerprint": " "},
    ],
)
def test_partial_or_invalid_pin_is_rejected_on_insert(
    sqlite_session: Session, pin: dict
) -> None:
    sqlite_session.add(play_session(**pin))

    with pytest.raises(ContentPinColumnsError):
        sqlite_session.flush()
    sqlite_session.rollback()
    assert sqlite_session.get(PlaySession, "p" * 36) is None


def test_partial_pin_is_rejected_on_update(sqlite_session: Session) -> None:
    sqlite_session.add(play_session(content_version=3, content_fingerprint=FINGERPRINT))
    sqlite_session.commit()

    saved = sqlite_session.get(PlaySession, "p" * 36)
    saved.content_fingerprint = None
    with pytest.raises(ContentPinColumnsError):
        sqlite_session.flush()
    sqlite_session.rollback()
    sqlite_session.expire_all()
    assert sqlite_session.get(PlaySession, "p" * 36).content_fingerprint == FINGERPRINT


def test_state_updates_keep_existing_pin(sqlite_session: Session) -> None:
    sqlite_session.add(play_session(content_version=3, content_fingerprint=FINGERPRINT))
    sqlite_session.commit()

    saved = sqlite_session.get(PlaySession, "p" * 36)
    saved.state_json = {**saved.state_json, "flags": {"opened": True}}
    sqlite_session.commit()
    sqlite_session.expire_all()

    reread = sqlite_session.get(PlaySession, "p" * 36)
    assert reread.state_json["flags"] == {"opened": True}
    assert (reread.content_version, reread.content_fingerprint) == (3, FINGERPRINT)


# --- 기존 생성 · 조회 동작 ---


@pytest.mark.anyio
async def test_create_play_session_still_creates_legacy_session() -> None:
    db = FakeAsyncSession()
    db.get_result = AnonymousSession(
        id="anon", created_at=NOW, expires_at=datetime.now() + timedelta(days=1)
    )

    session = await create_play_session(db, "anon", "case_001")

    assert (session.content_version, session.content_fingerprint) == (None, None)
    assert "content_version" not in session.state_json
    assert "content_fingerprint" not in session.state_json


def test_read_api_response_contract_is_unchanged(
    client: TestClient, db_session: FakeAsyncSession
) -> None:
    db_session.get_result = play_session(
        content_version=3, content_fingerprint=FINGERPRINT
    )

    response = client.get(f"/api/v1/play-sessions/{'p' * 36}")

    assert response.status_code == 200
    data = response.json()["data"]
    assert set(data) == {
        "play_session_id",
        "case_id",
        "created_at",
        "updated_at",
        "completed_at",
        "state",
        "asset_base_path",
    }
    # 고정 버전 3 의 에셋 경로(11/6 PM) — 응답에 fingerprint 는 여전히 싣지 않는다.
    assert data["asset_base_path"] == f"/c/{data['case_id']}/v3"
    assert FINGERPRINT not in response.text


# --- Alembic ---


def alembic_config(output: io.StringIO | None = None) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"), output_buffer=output)
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return config


def test_new_revision_is_single_head_after_previous_head() -> None:
    script = ScriptDirectory.from_config(alembic_config())

    # 승인 이력(d2a6f8b1c903)과 멱등 · 게시 상태(e4c1f7a2b9d6 → f3b8d2c6a1e7)는 콘텐츠 고정 revision에서
    # 갈라지고, merge revision a5c7e9b2d4f6이 합친다. 그 위에 힌트 잔액(b6d4e2f8a1c3)이 있다.
    # content_reviews(e2a7c4f9b1d3)도 콘텐츠 고정 revision에서 갈라지고, merge revision 7c3e5a9d1f42가
    # 두 계열을 합친다. 소셜 온보딩(c9d8e7f6a5b4)은 이전 head에서 갈라지고, merge revision 4b8e1d6a9c27이
    # 7c3e5a9d1f42와 합친다. 그 위에 승인 기록 실행자 열(b3f7c2e9a4d1, PM v0.4.13)이 단일 head다.
    # 각 부모 관계는 그대로다.
    # 그 위의 계정 데이터(c1d2e3f4a5b6), 그 위의 게스트 세션 · Play Session 소유자(d8f2a6c4e1b9, 11/6 PM),
    # 그 위의 베타 분석 기록(a3f9c2e7b1d4, 11/11 — 새 표만)이 지금 단일 head다.
    # 그 위에 1:1 문의 · 관리자 설정(e7a1b2c3d4f5, 11/13 해랑 — 새 표만)이 지금 단일 head다.
    # ⚠ 세진 마이그레이션(is_test → 감사 로그 확장 → 공지)이 먼저 머지되면 e7a1b2c3d4f5 의 down_revision 과 이 줄을 그 뒤로 옮긴다.
    assert script.get_heads() == ["e7a1b2c3d4f5"]
    assert script.get_revision("e7a1b2c3d4f5").down_revision == "a3f9c2e7b1d4"
    assert script.get_revision("a3f9c2e7b1d4").down_revision == "d8f2a6c4e1b9"
    assert script.get_revision("d8f2a6c4e1b9").down_revision == "c1d2e3f4a5b6"
    assert script.get_revision("c1d2e3f4a5b6").down_revision == "b3f7c2e9a4d1"
    assert script.get_revision("b3f7c2e9a4d1").down_revision == "4b8e1d6a9c27"
    assert sorted(script.get_revision("4b8e1d6a9c27").down_revision) == [
        "7c3e5a9d1f42",
        "c9d8e7f6a5b4",
    ]
    assert script.get_revision("c9d8e7f6a5b4").down_revision == PREVIOUS_HEAD
    assert sorted(script.get_revision("7c3e5a9d1f42").down_revision) == [
        "b6d4e2f8a1c3",
        "e2a7c4f9b1d3",
    ]
    assert script.get_revision("e2a7c4f9b1d3").down_revision == NEW_REVISION
    assert script.get_revision("b6d4e2f8a1c3").down_revision == "a5c7e9b2d4f6"
    assert sorted(script.get_revision("a5c7e9b2d4f6").down_revision) == [
        "d2a6f8b1c903",
        "f3b8d2c6a1e7",
    ]
    assert script.get_revision("d2a6f8b1c903").down_revision == NEW_REVISION
    assert script.get_revision("f3b8d2c6a1e7").down_revision == "e4c1f7a2b9d6"
    assert script.get_revision("e4c1f7a2b9d6").down_revision == NEW_REVISION
    assert script.get_revision(NEW_REVISION).down_revision == PREVIOUS_HEAD


def test_offline_sql_adds_and_drops_only_new_nullable_columns() -> None:
    # 오프라인(--sql) 모드: DB에 연결하지 않고 MySQL DDL 문자열만 만든다.
    upgrade_sql = io.StringIO()
    command.upgrade(
        alembic_config(upgrade_sql), f"{PREVIOUS_HEAD}:{NEW_REVISION}", sql=True
    )
    downgrade_sql = io.StringIO()
    command.downgrade(
        alembic_config(downgrade_sql), f"{NEW_REVISION}:{PREVIOUS_HEAD}", sql=True
    )

    up = [
        line for line in upgrade_sql.getvalue().splitlines() if line.startswith("ALTER")
    ]
    down = [
        line
        for line in downgrade_sql.getvalue().splitlines()
        if line.startswith("ALTER")
    ]
    assert up == [
        "ALTER TABLE play_sessions ADD COLUMN content_version INTEGER;",
        "ALTER TABLE play_sessions ADD COLUMN content_fingerprint VARCHAR(128);",
    ]
    assert down == [
        "ALTER TABLE play_sessions DROP COLUMN content_fingerprint;",
        "ALTER TABLE play_sessions DROP COLUMN content_version;",
    ]
    assert "NOT NULL" not in upgrade_sql.getvalue()
    assert "UPDATE play_sessions" not in upgrade_sql.getvalue()
