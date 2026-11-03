"""FE 연동 계약(격리 MySQL · 실제 라우터). FE를 바꾸지 않고, FE가 지금 쓰는 흐름과 앞으로 붙일 흐름의 BE 계약을 고정한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).
- 레거시 `case_001`: 저장소의 실제 콘텐츠 파일. FE `src/server/playSession.ts`가 부르는 순서 그대로다.
- 버전 고정 세션: 나주 콘텐츠가 아직 없어 테스트용 가상 게시 콘텐츠(`case_test` v1, `test_hint_balance_mysql.pinned`)를 쓴다.
  나주 퍼즐 · 정답이 아니다.
- 신규 세션 게시 확인은 운영 guard(`require_published_for_new_session`)를 그대로 쓴다(대역 없음).
- 일반 팩 승인은 이 격리 DB에만 넣는 테스트용 가상 승인이다(운영 승인 기록이 아니다).
- 모든 오류 응답은 `assert_documented`로 OpenAPI 명세(상태 · 본문 모델 · 문장/code)와 대조한다.
"""

import os
from datetime import datetime, timedelta
from uuid import uuid4

import httpx
import pytest

from app.api.v1.hints import get_hint_economy_config
from app.api.v1.npc import get_hint_ref_keys
from app.core.config import settings
from app.db.session import get_db
from app.main import app
from app.models.anonymous_session import AnonymousSession
from app.models.play_session import PlaySession
from app.services import case_content, puzzle_runtime
from app.services.hint_balance import HintEconomyConfig
from app.services.npc_publication import NpcPublicationService
from app.services.puzzle_runtime import load_case_runtime
from app.services.session_content import (
    CASE_VERSION_UNAVAILABLE,
    get_pinned_content_store,
)
from tests.test_api_error_contract import assert_documented
from tests.test_content_release_mysql import mysql_run
from tests.test_hint_api_mysql import KEYS
from tests.test_hint_balance_mysql import (
    CASE,
    HINT_1,
    HINT_2,
    pinned,
    seed,
    snapshot,
    store_with,
)
from tests.test_npc_case_access_mysql import WITHDRAWN, publish_state
from tests.test_npc_general_pack import OFFICIAL
from tests.test_npc_general_pack_mysql import approve_pack, expected
from tests.test_npc_turn import FP

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

SESSIONS = "/api/v1/play-sessions"
SESSION = "/api/v1/play-sessions/{play_session_id}"
SESSION_BUNDLE = "/api/v1/play-sessions/{play_session_id}/bundle"
CASE_BUNDLE = "/api/v1/cases/{case_id}/bundle"
INTERACTIONS = "/api/v1/play-sessions/{play_session_id}/interactions"
HINTS = "/api/v1/play-sessions/{play_session_id}/hints"
NPC_TURNS = "/api/v1/play-sessions/{play_session_id}/npc/turns"

# FE `PLAY_CONTRACT`(src/server/playSession.ts)와 같은 값
LEGACY_CASE = "case_001"
LEGACY_ZONE = "ZONE_SECRET_CORRIDOR"
LEGACY_LOCK = "OBJ_FIRE_CABINET_LOCK"
LEGACY_FLAG = "fire_cabinet_unlocked"
EVENT_CONFLICT = "Client event ID conflicts with a previous interaction."


@pytest.fixture(autouse=True)
def official_pack_configured(monkeypatch):
    monkeypatch.setattr(settings, "npc_general_pack", OFFICIAL)


def legacy_answer() -> str:
    # 정답은 만들지 않고 저장소의 실제 case_001 콘텐츠에서 읽는다.
    return load_case_runtime(LEGACY_CASE).puzzles[0].accepted_answers[0]


