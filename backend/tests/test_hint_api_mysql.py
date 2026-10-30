"""격리 MySQL에서 정식 Hint API 경로 일원화(PM v0.4.10 §1)를 검증한다.

- 정식 경로 `POST …/hints`(`puzzle_id` | `hint_ref`)와 호환 별칭 `…/puzzles/{puzzle_id}/hints`
- NPC 제안 수락: 실제 `process_npc_turn`이 발급한 `hint_ref`를 그대로 Hint API에 보낸다.
- 서버 상태 접근 조건(미발견 퍼즐 404) · 고정 버전 · 긴급 차단 · 멱등 · 동시성

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).
키 · 콘텐츠 · 원문은 모두 가상 테스트 값이다.
"""

import asyncio
import os
from datetime import timedelta
from uuid import uuid4

import pytest

from app.api.v1.hints import get_hint_access_rules
from app.api.v1.npc import get_hint_ref_keys
from app.main import app
from app.models.play_session import PlaySession
from app.repositories.npc_publication import NpcPublicationRepository
from app.schemas.npc_turn import NpcTurnRequest
from app.services.hint_access import HintAccessRules
from app.services.hint_ref import HintRefKeys, issue_hint_ref
from app.services.npc_publication import NpcPublicationService
from app.services.npc_turn_service import process_npc_turn
from tests.test_hint_balance_mysql import Api, pinned, seed, snapshot, store_with
from tests.test_npc_suggestion_events_mysql import CASE_APPROVAL, wrong_answers
from tests.test_npc_suggestion_events_mysql import STORE as NPC_STORE
from tests.test_npc_turn import FP, HINT_1, HINT_2
from tests.test_npc_turn_idempotency_mysql import T0, mysql_run

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

# 가상 테스트 키(운영 키가 아니다)
KEYS = HintRefKeys("t1", {"t1": b"hint-ref-test-only-" + b"k" * 32})
OTHER_KEYS = HintRefKeys("t1", {"t1": b"hint-ref-other-key-" + b"z" * 32})
UNKNOWN_KID = HintRefKeys("t9", {"t9": b"hint-ref-test-only-" + b"k" * 32})
STATE_ZONE_A = {
    "current_zone_id": "ZONE_A",
    "completed_puzzle_ids": [],
    "completed_inspect_ids": [],
    "acquired_clue_ids": [],
    "hint_levels": {},
    "attempt_counts": {},
    "flags": {},
    "object_states": {},
}


class HintApi(Api):
    """`Api`(v0.4.9 테스트)에 정식 경로 · hint_ref 키 · 접근 규칙 덮어쓰기를 더한다."""

    def __init__(self, sessions, store, *, keys=KEYS, rules=None) -> None:
        super().__init__(sessions, store)
        self.keys = keys
        self.rules = rules or HintAccessRules()

    async def __aenter__(self):
        await super().__aenter__()
        app.dependency_overrides[get_hint_ref_keys] = lambda: self.keys
        app.dependency_overrides[get_hint_access_rules] = lambda: self.rules
        return self

    async def __aexit__(self, *exc):
        app.dependency_overrides.pop(get_hint_ref_keys, None)
        app.dependency_overrides.pop(get_hint_access_rules, None)
        await super().__aexit__(*exc)

    async def hint(self, session_id, level, event_id=None, **target):
        body = {
            "client_event_id": event_id or str(uuid4()),
            "client_timestamp": "2026-10-31T12:00:00+09:00",
            "target_level": level,
            **target,
        }
        return await self.client.post(
            f"/api/v1/play-sessions/{session_id}/hints", json=body
        )


async def offered_hint_ref(sessions, session_id: str) -> str:
    """6회 오답 → 실제 NPC 자동 개입(2단계)이 발급한 hint_ref."""

    await wrong_answers(sessions, session_id)
    async with sessions() as db:
        response = await process_npc_turn(
            db,
            session_id,
            NpcTurnRequest(
                client_event_id=uuid4(), trigger="auto", focus_object_id="OBJ_CABINET"
            ),
            store=NPC_STORE,
            approval_source=CASE_APPROVAL,
            hint_ref_keys=KEYS,
            now=T0 + timedelta(seconds=1),
        )
    assert response.suggest_hint is not None
    return response.suggest_hint.hint_ref


def no_internal_ids(response) -> None:
    text = response.text
    for puzzle_id in ("PZ_A", "PZ_B", "PZ_C"):
        assert puzzle_id not in text


