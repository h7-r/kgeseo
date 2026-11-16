"""공지사항 API v0.2(11/16 세진) — DB 없이 보는 것.

- 상태 계산(초안 · 예약 · 게시, 경계) · published_at timezone 필수 · 길이 · 분류 · 모르는 필드 검증
- 관리자 권한 · Origin · 생성/수정/삭제 흐름과 감사 기록(target_type="notice") · 삭제된 공지는 없는 것
- 공개 쿼리 값 검증 · 옛 공지 이전 스크립트(원본 파싱 · 제외 사유 · 결정적 id · 중복 실행 방지 · 사용 오류)
실제 공개 조건 · 정렬 · 쪽 나눔 · 예약 시각 경과 · 마이그레이션은 `test_notices_mysql.py`(격리 MySQL)가 본다.
"""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Any

import pytest

from app.api.v1 import admin as admin_api
from app.main import app
from app.models import notice as notice_model
from app.models.account_data import AdminAuditLog
from app.models.app_user import AppUser
from app.models.notice import Notice
from app.schemas import notice as notice_schema
from app.services.notice import notice_status, to_utc_naive
from app.services.user_session import current_user
from scripts import import_legacy_notices as legacy
from tests.conftest import FakeAsyncSession

ADMIN = AppUser(
    id="00000000-0000-4000-8000-000000000001",
    email="admin@example.com",
    nickname="운영자",
    role="admin",
)
MEMBER = AppUser(
    id="00000000-0000-4000-8000-000000000002",
    email="member@example.com",
    nickname="회원",
    role="user",
)
NOW = datetime(2026, 11, 16, 3, 0, 0)
NOTICE_ID = "5f0c3a1e-9b2d-4c7e-8a41-2d6f0b9e7c13"


class ModelSession(FakeAsyncSession):
    """get 이 모델별로 다른 값을 준다(공지 · 작성자)."""

    def __init__(self, by_model: dict[type, Any] | None = None) -> None:
        super().__init__()
        self.by_model = by_model or {}

    async def get(self, model, entity_id, **options):
        await super().get(model, entity_id, **options)
        return self.by_model.get(model)


def _notice(**overrides) -> Notice:
    values = dict(
        id=NOTICE_ID,
        category="update",
        title="기존 제목",
        body="기존 본문",
        is_pinned=False,
        published_at=None,
        created_by=ADMIN.id,
        created_at=NOW - timedelta(days=1),
        updated_at=NOW - timedelta(days=1),
        deleted_at=None,
    )
    values.update(overrides)
    return Notice(**values)


@pytest.fixture(autouse=True)
def clear_user():
    yield
    app.dependency_overrides.pop(current_user, None)


def sign_in(user: AppUser) -> None:
    app.dependency_overrides[current_user] = lambda: user


def _audit_rows(db) -> list[AdminAuditLog]:
    return [row for row in db.added if isinstance(row, AdminAuditLog)]


def _use(client, db) -> None:
    from app.db.session import get_db

    async def override():
        yield db

    app.dependency_overrides[get_db] = override


VALID = {"category": "update", "title": "v0.4 업데이트", "body": "본문입니다."}


# --- 상수 · 상태 계산 ---


def test_schema_and_model_limits_agree():
    assert notice_schema.TITLE_MAX == notice_model.NOTICE_TITLE_MAX == 200
    assert notice_schema.BODY_MAX == notice_model.NOTICE_BODY_MAX == 20_000
    assert set(notice_schema.NoticeCategory.__args__) == set(
        notice_model.NOTICE_CATEGORIES
    )
    assert set(admin_api.NOTICE_CATEGORIES) == set(notice_model.NOTICE_CATEGORIES)


@pytest.mark.parametrize(
    ("published_at", "status"),
    [
        (None, "draft"),
        (NOW + timedelta(microseconds=1), "scheduled"),
        (NOW, "published"),
        (NOW - timedelta(days=3), "published"),
    ],
)
def test_status_is_computed_from_published_at(published_at, status):
    assert notice_status(published_at, NOW) == status


def test_aware_published_at_is_stored_as_utc_naive():
    from datetime import timezone

    kst = timezone(timedelta(hours=9))
    assert to_utc_naive(datetime(2026, 11, 16, 9, 0, tzinfo=kst)) == datetime(
        2026, 11, 16, 0, 0
    )
    with pytest.raises(ValueError):
        to_utc_naive(datetime(2026, 11, 16, 9, 0))