class Contract:
    """실제 라우터를 격리 DB로 부른다. 응답마다 오류 명세를 확인한다(신규 세션 게시 guard는 운영 그대로)."""

    def __init__(self, sessions, store=None, hint_ref_keys=None) -> None:
        self.sessions = sessions
        self.store = store or store_with(pinned())
        self.hint_ref_keys = hint_ref_keys

    async def __aenter__(self):
        async def override_get_db():
            async with self.sessions() as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_pinned_content_store] = lambda: self.store
        app.dependency_overrides[get_hint_economy_config] = HintEconomyConfig
        app.dependency_overrides[get_hint_ref_keys] = lambda: self.hint_ref_keys
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
            get_hint_ref_keys,
        ):
            app.dependency_overrides.pop(dependency, None)

    async def call(self, method: str, template: str, url: str, **kwargs):
        response = await self.client.request(method, url, **kwargs)
        assert_documented(response, method, template)
        return response

    async def anonymous(self) -> str:
        response = await self.call(
            "POST", "/api/v1/anonymous-sessions", "/api/v1/anonymous-sessions"
        )
        assert response.status_code == 201, response.text
        assert set(response.json()["data"]) == {"anonymous_session_id", "expires_at"}
        return response.json()["data"]["anonymous_session_id"]

    async def start(self, anonymous_id: str, case_id: str, version=None):
        payload = {"anonymous_session_id": anonymous_id, "case_id": case_id}
        if version is not None:
            payload["content_version"] = version
        return await self.call("POST", SESSIONS, SESSIONS, json=payload)

    async def read(self, session_id: str):
        return await self.call("GET", SESSION, f"{SESSIONS}/{session_id}")

    async def session_bundle(self, session_id: str):
        return await self.call("GET", SESSION_BUNDLE, f"{SESSIONS}/{session_id}/bundle")

    async def case_bundle(self, case_id: str):
        return await self.call("GET", CASE_BUNDLE, f"/api/v1/cases/{case_id}/bundle")

    async def interact(self, session_id: str, event_id: str, answer: str):
        return await self.call(
            "POST",
            INTERACTIONS,
            f"{SESSIONS}/{session_id}/interactions",
            json={
                "client_event_id": event_id,
                "client_timestamp": "2026-11-03T12:00:00.000Z",
                "zone_id": LEGACY_ZONE,
                "action": "input",
                "target_type": "object",
                "target_id": LEGACY_LOCK,
                "payload": {"answer": answer},
            },
        )

    async def hint(self, session_id: str, level: int, event_id=None, **target):
        target = target or {"puzzle_id": "PZ_A"}
        return await self.call(
            "POST",
            HINTS,
            f"{SESSIONS}/{session_id}/hints",
            json={
                "client_event_id": event_id or str(uuid4()),
                "client_timestamp": "2026-11-03T12:00:00+09:00",
                "target_level": level,
                **target,
            },
        )

    async def npc(self, session_id: str, request: dict):
        return await self.call(
            "POST", NPC_TURNS, f"{SESSIONS}/{session_id}/npc/turns", json=request
        )


def npc_request(event_id: str | None = None, message: str = "어디부터 볼까?") -> dict:
    return {
        "client_event_id": event_id or str(uuid4()),
        "client_timestamp": "2026-11-03T12:00:00+09:00",
        "trigger": "player_message",
        "message": message,
    }


async def expired_anonymous(sessions) -> str:
    anonymous_id = str(uuid4())
    now = datetime.utcnow()
    async with sessions() as db, db.begin():
        db.add(
            AnonymousSession(
                id=anonymous_id,
                created_at=now - timedelta(days=2),
                expires_at=now - timedelta(days=1),
            )
        )
    return anonymous_id


async def legacy_row(sessions, session_id: str) -> PlaySession:
    async with sessions() as db:
        return await db.get(PlaySession, session_id)


async def block(sessions) -> None:
    await NpcPublicationService(sessions).block(
        CASE, 1, reason="(가상) 긴급", actor="op"
    )


# ── 레거시 case_001: FE가 지금 쓰는 흐름 ──


def test_mysql_legacy_case_001_flow_matches_what_the_fe_calls():
    async def scenario(sessions):
        async with Contract(sessions) as api:
            anonymous_id = await api.anonymous()
            created = await api.start(anonymous_id, LEGACY_CASE)
            assert created.status_code == 201, created.text
            session_id = created.json()["data"]["play_session_id"]
            read = await api.read(session_id)
            by_case = await api.case_bundle(LEGACY_CASE)
            by_session = await api.session_bundle(session_id)

            wrong_id, right_id = str(uuid4()), str(uuid4())
            wrong = await api.interact(session_id, wrong_id, "틀린 답(가상)")
            wrong_replay = await api.interact(session_id, wrong_id, "틀린 답(가상)")
            conflict = await api.interact(session_id, wrong_id, "다른 답(가상)")
            right = await api.interact(session_id, right_id, legacy_answer())
            right_replay = await api.interact(session_id, right_id, legacy_answer())
            after = await api.read(session_id)
            # case_001에는 힌트 원문이 없다 — 잔액을 쓰지 않고 404
            no_hint = await api.hint(
                session_id, 1, puzzle_id="PUZZLE_FIRE_CABINET_LOCK"
            )
            # NPC는 버전 고정 세션만 받는다 — 레거시 세션은 409
            npc = await api.npc(session_id, npc_request())

        assert read.status_code == 200
        assert read.json()["data"]["case_id"] == LEGACY_CASE
        assert read.json()["data"]["completed_at"] is None
        assert by_case.status_code == by_session.status_code == 200
        assert by_session.json() == by_case.json()
        assert by_case.json()["data"]["entry_zone_id"] == LEGACY_ZONE

        assert wrong.json()["result_type"] == "incorrect"
        assert wrong_replay.json() == wrong.json()  # 같은 이벤트 ID → 처음 응답 그대로
        assert conflict.status_code == 409
        assert conflict.json() == {"detail": EVENT_CONFLICT}
        assert right.json()["result_type"] == "correct"
        assert right_replay.json() == right.json()
        state = after.json()["data"]["state"]
        assert state["flags"][LEGACY_FLAG] is True
        assert state["attempt_counts"] == {"PUZZLE_FIRE_CABINET_LOCK": 2}

        assert no_hint.status_code == 404
        assert (npc.status_code, npc.json()) == (
            409,
            {"detail": CASE_VERSION_UNAVAILABLE},
        )
        row = await legacy_row(sessions, session_id)
        assert (row.content_version, row.content_fingerprint) == (None, None)
        assert (row.hint_balance, row.help_used) == (3, 0)

    mysql_run(scenario)