# --- 직접 버튼 · NPC 제안 수락 ---


def test_mysql_hint_button_path_unlocks_and_deducts():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=3, state=STATE_ZONE_A)
        async with HintApi(sessions, store_with(pinned())) as api:
            first = await api.hint(session_id, 1, puzzle_id="PZ_A")
            second = await api.hint(session_id, 2, puzzle_id="PZ_A")
        assert first.status_code == second.status_code == 200
        assert first.json()["hint"] == {"level": 1, "text": HINT_1}
        assert second.json()["hint"] == {"level": 2, "text": HINT_2}
        assert await snapshot(sessions, session_id) == (
            1,
            2,
            {"PZ_A": 2},
            ["hint_unlocked", "hint_unlocked"],
        )

    mysql_run(scenario)


def test_mysql_npc_offer_acceptance_uses_hint_ref_and_npc_turn_never_deducts():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=3, state=STATE_ZONE_A)
        hint_ref = await offered_hint_ref(sessions, session_id)
        # NPC 턴(제안)은 잔액 · 단계 · 도움 수를 바꾸지 않는다(v0.4.10: /npc/turns에 차감 경로 없음).
        assert await snapshot(sessions, session_id) == (3, 0, {}, [])
        assert hint_ref.startswith("hr1.t1.") and "PZ_A" not in hint_ref

        event_id = str(uuid4())
        async with HintApi(sessions, store_with(pinned())) as api:
            accepted = await api.hint(session_id, 1, event_id, hint_ref=hint_ref)
            replay = await api.hint(session_id, 1, event_id, hint_ref=hint_ref)
            # 같은 요청 ID를 puzzle_id로 다시 보내도 같은 대상이면 처음 응답이다.
            same_target = await api.hint(session_id, 1, event_id, puzzle_id="PZ_A")
        assert accepted.status_code == 200
        assert accepted.json()["hint"]["text"] == HINT_1
        assert accepted.json()["result"]["hint_balance"] == 2
        assert replay.json() == accepted.json() == same_target.json()
        assert await snapshot(sessions, session_id) == (
            2,
            1,
            {"PZ_A": 1},
            ["hint_unlocked"],
        )

    mysql_run(scenario)


# --- 입력 검증 · hint_ref 위조 ---


def test_mysql_target_validation_and_forged_or_foreign_hint_refs():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=3, state=STATE_ZONE_A)
        other_session = await seed(sessions, balance=3, state=STATE_ZONE_A)
        real = issue_hint_ref(
            KEYS, play_session_id=session_id, puzzle_id="PZ_A", content_fingerprint=FP
        )
        foreign = issue_hint_ref(
            KEYS,
            play_session_id=other_session,
            puzzle_id="PZ_A",
            content_fingerprint=FP,
        )
        other_fp = issue_hint_ref(
            KEYS,
            play_session_id=session_id,
            puzzle_id="PZ_A",
            content_fingerprint="sha256:" + "8" * 64,
        )
        forged_key = issue_hint_ref(
            OTHER_KEYS,
            play_session_id=session_id,
            puzzle_id="PZ_A",
            content_fingerprint=FP,
        )
        tampered = real[:-1] + ("A" if real[-1] != "A" else "B")
        store = store_with(pinned())

        async with HintApi(sessions, store) as api:
            neither = await api.hint(session_id, 1)
            both = await api.hint(session_id, 1, puzzle_id="PZ_A", hint_ref=real)
            extra = await api.hint(session_id, 1, puzzle_id="PZ_A", zone_id="ZONE_A")
            malformed = await api.hint(session_id, 1, hint_ref="hr1.t1.short")
            mismatches = [
                await api.hint(session_id, 1, hint_ref=ref)
                for ref in (foreign, other_fp, forged_key, tampered)
            ]
        async with HintApi(sessions, store, keys=UNKNOWN_KID) as api:
            unknown_kid = await api.hint(session_id, 1, hint_ref=real)
        async with HintApi(sessions, store, keys=None) as api:
            unconfigured = await api.hint(session_id, 1, hint_ref=real)

        assert neither.status_code == both.status_code == extra.status_code == 422
        assert malformed.status_code == 422
        assert malformed.json()["detail"]["code"] == "HINT_REF_INVALID"
        for response in mismatches:
            assert response.status_code == 409
            assert response.json() == {
                "detail": {
                    "code": "HINT_REF_MISMATCH",
                    "message": "Hint reference does not match this play session.",
                }
            }
        for response in (unknown_kid, unconfigured):
            assert response.status_code == 503
            assert response.json()["detail"]["code"] == "HINT_REF_UNAVAILABLE"
        for response in (malformed, *mismatches, unknown_kid, unconfigured):
            no_internal_ids(response)
        # 어느 요청도 차감 · 기록하지 않았다.
        assert await snapshot(sessions, session_id) == (3, 0, {}, [])
        assert await snapshot(sessions, other_session) == (3, 0, {}, [])

    mysql_run(scenario)


