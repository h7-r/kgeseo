"""격리 MySQL에서 힌트 잔액 · 원자적 차감(PM v0.4.8 §4 · §5, v0.4.9 §1 · §3 · §7)을 검증한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).
전체 migration 체인(새 revision `b6d4e2f8a1c3` 포함)을 적용한 실제 테이블에, 실제 HTTP 라우터
(`POST …/puzzles/{puzzle_id}/hints`)를 ASGI로 부른다. 콘텐츠 · 원문은 모두 가상 테스트 값이다.
"""

import asyncio
import os
from datetime import datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import event, func, select, text

from app.api.v1.hints import get_hint_economy_config
from app.api.v1.play_sessions import get_new_session_publication_guard
from app.db.session import get_db
from app.main import app
from app.models.anonymous_session import AnonymousSession
from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.repositories.npc_publication import NpcPublicationRepository
from app.schemas.hint import HintUnlockRequest
from app.services.hint import server_hint_source, unlock_hint
from app.services.hint_balance import HintEconomyConfig
from app.services.npc_publication import NpcPublicationService
from app.services.pinned_content import (
    ContentPin,
    PinnedContent,
    PinnedContentRequiredError,
    PinnedContentStore,
)
from app.services.puzzle_runtime import load_case_runtime
from app.services.session_content import get_pinned_content_store
from tests.conftest import published_guard
from tests.test_npc_suggestion_events_mysql import STATE as AUTO_STATE
from tests.test_npc_suggestion_events_mysql import STORE as AUTO_STORE
from tests.test_npc_suggestion_events_mysql import auto_turn, wrong_answers
from tests.test_npc_turn import FP, HINT_1, HINT_2, make_client, npc_pack
from tests.test_npc_turn import runtime_with_hints as base_runtime
from tests.test_npc_turn_idempotency_mysql import T0, mysql_run, script

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

CASE = "case_test"
HINT_B_1 = "(가상) B 1단계 서버 원문"
REVISION = "b6d4e2f8a1c3"


def runtime_with_two_hinted_puzzles():
    raw = base_runtime().model_dump()
    raw["puzzles"][1]["hints"] = [{"level": 1, "text": HINT_B_1}]
    return type(base_runtime()).model_validate(raw)


def pinned(fingerprint: str = FP) -> PinnedContent:
    return PinnedContent(
        ContentPin(CASE, 1, fingerprint),
        client=make_client(),
        server=runtime_with_two_hinted_puzzles(),
        npc=npc_pack(content_fingerprint=fingerprint),
        idmap=None,
    )


def store_with(*bundles: PinnedContent) -> PinnedContentStore:
    store = PinnedContentStore()
    for bundle in bundles:
        store.add(bundle)
    return store


class Api:
    """실제 라우터를 격리 DB 세션으로 부른다(요청마다 새 DB 세션)."""

    def __init__(self, sessions, store: PinnedContentStore, economy=None) -> None:
        self.sessions = sessions
        self.store = store
        self.economy = economy or HintEconomyConfig()

    async def __aenter__(self):
        async def override_get_db():
            async with self.sessions() as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_pinned_content_store] = lambda: self.store
        app.dependency_overrides[get_hint_economy_config] = lambda: self.economy
        # 이 시나리오는 힌트 잔액만 본다. 게시 상태 확인은 test_content_release_mysql이 실제 테이블로 본다.
        app.dependency_overrides[get_new_session_publication_guard] = lambda: (
            published_guard
        )
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )
        return self

    async def __aexit__(self, *exc):
        await self.client.aclose()
        for dependency in (
            get_db,
            get_pinned_content_store,
            get_hint_economy_config,
            get_new_session_publication_guard,
        ):
            app.dependency_overrides.pop(dependency, None)

    async def unlock(self, session_id, level, event_id=None, puzzle="PZ_A"):
        return await self.client.post(
            f"/api/v1/play-sessions/{session_id}/puzzles/{puzzle}/hints",
            json={
                "client_event_id": event_id or str(uuid4()),
                "client_timestamp": "2026-10-30T12:00:00+09:00",
                "target_level": level,
            },
        )

    async def start(self, anonymous_id: str):
        return await self.client.post(
            "/api/v1/play-sessions",
            json={
                "anonymous_session_id": anonymous_id,
                "case_id": CASE,
                "content_version": 1,
            },
        )


async def new_anonymous(sessions) -> str:
    anonymous_id = str(uuid4())
    now = datetime.utcnow()
    async with sessions() as db, db.begin():
        db.add(
            AnonymousSession(
                id=anonymous_id, created_at=now, expires_at=now + timedelta(days=1)
            )
        )
    return anonymous_id