def test_mysql_legacy_session_errors_are_the_documented_ones():
    async def scenario(sessions):
        async with Contract(sessions) as api:
            missing = await api.start(str(uuid4()), LEGACY_CASE)
            expired = await api.start(await expired_anonymous(sessions), LEGACY_CASE)
            unknown_case = await api.start(await api.anonymous(), "case_unknown")
            no_session = await api.read(str(uuid4()))
            no_session_bundle = await api.session_bundle(str(uuid4()))

        assert (missing.status_code, missing.json()) == (
            404,
            {"detail": "Anonymous session not found."},
        )
        assert (expired.status_code, expired.json()) == (
            410,
            {"detail": "Anonymous session has expired."},
        )
        assert (unknown_case.status_code, unknown_case.json()) == (
            404,
            {"detail": "Case not found."},
        )
        assert no_session.status_code == no_session_bundle.status_code == 404

    mysql_run(scenario)


# ── 버전 고정 세션(나주용): 필수 조건 ──


def test_mysql_pinned_session_needs_a_registered_and_published_version():
    async def scenario(sessions):
        async with Contract(sessions) as api:
            anonymous_id = await api.anonymous()
            # 버전 없이 만들면 레거시 경로 — 게시 콘텐츠만 있는 케이스는 파일이 없어 404
            legacy = await api.start(anonymous_id, CASE)
            bad_version = await api.start(anonymous_id, CASE, "v1")
            unregistered = await api.start(anonymous_id, CASE, 2)
            unpublished = await api.start(anonymous_id, CASE, 1)

            await publish_state(sessions, fingerprint=FP)
            created = await api.start(anonymous_id, CASE, 1)
            session_id = created.json()["data"]["play_session_id"]
            session_bundle = await api.session_bundle(session_id)
            file_bundle = await api.case_bundle(CASE)
            read = await api.read(session_id)

        assert (legacy.status_code, legacy.json()) == (
            404,
            {"detail": "Case not found."},
        )
        assert bad_version.status_code == 422
        refused = {"detail": CASE_VERSION_UNAVAILABLE}
        # 미등록 · 미게시는 같은 본문이다(구분 불가 — 보고 항목)
        assert (unregistered.status_code, unregistered.json()) == (409, refused)
        assert (unpublished.status_code, unpublished.json()) == (409, refused)

        assert created.status_code == 201, created.text
        assert created.json()["data"]["case_id"] == CASE
        # 복원 · 렌더는 세션 번들로: 고정 버전의 Client 콘텐츠다. 케이스 번들 경로에는 없다.
        assert session_bundle.status_code == 200
        assert session_bundle.json()["data"]["case_id"] == CASE
        assert file_bundle.status_code == 404
        assert read.json()["data"]["state"]["hint_levels"] == {}
        row = await legacy_row(sessions, session_id)
        assert (row.content_version, row.content_fingerprint) == (1, FP)

    mysql_run(scenario)


# ── 긴급 중단: 신규 고정 세션 차단 · 기존 세션 Hint · NPC 유지 ──


