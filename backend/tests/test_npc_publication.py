"""NPC 게시 상태 — DB 없이 검증하는 부분. 실제 MySQL 시나리오는 `test_npc_publication_mysql.py`."""

import asyncio
import io
from datetime import datetime
from pathlib import Path
from types import MappingProxyType
from uuid import uuid4

import pytest
from alembic.config import Config

from alembic import command
from app.models.npc_publication import NpcContentVersion, NpcPublicationEvent
from app.schemas.npc_turn import NpcReplyOut, NpcTurnResponse, SuggestHintOut
from app.services.approval_history import ReviewRecord
from app.services.npc_publication import (
    BlockedReapprovalRequiredError,
    NpcPublicationService,
    PublicationPolicy,
    _require_reapproval_after,
    _VersionOrderView,
    build_npc_turn_idempotency_store,
    publication_state_guard,
)
from app.services.npc_turn_idempotency import (
    GenericResponseRejectedError,
    RequestHashKeys,
    no_generic_lines,
    validate_generic_response,
)
from app.services.published_content_loader import BundleSnapshot
from tests.test_publication_gate import CASE_ID, no_idmap_files

BACKEND_DIR = Path(__file__).resolve().parents[1]
REVISION = "f3b8d2c6a1e7"
PARENT = "e4c1f7a2b9d6"
# 가상 테스트 데이터. 실제 콘텐츠 · 승인 결과가 아니다.
FP = "sha256:" + "1" * 64
KEYS = RequestHashKeys("k1", {"k1": b"k1-test-only-" + b"a" * 32})
CATALOG = {"GENERIC_01": "(가상) 일반 대사"}.get


FILES, BUNDLE_FP = no_idmap_files()
BUNDLE = BundleSnapshot(CASE_ID, 1, MappingProxyType(dict(FILES)))
BLOCKED_AT = datetime(2026, 10, 30, 1, 0, 0)


def record(gate: str, at: str, decision: str = "approved", **extra) -> ReviewRecord:
    if decision != "approved" or extra.get("supersedes"):
        extra.setdefault("reason", "(가상) 사유")
    return ReviewRecord(
        review_id=str(uuid4()),
        gate=gate,
        target_hash=extra.pop("target_hash", BUNDLE_FP),
        decision=decision,
        reviewer="test-reviewer",
        reviewed_at=at,
        **extra,
    )


def reply(text: str, line_id: str | None, source: str = "approved_line"):
    return NpcReplyOut(source=source, text=text, line_id=line_id)


# --- 상태 의미 ---


@pytest.mark.parametrize(
    ("status", "new_sessions", "case_npc"),
    [("published", True, True), ("suspended", False, True), ("blocked", False, False)],
)
def test_publication_policy_follows_pm_v046(status, new_sessions, case_npc) -> None:
    policy = PublicationPolicy(status)

    assert policy.accepts_new_sessions is new_sessions
    assert policy.serves_case_npc_content is case_npc
    # 어느 상태든 진행 중 세션의 게임 진행 · Client Bundle · Hint API는 유지한다.
    assert policy.serves_game_content is True


def test_unknown_status_is_rejected() -> None:
    with pytest.raises(ValueError):
        PublicationPolicy("withdrawn")


# --- generic 우회 차단 ---


@pytest.mark.parametrize(
    "response",
    [
        NpcTurnResponse(npc_event_id=uuid4(), reply=None, suggest_hint=None),
        NpcTurnResponse(
            npc_event_id=uuid4(),
            reply=reply("(가상) 일반 대사", "GENERIC_01"),
            suggest_hint=None,
        ),
    ],
)
def test_generic_response_without_case_content_is_accepted(response) -> None:
    validate_generic_response(response, CATALOG)


@pytest.mark.parametrize(
    "response",
    [
        # 케이스 대사를 generic으로 표시
        NpcTurnResponse(
            npc_event_id=uuid4(),
            reply=reply("(가상) 차단된 케이스 대사", "NUDGE_A_01"),
            suggest_hint=None,
        ),
        # 일반 팩 line_id에 다른 문장
        NpcTurnResponse(
            npc_event_id=uuid4(),
            reply=reply("(가상) 차단된 케이스 대사", "GENERIC_01"),
            suggest_hint=None,
        ),
        # 생성 문장
        NpcTurnResponse(
            npc_event_id=uuid4(),
            reply=reply("(가상) 일반 대사", "GENERIC_01", source="generated"),
            suggest_hint=None,
        ),
        # line_id 없음
        NpcTurnResponse(
            npc_event_id=uuid4(),
            reply=reply("(가상) 일반 대사", None),
            suggest_hint=None,
        ),
        # 힌트 안내는 케이스 퍼즐을 가리킨다
        NpcTurnResponse(
            npc_event_id=uuid4(),
            reply=None,
            suggest_hint=SuggestHintOut(puzzle_id="PZ_A"),
        ),
    ],
)
def test_case_content_disguised_as_generic_is_rejected(response) -> None:
    with pytest.raises(GenericResponseRejectedError):
        validate_generic_response(response, CATALOG)


def test_without_approved_generic_pack_only_null_reply_is_generic() -> None:
    validate_generic_response(
        NpcTurnResponse(npc_event_id=uuid4(), reply=None, suggest_hint=None),
        no_generic_lines,
    )
    with pytest.raises(GenericResponseRejectedError):
        validate_generic_response(
            NpcTurnResponse(
                npc_event_id=uuid4(),
                reply=reply("(가상) 일반 대사", "GENERIC_01"),
                suggest_hint=None,
            ),
            no_generic_lines,
        )