async def seed(
    sessions, *, balance: int = 3, pinned_fp: str | None = FP, state: dict | None = None
) -> str:
    anonymous_id = await new_anonymous(sessions)
    session_id = str(uuid4())
    async with sessions() as db, db.begin():
        db.add(
            PlaySession(
                id=session_id,
                anonymous_session_id=anonymous_id,
                case_id=CASE,
                state_json=dict(state)
                if state is not None
                else {
                    "current_zone_id": "ZONE_A",
                    "completed_puzzle_ids": [],
                    "completed_inspect_ids": [],
                    "acquired_clue_ids": [],
                    "hint_levels": {},
                    "attempt_counts": {},
                    "flags": {},
                    # PZ_B의 호스트(숨김 금고)를 드러낸 상태 — 두 퍼즐 모두 발견한 것으로 본다(v0.4.10 접근 조건).
                    "object_states": {"ZONE_A": {"OBJ_SAFE": {"visible": True}}},
                },
                created_at=T0,
                updated_at=T0,
                completed_at=None,
                content_version=1 if pinned_fp else None,
                content_fingerprint=pinned_fp,
                hint_balance=balance,
                help_used=0,
            )
        )
    return session_id


async def snapshot(sessions, session_id: str):
    """(잔액, 도움 수, hint_levels, unlock_hint 이벤트 (result_type) 목록)"""

    async with sessions() as db:
        row = await db.get(PlaySession, session_id)
        events = (
            (
                await db.execute(
                    select(InteractionEvent.result_type)
                    .where(
                        InteractionEvent.play_session_id == session_id,
                        InteractionEvent.interaction_type == "unlock_hint",
                    )
                    .order_by(InteractionEvent.created_at)
                )
            )
            .scalars()
            .all()
        )
        return row.hint_balance, row.help_used, row.state_json["hint_levels"], events


# --- 최초 지급 ---


def test_mysql_new_session_gets_initial_balance_from_config():
    async def scenario(sessions):
        store = store_with(pinned())
        async with Api(sessions, store) as api:
            created = await api.start(await new_anonymous(sessions))
            assert created.status_code == 201
            default_id = created.json()["data"]["play_session_id"]
        # 설정값을 바꾸면 새 회차의 지급량이 바뀐다(하드코딩 아님).
        async with Api(sessions, store, HintEconomyConfig(initial_balance=5)) as api:
            created = await api.start(await new_anonymous(sessions))
            custom_id = created.json()["data"]["play_session_id"]

        assert (await snapshot(sessions, default_id))[:2] == (3, 0)
        assert (await snapshot(sessions, custom_id))[:2] == (5, 0)

    mysql_run(scenario)


# --- 정상 해금 · 원자성 ---


def test_mysql_unlock_deducts_balance_and_records_help_in_one_commit():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=3)
        async with Api(sessions, store_with(pinned())) as api:
            first = await api.unlock(session_id, 1)
            second = await api.unlock(session_id, 2)

        assert first.status_code == second.status_code == 200
        body = first.json()
        assert body["hint"] == {"level": 1, "text": HINT_1}
        assert body["result"]["result_type"] == "hint_unlocked"
        assert (body["result"]["hint_balance"], body["result"]["help_used"]) == (2, 1)
        assert second.json()["hint"]["text"] == HINT_2
        assert (
            second.json()["result"]["hint_balance"],
            second.json()["result"]["help_used"],
        ) == (1, 2)
        assert await snapshot(sessions, session_id) == (
            1,
            2,
            {"PZ_A": 2},
            ["hint_unlocked", "hint_unlocked"],
        )

    mysql_run(scenario)


def test_mysql_failed_event_insert_rolls_back_level_balance_and_help():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=3)

        def fail_insert(mapper, connection, target):
            raise RuntimeError("injected event insert failure")

        event.listen(InteractionEvent, "before_insert", fail_insert)
        try:
            async with Api(sessions, store_with(pinned())) as api:
                with pytest.raises(RuntimeError):
                    await api.unlock(session_id, 1)
        finally:
            event.remove(InteractionEvent, "before_insert", fail_insert)

        # 단계 · 잔액 · 도움 수 · 이벤트 중 어느 것도 남지 않는다.
        assert await snapshot(sessions, session_id) == (3, 0, {}, [])

    mysql_run(scenario)


# --- 잔액 0 · 무료 재열람 ---