def test_mysql_block_refuses_new_pinned_sessions_and_keeps_existing_sessions():
    async def scenario(sessions):
        await publish_state(sessions, fingerprint=FP)
        async with Contract(sessions) as api:
            anonymous_id = await api.anonymous()
            created = await api.start(anonymous_id, CASE, 1)
            session_id = created.json()["data"]["play_session_id"]
            first = await api.hint(session_id, 1)

            await block(sessions)

            refused = await api.start(anonymous_id, CASE, 1)
            # 현재 동작: 레거시 경로에는 게시 상태 확인이 없다(PM 결정 대기, 바꾸지 않는다)
            legacy = await api.start(anonymous_id, LEGACY_CASE)

            event_id = str(uuid4())
            second = await api.hint(session_id, 2, event_id)
            second_replay = await api.hint(session_id, 2, event_id)
            second_conflict = await api.hint(session_id, 1, event_id)
            read = await api.read(session_id)
            session_bundle = await api.session_bundle(session_id)

        assert created.status_code == 201, created.text
        assert refused.status_code == 409
        assert refused.json() == {"detail": CASE_VERSION_UNAVAILABLE}
        assert legacy.status_code == 201

        assert first.json()["hint"] == {"level": 1, "text": HINT_1}
        assert second.status_code == 200, second.text
        assert second.json()["hint"] == {"level": 2, "text": HINT_2}
        result = second.json()["result"]
        assert (result["hint_balance"], result["help_used"]) == (1, 2)
        assert second_replay.json() == second.json()  # 같은 이벤트 ID → 추가 차감 없음
        assert (second_conflict.status_code, second_conflict.json()) == (
            409,
            {"detail": EVENT_CONFLICT},
        )
        assert await snapshot(sessions, session_id) == (
            1,
            2,
            {"PZ_A": 2},
            ["hint_unlocked", "hint_unlocked"],
        )
        # 잔액은 해금 응답에만 있다 — 세션 조회 응답에는 없다(조회 API는 계약 결정 대기)
        assert "hint_balance" not in read.json()["data"]
        assert "hint_balance" not in read.json()["data"]["state"]
        assert session_bundle.status_code == 200

    mysql_run(scenario)


def test_mysql_npc_during_block_answers_with_approved_pause_line_or_null():
    async def scenario(sessions):
        await publish_state(sessions, fingerprint=FP)
        async with Contract(sessions) as api:
            created = await api.start(await api.anonymous(), CASE, 1)
            session_id = created.json()["data"]["play_session_id"]
            normal = await api.npc(session_id, npc_request())

            await block(sessions)

            # 승인된 일반 팩이 없다(현재 운영과 같음) → reply null
            silent_request = npc_request()
            silent = await api.npc(session_id, silent_request)
            silent_replay = await api.npc(session_id, silent_request)
            conflict = await api.npc(
                session_id, npc_request(silent_request["client_event_id"], "다른 말")
            )

            # 테스트용 가상 승인(격리 DB) 뒤에는 승인 원문 하나
            await approve_pack(sessions)
            spoken_request = npc_request()
            spoken = await api.npc(session_id, spoken_request)
            spoken_replay = await api.npc(session_id, spoken_request)

        assert normal.status_code == 200
        assert normal.json()["fallback_reason"] != WITHDRAWN
        assert normal.json()["content_mode"] is None

        assert silent.status_code == 200
        assert silent.json()["reply"] is None
        assert silent.json()["suggest_hint"] is None
        assert (silent.json()["fallback_reason"], silent.json()["content_mode"]) == (
            WITHDRAWN,
            "generic",
        )
        assert silent_replay.json() == silent.json()
        assert (conflict.status_code, conflict.json()) == (
            409,
            {"detail": EVENT_CONFLICT},
        )

        assert spoken.json()["reply"] == expected(spoken_request)
        assert spoken.json()["reply"]["source"] == "approved_line"
        assert (spoken.json()["fallback_reason"], spoken.json()["content_mode"]) == (
            WITHDRAWN,
            "generic",
        )
        assert spoken_replay.json() == spoken.json()

    mysql_run(scenario)


# ── Hint 오류 계약 ──