# --- 전이 입력 검증(DB 접근 전) ---


@pytest.mark.parametrize(
    "not_server_bundle",
    [
        {"client": b"{}", "server": b"{}", "npc": b"{}"},  # 호출자가 만든 파일 매핑
        None,
    ],
)
def test_publish_accepts_only_server_read_bundles(not_server_bundle) -> None:
    service = NpcPublicationService(None)  # type: ignore[arg-type]

    for operation in (service.publish_new, service.resume):
        with pytest.raises(TypeError):
            asyncio.run(
                operation(
                    not_server_bundle,
                    hint_source=None,
                    ng_checker=None,
                    local_ids=None,
                    reason="게시",
                    actor="운영자",
                )
            )


@pytest.mark.parametrize(
    ("reason", "actor"),
    [("", "운영자"), ("게시", " "), ("x" * 501, "운영자"), ("게시", "a" * 101)],
)
def test_transitions_require_reason_and_actor(reason, actor) -> None:
    service = NpcPublicationService(None)  # type: ignore[arg-type]

    for operation in (service.publish_new, service.resume):
        with pytest.raises(ValueError):
            asyncio.run(
                operation(
                    BUNDLE,
                    hint_source=None,
                    ng_checker=None,
                    local_ids=None,
                    reason=reason,
                    actor=actor,
                )
            )
    with pytest.raises(ValueError):
        asyncio.run(service.block(CASE_ID, 1, reason=reason, actor=actor))
    with pytest.raises(ValueError):
        asyncio.run(service.suspend(CASE_ID, 1, reason=reason, actor=actor))


# --- blocked 재개: 차단 이후 재승인 ---


def test_reapproval_after_block_needs_all_three_final_approvals_after_block() -> None:
    before = [record(g, "2026-10-30T00:59:59.999Z") for g in ("G1", "G2", "G3")]
    with pytest.raises(BlockedReapprovalRequiredError) as missing:
        _require_reapproval_after(before, BUNDLE_FP, BLOCKED_AT)
    assert missing.value.gate == "G1"

    after = [
        record(g, "2026-10-30T01:00:00.001Z", supersedes=prev.review_id)
        for g, prev in zip(("G1", "G2"), before)
    ]
    with pytest.raises(BlockedReapprovalRequiredError) as partial:
        _require_reapproval_after([*before, *after], BUNDLE_FP, BLOCKED_AT)
    assert partial.value.gate == "G3"

    g3 = record("G3", "2026-10-30T01:00:00.001Z", supersedes=before[2].review_id)
    _require_reapproval_after([*before, *after, g3], BUNDLE_FP, BLOCKED_AT)


def test_reapproval_at_block_instant_or_for_other_content_does_not_count() -> None:
    same_instant = [record(g, "2026-10-30T01:00:00.000Z") for g in ("G1", "G2", "G3")]
    with pytest.raises(BlockedReapprovalRequiredError):
        _require_reapproval_after(same_instant, BUNDLE_FP, BLOCKED_AT)
    other = [
        record(g, "2026-10-30T02:00:00.000Z", target_hash="sha256:" + "f" * 64)
        for g in ("G1", "G2", "G3")
    ]
    with pytest.raises(BlockedReapprovalRequiredError):
        _require_reapproval_after(other, BUNDLE_FP, BLOCKED_AT)
    rejected = [
        record(g, "2026-10-30T02:00:00.000Z", decision="hold")
        for g in ("G1", "G2", "G3")
    ]
    with pytest.raises(BlockedReapprovalRequiredError):
        _require_reapproval_after(rejected, BUNDLE_FP, BLOCKED_AT)


def test_version_order_view_uses_registered_versions_only() -> None:
    view = _VersionOrderView((1, 2))

    assert view.versions(CASE_ID) == (1, 2)
    assert view.pinned is None


def test_built_store_uses_the_publication_state_guard() -> None:
    store = build_npc_turn_idempotency_store(None, hash_keys=KEYS)  # type: ignore[arg-type]

    assert store._guard is publication_state_guard


def test_versions_and_events_reject_orm_update_and_delete() -> None:
    from sqlalchemy import event

    from app.models.npc_publication import _immutable

    with pytest.raises(ValueError, match="append-only"):
        _immutable()
    for model in (NpcContentVersion, NpcPublicationEvent):
        assert event.contains(model, "before_update", _immutable)
        assert event.contains(model, "before_delete", _immutable)


# --- migration ---


def alembic_config(output=None) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"), output_buffer=output)
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return config


def test_migration_adds_three_tables_without_triggers_or_alters() -> None:
    up = io.StringIO()
    command.upgrade(alembic_config(up), f"{PARENT}:{REVISION}", sql=True)
    down = io.StringIO()
    command.downgrade(alembic_config(down), f"{REVISION}:{PARENT}", sql=True)
    upgrade_sql, downgrade_sql = up.getvalue(), down.getvalue()

    for table in (
        "npc_content_versions",
        "npc_publication_states",
        "npc_publication_events",
    ):
        assert f"CREATE TABLE {table}" in upgrade_sql
        assert f"DROP TABLE {table}" in downgrade_sql
    assert "CREATE UNIQUE INDEX ix_npc_publication_events_version" in upgrade_sql
    for forbidden in ("TRIGGER", "ALTER TABLE"):
        assert forbidden not in upgrade_sql
        assert forbidden not in downgrade_sql