def test_mysql_empty_balance_is_409_without_changes_and_reread_stays_free():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=1)
        async with Api(sessions, store_with(pinned())) as api:
            assert (await api.unlock(session_id, 1)).status_code == 200
            empty = await api.unlock(session_id, 2)
            other_puzzle = await api.unlock(session_id, 1, puzzle="PZ_B")
            reread = await api.unlock(session_id, 1)

        assert empty.status_code == other_puzzle.status_code == 409
        assert empty.json() == {
            "detail": {
                "code": "HINT_BALANCE_EMPTY",
                "message": "Hint balance is empty.",
                "minigames_left": 2,
                "special_minigame_available": False,
            }
        }
        assert "text" not in str(empty.json())
        # 이미 연 단계는 잔액 0이어도 무료다.
        assert reread.status_code == 200
        assert reread.json()["result"]["result_type"] == "already_unlocked"
        assert reread.json()["hint"]["text"] == HINT_1
        assert (
            reread.json()["result"]["hint_balance"],
            reread.json()["result"]["help_used"],
        ) == (0, 1)
        assert await snapshot(sessions, session_id) == (
            0,
            1,
            {"PZ_A": 1},
            ["hint_unlocked", "already_unlocked"],
        )

    mysql_run(scenario)


# --- 재전송 · 동시 요청 ---


def test_mysql_same_client_event_id_is_replayed_without_second_deduction():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=3)
        event_id = str(uuid4())
        async with Api(sessions, store_with(pinned())) as api:
            first = await api.unlock(session_id, 1, event_id)
            again = await api.unlock(session_id, 1, event_id)
            conflict = await api.unlock(session_id, 2, event_id)

        assert again.status_code == 200 and again.json() == first.json()
        assert conflict.status_code == 409
        assert await snapshot(sessions, session_id) == (
            2,
            1,
            {"PZ_A": 1},
            ["hint_unlocked"],
        )

    mysql_run(scenario)


def test_mysql_concurrent_requests_deduct_once_and_never_go_negative():
    async def scenario(sessions):
        store = store_with(pinned())
        async with Api(sessions, store) as api:
            # 1) 같은 client_event_id 동시 6건 → 한 번만 차감, 모두 같은 응답
            same = await seed(sessions, balance=3)
            event_id = str(uuid4())
            results = await asyncio.gather(
                *(api.unlock(same, 1, event_id) for _ in range(6))
            )
            assert {r.status_code for r in results} == {200}
            assert len({r.json()["interaction_id"] for r in results}) == 1
            assert await snapshot(sessions, same) == (
                2,
                1,
                {"PZ_A": 1},
                ["hint_unlocked"],
            )

            # 2) 다른 client_event_id로 같은 단계 동시 6건 → 한 건만 해금, 나머지는 무료 재열람
            different = await seed(sessions, balance=3)
            results = await asyncio.gather(
                *(api.unlock(different, 1) for _ in range(6))
            )
            kinds = sorted(r.json()["result"]["result_type"] for r in results)
            assert kinds == ["already_unlocked"] * 5 + ["hint_unlocked"]
            balance, used, levels, _ = await snapshot(sessions, different)
            assert (balance, used, levels) == (2, 1, {"PZ_A": 1})

            # 3) 잔액 1에서 서로 다른 퍼즐의 새 단계 동시 요청 → 하나만 성공, 잔액은 0에서 멈춘다
            last = await seed(sessions, balance=1)
            results = await asyncio.gather(
                *(api.unlock(last, 1, puzzle=puzzle) for puzzle in ("PZ_A", "PZ_B") * 3)
            )
            codes = sorted(r.status_code for r in results)
            assert codes.count(200) >= 1 and set(codes) <= {200, 409}
            assert all(
                r.json()["detail"]["code"] == "HINT_BALANCE_EMPTY"
                for r in results
                if r.status_code == 409
            )
            balance, used, levels, events = await snapshot(sessions, last)
            assert (balance, used) == (0, 1) and len(levels) == 1
            assert events.count("hint_unlocked") == 1

    mysql_run(scenario)


# --- 고정 버전 원문 조회 실패 ---


def test_mysql_pinned_text_unavailable_never_deducts():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=3)
        # 고정 버전 묶음이 등록되지 않음 · 같은 버전의 다른 fingerprint만 있음
        for store in (PinnedContentStore(), store_with(pinned("sha256:" + "9" * 64))):
            async with Api(sessions, store) as api:
                response = await api.unlock(session_id, 1)
            assert response.status_code == 409
            assert response.json() == {"detail": "CASE_VERSION_UNAVAILABLE"}

        # 그 버전에 원문이 없는 단계(PZ_B 2단계) · 원문이 없는 퍼즐(PZ_C)
        async with Api(sessions, store_with(pinned())) as api:
            assert (await api.unlock(session_id, 1, puzzle="PZ_B")).status_code == 200
            missing_level = await api.unlock(session_id, 2, puzzle="PZ_B")
            missing_puzzle = await api.unlock(session_id, 1, puzzle="PZ_C")
        assert missing_level.status_code == missing_puzzle.status_code == 404
        assert missing_level.json() == {"detail": "Hint not found."}

        # 고정 세션에 최신(레거시) 로더를 넘기면 거부한다(최신 버전으로 바꾸지 않는다).
        async with sessions() as db:
            with pytest.raises(PinnedContentRequiredError):
                await unlock_hint(
                    db,
                    session_id,
                    "PZ_A",
                    HintUnlockRequest(client_event_id=str(uuid4()), target_level=1),
                    hint_source=server_hint_source(),
                    access_policy=lambda state, puzzle, level: None,
                    runtime_loader=load_case_runtime,
                )

        # 성공한 PZ_B 1단계 한 번만 차감됐다.
        assert await snapshot(sessions, session_id) == (
            2,
            1,
            {"PZ_B": 1},
            ["hint_unlocked"],
        )

    mysql_run(scenario)


