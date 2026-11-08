"""명시적으로 격리 확인된 빈 테스트 DB에서만 PM v0.4.14 일반 팩 정책 검사를 실제 게시 · NPC 경로로 검증한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).
케이스 · 정답 · 승인 기록은 이 격리 DB에만 넣는 가상 데이터다.
"""

import asyncio
import os

import pytest

from app.core.config import settings
from app.schemas.npc_content import GeneralLinePack
from app.services import npc_general_pack
from app.services.npc_general_pack import read_published_cases
from app.services.npc_publication import (
    NpcPublicationService,
    PublicationGateFailedError,
)
from app.services.pinned_content import PinnedContentStore
from tests.test_content_release import write_bundle
from tests.test_content_release_mysql import approve, mysql_run, release
from tests.test_npc_case_access_mysql import event_count
from tests.test_npc_general_pack import OFFICIAL
from tests.test_npc_general_pack_mysql import (
    Http,
    blocked_session,
    body,
    pack_review,
)
from tests.test_publication_gate import ANSWER, CASE_ID

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

# 가상 팩: 문장에 가상 케이스의 정답이 들어 있다
CONFLICTING = GeneralLinePack.model_validate(
    {
        "schema_version": "npc-general-pack 0.1",
        "pack_id": "conflict_test",
        "pack_version": 1,
        "lines": [
            {"line_id": "GENERIC_PAUSE_01", "text": f"{ANSWER}일까요?", "use": "pause"}
        ],
    }
)


@pytest.fixture
def configured_conflicting_pack(monkeypatch):
    # 게이트는 설정된 팩을 공식 파일에서 읽는다. 테스트는 그 로더만 가상 팩으로 바꾼다(저장소 파일은 그대로).
    monkeypatch.setattr(settings, "npc_general_pack", "conflict_test/v1")
    monkeypatch.setattr(npc_general_pack, "load_general_pack", lambda _s: CONFLICTING)


# ── 새 케이스 게시: 설정된 일반 팩 재검사 ──


def test_mysql_publication_without_configured_pack_keeps_the_flow(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "npc_general_pack", "")
    fingerprint = write_bundle(tmp_path, 1)

    async def scenario(sessions):
        service = NpcPublicationService(sessions)
        store = PinnedContentStore()
        await approve(sessions, 1, fingerprint)
        result = await release(service, store, tmp_path)
        assert result.outcome == "published"
        assert store.versions(CASE_ID) == (1,)

    mysql_run(scenario)


def test_mysql_publication_conflicting_with_configured_pack_is_rejected_concurrently(
    tmp_path, configured_conflicting_pack
):
    fingerprint = write_bundle(tmp_path, 1)

    async def scenario(sessions):
        service = NpcPublicationService(sessions)
        store = PinnedContentStore()
        await approve(sessions, 1, fingerprint)
        results = await asyncio.gather(
            *(release(service, store, tmp_path) for _ in range(3)),
            return_exceptions=True,
        )
        assert all(isinstance(r, PublicationGateFailedError) for r in results)
        check = results[0].result.check("GEN_PACK")
        assert check.status == "FAIL"
        assert any(
            reason.startswith(f"GEN-LEAK:GENERIC_PAUSE_01:ANSWER:{CASE_ID}@v1:")
            for reason in check.reasons
        )
        # 게시 상태 · 저장소 · 이벤트 어디에도 남지 않는다
        assert await service.current(CASE_ID, 1) is None
        assert await service.restorable_versions() == ()
        assert store.versions(CASE_ID) == ()

    mysql_run(scenario)


def test_mysql_publication_with_official_pack_and_review_data_passes(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "npc_general_pack", OFFICIAL)
    fingerprint = write_bundle(tmp_path, 1)

    async def scenario(sessions):
        service = NpcPublicationService(sessions)
        await approve(sessions, 1, fingerprint)
        store = PinnedContentStore()
        await release(service, store, tmp_path)
        assert await service.current(CASE_ID, 1) is not None
        assert store.versions(CASE_ID) == (1,)
        async with sessions() as db:
            cases = await read_published_cases(db, store)
            await db.rollback()
        assert cases[0].proper_names == ("자물쇠", "쪽지")

    mysql_run(scenario)


# ── NPC 턴: 실제 의존성(게시 DB + 저장소) ──


def test_mysql_published_cases_reader_is_fail_closed():
    async def scenario(sessions):
        await blocked_session(sessions)  # case_test@v1 게시 기록(blocked)
        async with sessions() as db:
            # 저장소에 게시본이 없다 → 전체를 확인할 수 없음
            assert await read_published_cases(db, PinnedContentStore()) is None
            await db.rollback()
        http = Http(sessions)
        async with sessions() as db:
            cases = await read_published_cases(db, http.store)
            await db.rollback()
        assert [(c.case_id, c.content_version) for c in cases] == [("case_test", 1)]
        assert cases[0].proper_names is None

    mysql_run(scenario)


def test_mysql_real_policy_keeps_pause_reply_null_even_with_g3(monkeypatch):
    monkeypatch.setattr(settings, "npc_general_pack", OFFICIAL)

    async def scenario(sessions):
        session_id = await blocked_session(sessions)
        await pack_review(sessions, "G3")  # 가상 G3 승인(격리 DB)
        request = body()
        async with Http(sessions) as http:  # 정책 검사 대역 없음: 운영 의존성 그대로
            first = await http.turn(session_id, request)
            again = await http.turn(session_id, request)
        assert first["reply"] is None
        assert (first["fallback_reason"], first["content_mode"]) == (
            "NPC_CONTENT_WITHDRAWN",
            "generic",
        )
        assert again == first
        assert await event_count(sessions, session_id) == 1

    mysql_run(scenario)


def test_mysql_normal_turn_content_mode_is_case_with_real_policy(monkeypatch):
    monkeypatch.setattr(settings, "npc_general_pack", OFFICIAL)

    async def scenario(sessions):
        from tests.test_npc_case_access_mysql import new_session, publish_state

        session_id = await new_session(sessions)
        await publish_state(sessions)
        async with Http(sessions) as http:
            response = await http.turn(session_id, body())
        assert response["content_mode"] == "case"
        assert response["fallback_reason"] != "NPC_CONTENT_WITHDRAWN"

    mysql_run(scenario)