def test_mysql_hint_errors_are_the_documented_ones():
    async def scenario(sessions):
        empty_id = await seed(sessions, balance=0)
        ref = "hr1.t1." + "A" * 43
        async with Contract(sessions) as api:
            empty = await api.hint(empty_id, 1)
            no_keys = await api.hint(empty_id, 1, hint_ref=ref)
            legacy = await api.start(await api.anonymous(), LEGACY_CASE)
            legacy_id = legacy.json()["data"]["play_session_id"]
        async with Contract(sessions, hint_ref_keys=KEYS) as api:
            malformed = await api.hint(empty_id, 1, hint_ref="not-a-ref")
            mismatch = await api.hint(empty_id, 1, hint_ref=ref)
            legacy_ref = await api.hint(legacy_id, 1, hint_ref=ref)
            skipped = await api.hint(await seed(sessions), 2)
            missing = await api.hint(str(uuid4()), 1)

        assert empty.status_code == 409
        detail = empty.json()["detail"]
        assert detail["code"] == "HINT_BALANCE_EMPTY"
        assert set(detail) == {
            "code",
            "message",
            "minigames_left",
            "special_minigame_available",
        }
        assert await snapshot(sessions, empty_id) == (0, 0, {}, [])  # 차감 · 기록 없음

        assert no_keys.status_code == 503
        assert no_keys.json()["detail"]["code"] == "HINT_REF_UNAVAILABLE"
        assert malformed.status_code == 422
        assert malformed.json()["detail"]["code"] == "HINT_REF_INVALID"
        assert mismatch.status_code == legacy_ref.status_code == 409
        assert mismatch.json()["detail"]["code"] == "HINT_REF_MISMATCH"
        assert legacy_ref.json()["detail"]["code"] == "HINT_REF_MISMATCH"
        assert (skipped.status_code, skipped.json()) == (
            409,
            {"detail": "Previous hint level is not unlocked."},
        )
        assert (missing.status_code, missing.json()) == (
            404,
            {"detail": "Play session not found."},
        )

    mysql_run(scenario)


# ── Hint: 레거시 세션의 케이스 콘텐츠 파일이 없을 때 ──


def write_legacy_case(directory) -> None:
    """테스트용 가상 콘텐츠(`case_test`)를 파일 기반 레거시 케이스로 둔다(나주 콘텐츠가 아니다)."""

    bundle = pinned()
    for kind, model in (("server", bundle.server()), ("client", bundle.client())):
        (directory / f"{CASE}.{kind}.json").write_text(
            model.model_dump_json(by_alias=True), encoding="utf-8"
        )


def test_mysql_hint_on_a_legacy_session_whose_case_files_are_gone(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    server_file = tmp_path / f"{CASE}.server.json"
    client_file = tmp_path / f"{CASE}.client.json"
    case_not_found = (404, {"detail": "Case not found."})

    async def scenario(sessions):
        # 콘텐츠 파일이 처음부터 없는 레거시 세션(버전 칼럼 NULL)
        orphan_id = await seed(sessions, pinned_fp=None)
        orphan_event = str(uuid4())
        async with Contract(sessions) as api:
            orphan = await api.hint(orphan_id, 1, orphan_event)
            orphan_resend = await api.hint(orphan_id, 1, orphan_event)
        assert (orphan.status_code, orphan.json()) == case_not_found
        assert orphan_resend.json() == orphan.json()
        assert str(tmp_path) not in orphan.text
        assert await snapshot(sessions, orphan_id) == (3, 0, {}, [])  # 차감 · 기록 없음

        # 파일이 있을 때 연 단계 → 파일이 사라진 뒤 재전송 · 새 단계 → 복구 뒤 재전송
        write_legacy_case(tmp_path)
        legacy_id = await seed(sessions, pinned_fp=None)
        pinned_id = await seed(sessions)
        first_event = str(uuid4())
        async with Contract(sessions) as api:
            first = await api.hint(legacy_id, 1, first_event)

            server_file.unlink()
            gone_resend = await api.hint(legacy_id, 1, first_event)
            gone_next = await api.hint(legacy_id, 2)
            # 고정 세션은 게시 묶음을 쓰므로 파일과 무관하다
            pinned_hint = await api.hint(pinned_id, 1)

            write_legacy_case(tmp_path)
            client_file.unlink()
            client_gone = await api.hint(legacy_id, 2)

            write_legacy_case(tmp_path)
            server_file.write_text("{", encoding="utf-8")
            broken = await api.hint(legacy_id, 2)

            write_legacy_case(tmp_path)
            restored_resend = await api.hint(legacy_id, 1, first_event)
            restored_next = await api.hint(legacy_id, 2)

        assert first.status_code == 200, first.text
        assert first.json()["hint"] == {"level": 1, "text": HINT_1}
        for response in (gone_resend, gone_next, client_gone):
            assert (response.status_code, response.json()) == case_not_found
        assert (broken.status_code, broken.json()) == (
            500,
            {"detail": "Case content is unavailable."},
        )
        assert pinned_hint.status_code == 200, pinned_hint.text
        assert (
            restored_resend.json() == first.json()
        )  # 같은 이벤트 ID → 처음 응답 그대로
        assert restored_next.status_code == 200, restored_next.text
        assert restored_next.json()["hint"] == {"level": 2, "text": HINT_2}
        assert await snapshot(sessions, legacy_id) == (
            1,
            2,
            {"PZ_A": 2},
            ["hint_unlocked", "hint_unlocked"],
        )

    mysql_run(scenario)