# --- 긴급 차단 중 ---


def test_mysql_blocked_version_still_serves_approved_text_and_deducts():
    async def scenario(sessions):
        async with sessions() as db, db.begin():
            repository = NpcPublicationRepository(db)
            await repository.register_version(CASE, 1, FP, now=T0)
            await repository.insert_state(CASE, 1, status="published", now=T0)
        service = NpcPublicationService(sessions, clock=lambda: T0)
        await service.block(CASE, 1, reason="긴급 차단(가상)", actor="test-operator")
        assert (await service.current(CASE, 1)).status == "blocked"

        session_id = await seed(sessions, balance=3)
        async with Api(sessions, store_with(pinned())) as api:
            response = await api.unlock(session_id, 1)

        # Hint API는 게시 상태를 보지 않는다(v0.4.9 §3). 승인 원문을 주고 차감은 그대로 한다.
        assert response.status_code == 200
        assert response.json()["hint"]["text"] == HINT_1
        assert await snapshot(sessions, session_id) == (
            2,
            1,
            {"PZ_A": 1},
            ["hint_unlocked"],
        )

    mysql_run(scenario)


# --- 자동 개입은 잔액 · 단계 · 도움 수를 바꾸지 않는다 ---


def test_mysql_auto_intervention_leaves_balance_help_and_levels_untouched():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=3, state=AUTO_STATE)
        await wrong_answers(sessions, session_id)
        # 이 테스트의 자동 개입 콘텐츠(v0.4.7 MySQL 테스트와 같은 묶음)
        assert AUTO_STORE.get(ContentPin(CASE, 1, FP)) is not None
        response, record = await auto_turn(
            sessions, session_id, T0 + timedelta(seconds=1)
        )
        assert response.reply is not None and record["auto_intervene"]["level"] == 1
        assert await snapshot(sessions, session_id) == (3, 0, {}, [])

        # 승인 nudge가 없어 2단계(힌트 제안)로 올라가도 마찬가지다.
        no_clue = await seed(sessions, balance=3)
        await wrong_answers(sessions, no_clue)
        response, record = await auto_turn(sessions, no_clue, T0 + timedelta(seconds=1))
        assert record["auto_intervene"]["level"] == 2
        assert await snapshot(sessions, no_clue) == (3, 0, {}, [])

    mysql_run(scenario)


# --- migration ---


def test_mysql_revision_backfills_existing_rows_and_downgrades():
    async def scenario(sessions):
        engine = sessions.kw["bind"]

        def run(connection, step):
            with Operations.context(MigrationContext.configure(connection)):
                getattr(script().get_revision(REVISION).module, step)()

        async with engine.begin() as connection:
            await connection.run_sync(run, "downgrade")
            columns = {
                row[0]
                for row in (
                    await connection.execute(text("SHOW COLUMNS FROM play_sessions"))
                ).all()
            }
            assert not columns & {"hint_balance", "help_used"}

        anonymous_id = await new_anonymous(sessions)
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    "INSERT INTO play_sessions (id, anonymous_session_id, case_id, state_json, "
                    "created_at, updated_at) VALUES (:id, :anon, 'case_test', :state, :t, :t)"
                ),
                {
                    "id": "legacy-0000-4000-8000-000000000001",
                    "anon": anonymous_id,
                    # 0~2 정수만 합친다(bool · 범위 밖은 세지 않는다)
                    "state": '{"hint_levels": {"PZ_A": 2, "PZ_B": 1, "PZ_C": true, "PZ_D": 7}}',
                    "t": T0,
                },
            )
            await connection.run_sync(run, "upgrade")
            row = (
                await connection.execute(
                    text(
                        "SELECT hint_balance, help_used FROM play_sessions "
                        "WHERE id = 'legacy-0000-4000-8000-000000000001'"
                    )
                )
            ).one()
        assert tuple(row) == (3, 3)

        async with sessions() as db:
            count = (
                await db.execute(select(func.count()).select_from(PlaySession))
            ).scalar_one()
        assert count == 1

    mysql_run(scenario)