# --- 재전송 · 동시 요청 ---


def test_mysql_concurrent_ref_and_button_requests_deduct_once():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=3, state=STATE_ZONE_A)
        hint_ref = issue_hint_ref(
            KEYS, play_session_id=session_id, puzzle_id="PZ_A", content_fingerprint=FP
        )
        async with HintApi(sessions, store_with(pinned())) as api:
            same_id = str(uuid4())
            same = await asyncio.gather(
                *(api.hint(session_id, 1, same_id, hint_ref=hint_ref) for _ in range(6))
            )
            mixed = await asyncio.gather(
                *(
                    api.hint(session_id, 2, **target)
                    for target in ({"hint_ref": hint_ref}, {"puzzle_id": "PZ_A"}) * 3
                )
            )
        assert {r.status_code for r in same} == {200}
        assert len({r.json()["interaction_id"] for r in same}) == 1
        kinds = sorted(r.json()["result"]["result_type"] for r in mixed)
        assert kinds == ["already_unlocked"] * 5 + ["hint_unlocked"]
        balance, used, levels, events = await snapshot(sessions, session_id)
        assert (balance, used, levels) == (1, 2, {"PZ_A": 2})
        assert events.count("hint_unlocked") == 2

    mysql_run(scenario)


# --- 서버 상태 접근 조건 ---


def test_mysql_undiscovered_puzzles_look_like_missing_ones_and_never_deduct():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=3, state=STATE_ZONE_A)
        async with HintApi(sessions, store_with(pinned())) as api:
            hidden = await api.hint(session_id, 1, puzzle_id="PZ_B")  # 숨긴 금고
            elsewhere = await api.hint(session_id, 1, puzzle_id="PZ_C")  # 다른 구역
            missing = await api.hint(session_id, 1, puzzle_id="PZ_NOPE")
            skip_hidden = await api.hint(session_id, 2, puzzle_id="PZ_B")
            via_alias = await api.unlock(session_id, 1, puzzle="PZ_B")
            # 숨긴 퍼즐의 hint_ref도 같다(NPC가 발급하지 않지만 서명이 맞아도 막는다).
            hidden_ref = issue_hint_ref(
                KEYS,
                play_session_id=session_id,
                puzzle_id="PZ_B",
                content_fingerprint=FP,
            )
            by_ref = await api.hint(session_id, 1, hint_ref=hidden_ref)
        for response in (hidden, elsewhere, missing, skip_hidden, via_alias, by_ref):
            assert response.status_code == 404
            assert response.json() == {"detail": "Puzzle not found."}
        assert await snapshot(sessions, session_id) == (3, 0, {}, [])

    mysql_run(scenario)


def test_mysql_opened_puzzle_stays_reachable_after_leaving_and_clue_rule_is_opt_in():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=3, state=STATE_ZONE_A)
        store = store_with(pinned())
        async with HintApi(sessions, store) as api:
            assert (await api.hint(session_id, 1, puzzle_id="PZ_A")).status_code == 200
        # 다른 구역으로 옮긴 뒤에도 이미 연 퍼즐은 재열람 · 다음 단계를 열 수 있다(hint_levels ≥ 1).
        async with sessions() as db, db.begin():
            row = await db.get(PlaySession, session_id)
            row.state_json = {**row.state_json, "current_zone_id": "ZONE_B"}
        async with HintApi(sessions, store) as api:
            reread = await api.hint(session_id, 1, puzzle_id="PZ_A")
            level_two = await api.hint(session_id, 2, puzzle_id="PZ_A")
        assert reread.json()["result"]["result_type"] == "already_unlocked"
        assert level_two.json()["result"]["result_type"] == "hint_unlocked"

        # 선행 단서 조건은 기본 미적용(PM 미결정). 켜면 부족한 개수만 알리는 409이고 차감하지 않는다.
        strict = await seed(sessions, balance=3, state=STATE_ZONE_A)
        async with HintApi(
            sessions, store, rules=HintAccessRules(require_clues=True)
        ) as api:
            blocked = await api.hint(strict, 1, puzzle_id="PZ_A")
        assert blocked.status_code == 409
        assert blocked.json() == {
            "detail": "Required clues are not acquired.",
            "missing_clue_count": 2,
        }
        assert await snapshot(sessions, strict) == (3, 0, {}, [])

    mysql_run(scenario)