def test_audit_actions_include_notice_changes_only():
    for action in ("create_notice", "update_notice", "delete_notice"):
        assert action in admin_api.AUDIT_ACTIONS
    assert not {"read_notice", "list_notices"} & admin_api.AUDIT_ACTIONS


# --- 관리자 권한 · Origin ---


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/v1/admin/notices"),
        ("get", f"/api/v1/admin/notices/{NOTICE_ID}"),
        ("post", "/api/v1/admin/notices"),
        ("patch", f"/api/v1/admin/notices/{NOTICE_ID}"),
        ("delete", f"/api/v1/admin/notices/{NOTICE_ID}"),
    ],
)
def test_admin_notice_routes_need_login_and_admin_role(
    client, db_session, method, path
):
    kwargs = {"json": VALID} if method in {"post", "patch"} else {}
    assert getattr(client, method)(path, **kwargs).status_code == 401
    sign_in(MEMBER)
    response = getattr(client, method)(path, **kwargs)
    assert response.status_code == 403
    assert response.json() == {"detail": "Admin only."}
    assert db_session.added == [] and db_session.commit_count == 0


def test_admin_write_refuses_foreign_origin(client, db_session):
    sign_in(ADMIN)
    response = client.post(
        "/api/v1/admin/notices", json=VALID, headers={"Origin": "https://evil.example"}
    )
    assert response.status_code == 403
    assert db_session.added == []


# --- 생성 ---


def test_create_draft_scheduled_published_and_audit(client, db_session, monkeypatch):
    monkeypatch.setattr(admin_api, "utc_now", lambda: NOW)
    sign_in(ADMIN)
    cases = [
        (None, "draft", None),
        ("2026-11-20T00:00:00Z", "scheduled", "2026-11-20T00:00:00"),
        ("2026-11-16T12:00:00+09:00", "published", "2026-11-16T03:00:00"),
    ]
    for published_at, status, stored in cases:
        body = {**VALID, "is_pinned": True, "published_at": published_at}
        response = client.post("/api/v1/admin/notices", json=body)
        assert response.status_code == 201, response.text
        assert response.headers["Cache-Control"] == "no-store"
        data = response.json()
        assert data["status"] == status
        assert data["published_at"] == stored
        assert data["is_pinned"] is True
        assert data["created_by"] == {"user_id": ADMIN.id, "nickname": "운영자"}
        assert data["body"] == "본문입니다."
    notices = [row for row in db_session.added if isinstance(row, Notice)]
    audits = _audit_rows(db_session)
    assert len(notices) == len(audits) == 3
    for notice, audit in zip(notices, audits, strict=True):
        assert audit.action == "create_notice"
        assert (audit.target_type, audit.target_id, audit.target_user_id) == (
            "notice",
            notice.id,
            None,
        )
        assert notice.created_by == ADMIN.id and notice.deleted_at is None
    # 공지 id 는 UUID 표준 표기
    assert all(len(n.id) == 36 and n.id == n.id.lower() for n in notices)


@pytest.mark.parametrize(
    "patch",
    [
        {"category": "notice"},
        {"category": None},
        {"title": ""},
        {"title": "   "},
        {"title": "가" * 201},
        {"body": ""},
        {"body": "가" * 20_001},
        {"published_at": "2026-11-16T12:00:00"},  # timezone 없음
        {"published_at": "2026-11-16"},
        {"published_at": "내일"},
        {"status": "published"},  # 상태는 서버가 계산
        {"views": 3},
    ],
)
def test_create_validation_errors(client, db_session, patch):
    sign_in(ADMIN)
    response = client.post("/api/v1/admin/notices", json={**VALID, **patch})
    assert response.status_code == 422
    assert db_session.added == []


def test_create_accepts_max_lengths_and_trims_title(client, db_session):
    sign_in(ADMIN)
    # 한글 200자 제목 · 4바이트 문자(이모지) 20,000자 본문 — 길이는 글자 수로 센다
    response = client.post(
        "/api/v1/admin/notices",
        json={**VALID, "title": "가" * 200, "body": "😀" * 20_000},
    )
    assert response.status_code == 201
    assert response.json()["title"] == "가" * 200
    # 앞뒤 공백은 지워 저장한다(길이 검사는 보낸 그대로)
    trimmed = client.post("/api/v1/admin/notices", json={**VALID, "title": "  제목  "})
    assert trimmed.json()["title"] == "제목"