# --- 고정 버전 · 긴급 차단 ---


def test_mysql_pinned_version_mismatch_never_deducts_on_either_target():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=3, state=STATE_ZONE_A)
        hint_ref = issue_hint_ref(
            KEYS, play_session_id=session_id, puzzle_id="PZ_A", content_fingerprint=FP
        )
        wrong_fp_store = store_with(pinned("sha256:" + "9" * 64))
        async with HintApi(sessions, wrong_fp_store) as api:
            by_id = await api.hint(session_id, 1, puzzle_id="PZ_A")
            by_ref = await api.hint(session_id, 1, hint_ref=hint_ref)
            by_alias = await api.unlock(session_id, 1)
        for response in (by_id, by_ref, by_alias):
            assert response.status_code == 409
            assert response.json() == {"detail": "CASE_VERSION_UNAVAILABLE"}
        assert await snapshot(sessions, session_id) == (3, 0, {}, [])

    mysql_run(scenario)


def test_mysql_emergency_block_keeps_rereads_and_new_levels_on_approved_text():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=1, state=STATE_ZONE_A)
        store = store_with(pinned())
        async with HintApi(sessions, store) as api:
            assert (await api.hint(session_id, 1, puzzle_id="PZ_A")).status_code == 200

        async with sessions() as db, db.begin():
            repository = NpcPublicationRepository(db)
            await repository.register_version("case_test", 1, FP, now=T0)
            await repository.insert_state("case_test", 1, status="published", now=T0)
        service = NpcPublicationService(sessions, clock=lambda: T0)
        await service.block("case_test", 1, reason="긴급 차단(가상)", actor="test-op")
        assert (await service.current("case_test", 1)).status == "blocked"

        hint_ref = issue_hint_ref(
            KEYS, play_session_id=session_id, puzzle_id="PZ_A", content_fingerprint=FP
        )
        async with HintApi(sessions, store) as api:
            reread = await api.hint(session_id, 1, hint_ref=hint_ref)
            empty = await api.hint(session_id, 2, puzzle_id="PZ_A")
        # 잔액 0이어도 재열람은 무료이고 승인 원문이다. 새 단계는 잔액 규칙 그대로다.
        assert reread.status_code == 200
        assert reread.json()["hint"]["text"] == HINT_1
        assert reread.json()["result"]["result_type"] == "already_unlocked"
        assert empty.status_code == 409
        assert empty.json()["detail"]["code"] == "HINT_BALANCE_EMPTY"
        assert await snapshot(sessions, session_id) == (
            0,
            1,
            {"PZ_A": 1},
            ["hint_unlocked", "already_unlocked"],
        )

    mysql_run(scenario)


# --- 호환 별칭 ---


def test_mysql_alias_and_canonical_paths_share_one_service_and_idempotency():
    async def scenario(sessions):
        session_id = await seed(sessions, balance=3, state=STATE_ZONE_A)
        event_id = str(uuid4())
        async with HintApi(sessions, store_with(pinned())) as api:
            alias = await api.unlock(session_id, 1, event_id)
            canonical_replay = await api.hint(session_id, 1, event_id, puzzle_id="PZ_A")
            canonical_next = await api.hint(session_id, 2, puzzle_id="PZ_A")
            alias_reread = await api.unlock(session_id, 2)
            conflict = await api.unlock(session_id, 2, event_id)
        assert alias.status_code == 200
        assert canonical_replay.json() == alias.json()
        assert canonical_next.json()["result"]["result_type"] == "hint_unlocked"
        assert alias_reread.json()["result"]["result_type"] == "already_unlocked"
        assert conflict.status_code == 409
        assert await snapshot(sessions, session_id) == (
            1,
            2,
            {"PZ_A": 2},
            ["hint_unlocked", "hint_unlocked", "already_unlocked"],
        )

    mysql_run(scenario)