def test_naive_published_at_error_names_timezone(client):
    sign_in(ADMIN)
    response = client.post(
        "/api/v1/admin/notices",
        json={**VALID, "published_at": "2026-11-16T12:00:00"},
    )
    (error,) = response.json()["detail"]
    assert error["type"] == "timezone_aware"
    assert error["loc"] == ["body", "published_at"]


# --- 수정 · 삭제 ---


def test_update_changes_only_sent_fields_and_audits(client, monkeypatch):
    monkeypatch.setattr(admin_api, "utc_now", lambda: NOW)
    row = _notice(published_at=NOW + timedelta(days=1), is_pinned=True)
    db = ModelSession({Notice: row, AppUser: ADMIN})
    _use(client, db)
    sign_in(ADMIN)
    response = client.patch(
        f"/api/v1/admin/notices/{NOTICE_ID.upper()}", json={"title": "새 제목"}
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert (data["title"], data["body"], data["is_pinned"], data["status"]) == (
        "새 제목",
        "기존 본문",
        True,
        "scheduled",
    )
    assert row.updated_at == NOW
    (audit,) = _audit_rows(db)
    assert (audit.action, audit.target_type, audit.target_id, audit.target_user_id) == (
        "update_notice",
        "notice",
        NOTICE_ID,
        None,
    )


def test_update_published_at_null_returns_to_draft(client, monkeypatch):
    monkeypatch.setattr(admin_api, "utc_now", lambda: NOW)
    row = _notice(published_at=NOW - timedelta(days=1))
    db = ModelSession({Notice: row, AppUser: ADMIN})
    _use(client, db)
    sign_in(ADMIN)
    response = client.patch(
        f"/api/v1/admin/notices/{NOTICE_ID}", json={"published_at": None}
    )
    assert response.json()["status"] == "draft"
    assert row.published_at is None


@pytest.mark.parametrize(
    "body",
    [{}, {"title": None}, {"body": None}, {"is_pinned": None}, {"status": "draft"}],
)
def test_update_refuses_empty_or_null_or_unknown(client, body):
    row = _notice()
    db = ModelSession({Notice: row, AppUser: ADMIN})
    _use(client, db)
    sign_in(ADMIN)
    response = client.patch(f"/api/v1/admin/notices/{NOTICE_ID}", json=body)
    assert response.status_code == 422
    assert db.commit_count == 0 and _audit_rows(db) == []


def test_delete_is_soft_and_audited(client, monkeypatch):
    monkeypatch.setattr(admin_api, "utc_now", lambda: NOW)
    row = _notice()
    db = ModelSession({Notice: row, AppUser: ADMIN})
    _use(client, db)
    sign_in(ADMIN)
    response = client.delete(f"/api/v1/admin/notices/{NOTICE_ID}")
    assert response.status_code == 204
    assert response.headers["Cache-Control"] == "no-store"
    assert response.content == b""
    assert row.deleted_at == NOW and row.title == "기존 제목"  # 행 · 본문은 남는다
    (audit,) = _audit_rows(db)
    assert (audit.action, audit.target_type, audit.target_id) == (
        "delete_notice",
        "notice",
        NOTICE_ID,
    )


@pytest.mark.parametrize("found", [None, "deleted"])
@pytest.mark.parametrize(
    ("method", "kwargs"),
    [("get", {}), ("patch", {"json": {"title": "x"}}), ("delete", {})],
)
def test_missing_or_deleted_notice_is_404_everywhere(client, found, method, kwargs):
    row = _notice(deleted_at=NOW) if found == "deleted" else None
    db = ModelSession({Notice: row, AppUser: ADMIN})
    _use(client, db)
    sign_in(ADMIN)
    response = getattr(client, method)(f"/api/v1/admin/notices/{NOTICE_ID}", **kwargs)
    assert response.status_code == 404
    assert response.json() == {"detail": "Notice not found."}
    assert db.commit_count == 0 and _audit_rows(db) == []


def test_admin_detail_shows_draft_and_missing_author(client, monkeypatch):
    monkeypatch.setattr(admin_api, "utc_now", lambda: NOW)
    row = _notice(created_by=None)
    db = ModelSession({Notice: row})
    _use(client, db)
    sign_in(ADMIN)
    response = client.get(f"/api/v1/admin/notices/{NOTICE_ID}")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    data = response.json()
    assert (data["status"], data["created_by"], data["body"]) == (
        "draft",
        None,
        "기존 본문",
    )
    # 조회는 기록하지 않는다
    assert _audit_rows(db) == []


# --- 쿼리 값 검증(공개 · 관리자) ---


@pytest.mark.parametrize(
    "query",
    [
        "page=0",
        "page=abc",
        "page_size=0",
        "page_size=51",
        "category=notice",
        "category=점검",
    ],
)
def test_public_list_rejects_bad_query_without_echo(client, db_session, query):
    response = client.get(f"/api/v1/notices?{query}")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_query"
    assert response.headers["Cache-Control"] == "no-store"
    assert db_session.execute_calls == []


@pytest.mark.parametrize(
    "query", ["status=deleted", "category=x", "limit=51", "offset=-1"]
)
def test_admin_list_rejects_bad_query(client, db_session, query):
    sign_in(ADMIN)
    response = client.get(f"/api/v1/admin/notices?{query}")
    assert response.status_code == 422
    assert db_session.execute_calls == []


class _Empty:
    def scalar_one(self):
        return 0

    def scalar_one_or_none(self):
        return None

    def scalars(self):
        return self

    def all(self):
        return []


class EmptySession(FakeAsyncSession):
    async def execute(self, statement):
        await super().execute(statement)
        return _Empty()


def test_public_routes_need_no_login_and_set_cache_headers(client):
    db = EmptySession()
    _use(client, db)
    listed = client.get("/api/v1/notices")
    assert listed.status_code == 200
    assert listed.headers["Cache-Control"] == "public, max-age=60"
    assert listed.json() == {
        "items": [],
        "page": 1,
        "page_size": 6,
        "total": 0,
        "total_pages": 0,
    }
    missing = client.get(f"/api/v1/notices/{NOTICE_ID}")
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Notice not found."}
    assert missing.headers["Cache-Control"] == "no-store"
    assert db.added == [] and db.commit_count == 0


# --- 옛 공지 이전 스크립트 ---


def test_legacy_source_has_nine_notices_without_body():
    notices = legacy.parse_legacy_notices(
        legacy.DEFAULT_SOURCE.read_text(encoding="utf-8")
    )
    assert len(notices) == 9
    assert all(n.body is None for n in notices)
    planned = legacy.plan(notices, {})
    assert [p.reason for p in planned] == [
        "본문 없음(원본에 본문이 없고 --bodies 에도 없음)"
    ] * 9
    # 원본 값 그대로(분류 · 제목 · 날짜) — 앞 두 건
    assert (notices[0].source_category, notices[0].date) == ("업데이트", "2026.11.04")
    assert notices[1].title == "정기 점검 안내 (9/5 04:00~06:00)"


SAMPLE = """
export const NOTICES: readonly Notice[] = [
  {
    category: "점검",
    title: "정기 점검 \\"안내\\"",
    date: "2026.09.04",
  },
  { category: "이벤트", title: "본문 있는 이벤트", date: "2026.09.01", body: "원본 본문" },
  { category: "이벤트", title: "본문 있는 이벤트", date: "2026.09.01", body: "원본 본문" },
  { category: "공지", title: "모르는 분류", date: "2026.09.02", body: "x" },
  { category: "안내", title: "날짜 이상", date: "2026-09-03", body: "x" },
];
"""


def test_plan_reasons_ids_and_bodies_file():
    notices = legacy.parse_legacy_notices(SAMPLE)
    assert notices[0].title == '정기 점검 "안내"'
    first = legacy.plan(notices, {})
    assert [p.reason for p in first] == [
        "본문 없음(원본에 본문이 없고 --bodies 에도 없음)",
        None,
        "원본 안에서 중복",
        "모르는 분류(공지)",
        "날짜 형식이 아님(2026-09-03)",
    ]
    # 사람이 준 본문 파일(legacy_key)로만 본문을 채운다
    with_body = legacy.plan(notices, {notices[0].legacy_key: "  운영팀이 쓴 본문  "})
    assert with_body[0].is_candidate and with_body[0].body == "운영팀이 쓴 본문"
    # 같은 원본은 늘 같은 id(중복 실행 방지의 근거)
    assert legacy.parse_legacy_notices(SAMPLE)[1].notice_id == notices[1].notice_id
    assert notices[1].notice_id != notices[0].notice_id
    # 00:00 KST = 전날 15:00 UTC
    assert legacy.published_at_of(notices[0]) == datetime(2026, 9, 3, 15, 0)


class _Ids:
    def __init__(self, ids):
        self._ids = ids

    def scalars(self):
        return iter(self._ids)


class ExistingSession(FakeAsyncSession):
    def __init__(self, existing: set[str]) -> None:
        super().__init__()
        self.existing = existing

    async def execute(self, statement):
        await super().execute(statement)
        return _Ids(list(self.existing))


def test_import_skips_existing_ids_including_deleted():
    notices = legacy.parse_legacy_notices(SAMPLE)
    candidates = [p for p in legacy.plan(notices, {}) if p.is_candidate]
    assert len(candidates) == 1
    db = ExistingSession(set())
    inserted, skipped = asyncio.run(legacy.import_candidates(db, candidates, NOW))
    assert (len(inserted), len(skipped), db.commit_count) == (1, 0, 1)
    (row,) = db.added
    assert (row.id, row.category, row.body, row.created_by, row.is_pinned) == (
        notices[1].notice_id,
        "event",
        "원본 본문",
        None,
        False,
    )
    again = ExistingSession({notices[1].notice_id})
    inserted, skipped = asyncio.run(legacy.import_candidates(again, candidates, NOW))
    assert (len(inserted), len(skipped), again.added) == (0, 1, [])


def test_script_dry_run_does_not_touch_db_and_bad_confirm_stops(tmp_path, capsys):
    source = tmp_path / "support.ts"
    source.write_text(SAMPLE, encoding="utf-8")
    assert legacy.main(["--source", str(source)]) == 0
    out = capsys.readouterr().out
    assert "등록 대상 1 · 제외 4" in out and "DB 에 접속하지 않음" in out
    # --execute 인데 DB 이름 확인이 틀리면 쓰지 않고 2
    assert legacy.main(["--source", str(source), "--execute", "--confirm", "x"]) == 2
    bad = tmp_path / "bodies.json"
    bad.write_text(json.dumps(["not", "a", "map"]), encoding="utf-8")
    assert legacy.main(["--source", str(source), "--bodies", str(bad)]) == 2


class _BoomSession:
    """열리면 실패한다 — 확인 모드 · 등록 대상 0 에서 DB 를 열지 않는지 본다."""

    def __call__(self):
        raise AssertionError("DB session must not be opened")


def test_dry_run_and_execute_without_candidates_never_open_db(monkeypatch, capsys):
    import app.db.session as session_module
    from app.core.config import settings

    monkeypatch.setattr(session_module, "AsyncSessionLocal", _BoomSession())
    # 실제 원본(9건 모두 본문 없음) — 확인만
    assert legacy.main([]) == 0
    assert "등록 대상 0 · 제외 9" in capsys.readouterr().out
    # --execute 여도 넣을 것이 없으면 접속하지 않는다
    assert legacy.main(["--execute", "--confirm", settings.db_name]) == 0
    assert "DB 에 접속하지 않았습니다" in capsys.readouterr().out


def test_execute_db_error_reports_and_exits_4(monkeypatch, tmp_path, capsys):
    from sqlalchemy.exc import OperationalError

    import app.db.session as session_module
    from app.core.config import settings

    class _Failing:
        async def __aenter__(self):
            raise OperationalError("connect", {}, Exception("down"))

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr(session_module, "AsyncSessionLocal", lambda: _Failing())
    source = tmp_path / "support.ts"
    source.write_text(SAMPLE, encoding="utf-8")
    code = legacy.main(
        ["--source", str(source), "--execute", "--confirm", settings.db_name]
    )
    assert code == legacy.EXIT_DB_ERROR == 4
    err = capsys.readouterr().err
    assert "DB 오류로 멈췄습니다" in err and "down" not in err


def test_source_without_readable_notices_is_usage_error(tmp_path):
    source = tmp_path / "support.ts"
    source.write_text(
        "export const NOTICES: readonly Notice[] = [\n];\n", encoding="utf-8"
    )
    assert legacy.main(["--source", str(source)]) == 2
    missing = tmp_path / "other.ts"
    missing.write_text("export const FAQ = [];\n", encoding="utf-8")
    assert legacy.main(["--source", str(missing)]) == 2


def test_legacy_conversion_of_the_real_nine(capsys):
    """원본 9건의 변환 값(분류 대응 · 게시 시각 = 원본 날짜 00:00 KST) — 등록하지는 않는다."""

    notices = legacy.parse_legacy_notices(
        legacy.DEFAULT_SOURCE.read_text(encoding="utf-8")
    )
    assert [legacy.CATEGORY_MAP[n.source_category] for n in notices] == [
        "update",
        "maintenance",
        "event",
        "update",
        "info",
        "event",
        "maintenance",
        "info",
        "update",
    ]
    assert legacy.published_at_of(notices[0]) == datetime(2026, 11, 3, 15, 0)
    assert len({n.notice_id for n in notices}) == 9
