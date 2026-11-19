"""게시 상태 관리 CLI(scripts.publication_state)를 격리 MySQL에서 실제 라우터와 함께 검증한다.

실행 조건 · 안전 장치는 `test_content_release_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`, 전용 빈 schema,
datadir 대조, 끝나면 테이블 삭제). 콘텐츠 · 승인 기록 · 운영자는 가상 데이터다.

- 신규 회차: 실제 `POST /play-sessions`(실제 게시 상태 guard — 대역으로 바꾸지 않는다)
- 진행 중 회차: 실제 `POST …/interactions` · `POST …/puzzles/{id}/hints`
- NPC: NPC 라우터가 쓰는 판정 함수 `read_case_npc_access`(대사 승인 출처 · 긴급 차단). 턴 응답 본문은
  `test_npc_publication_mysql.py` · `test_npc_turn*.py`가 본다.
"""

import asyncio
from pathlib import Path
from uuid import uuid4

import httpx
import pytest

from app.api.v1.hints import get_hint_economy_config
from app.db.session import get_db
from app.main import app
from app.models.play_session import PlaySession
from app.schemas.gate_review import ApprovalTarget, GateReviewCreate
from app.services.content_release import restore_on_startup
from app.services.gate_review import create_gate_review
from app.services.hint_balance import HintEconomyConfig
from app.services.npc_case_access import read_case_npc_access
from app.services.npc_publication import NpcPublicationService
from app.services.pinned_content import ContentPin, PinnedContentStore
from app.services.session_content import get_pinned_content_store
from scripts import publication_state as cli
from scripts.publish_case_content import CliInputError
from tests.test_case_publication_cli import write_bundle
from tests.test_content_release_mysql import (
    ADMIN,
    anonymous_session,
    approve,
    mysql_run,
    pytestmark,  # noqa: F401
    release,
)
from tests.test_publication_gate import CASE_ID

DB = "isolated_test_db"
STAMP = "2026-11-09T12:00:00+09:00"


class Api:
    """실제 라우터를 격리 DB 세션으로 부른다(요청마다 새 DB 세션). 게시 상태 guard는 실제 것을 쓴다."""

    def __init__(self, sessions, store: PinnedContentStore) -> None:
        self.sessions = sessions
        self.store = store

    async def __aenter__(self):
        async def override_get_db():
            async with self.sessions() as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_pinned_content_store] = lambda: self.store
        app.dependency_overrides[get_hint_economy_config] = lambda: HintEconomyConfig()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )
        return self

    async def __aexit__(self, *exc):
        await self.client.aclose()
        for dependency in (get_db, get_pinned_content_store, get_hint_economy_config):
            app.dependency_overrides.pop(dependency, None)

    async def start(self, version: int = 1):
        anonymous_id = await anonymous_session(self.sessions)
        return await self.client.post(
            "/api/v1/play-sessions",
            json={
                "anonymous_session_id": anonymous_id,
                "case_id": CASE_ID,
                "content_version": version,
            },
        )

    async def answer(self, session_id: str, value: str, event_id: str | None = None):
        return await self.client.post(
            f"/api/v1/play-sessions/{session_id}/interactions",
            json={
                "client_event_id": event_id or str(uuid4()),
                "client_timestamp": STAMP,
                "zone_id": "ZONE_A",
                "action": "input",
                "target_type": "object",
                "target_id": "OBJ_S1_LOCK_1",
                "payload": {"answer": value},
            },
        )

    async def hint(self, session_id: str, level: int, event_id: str | None = None):
        return await self.client.post(
            f"/api/v1/play-sessions/{session_id}/puzzles/PUZZLE_A/hints",
            json={
                "client_event_id": event_id or str(uuid4()),
                "client_timestamp": STAMP,
                "target_level": level,
            },
        )


async def run_cli(sessions, root: Path, *argv: str) -> tuple[int, list[str]]:
    lines: list[str] = []
    code = await cli.run(
        cli.parse_args(list(argv)), sessions, DB, str(root), out=lines.append
    )
    return code, lines


def change(action: str, fingerprint: str, version: int = 1, *extra: str) -> list[str]:
    return [
        action,
        "--case-id",
        CASE_ID,
        "--content-version",
        str(version),
        "--expect-fingerprint",
        fingerprint,
        "--actor",
        "operator-test",
        "--reason",
        f"(가상) {action}",
        *extra,
    ]


COMMIT = ("--commit", "--confirm-db", DB)


async def npc_access(sessions, row: PlaySession):
    async with sessions() as db:
        return await read_case_npc_access(
            db,
            ContentPin(row.case_id, row.content_version, row.content_fingerprint),
            lock=False,
        )


async def load(sessions, session_id: str) -> PlaySession:
    async with sessions() as db:
        return await db.get(PlaySession, session_id)


async def status_of(sessions, version: int = 1) -> str | None:
    snapshot = await NpcPublicationService(sessions).current(CASE_ID, version)
    return snapshot.status if snapshot else None


# 버전별 마지막 승인 기록(재승인은 직전 기록을 supersedes 로 이어야 한다 — 승인 이력 계약)
APPROVALS: dict[int, dict] = {}


async def published_pair(
    sessions, tmp_path, versions=(1, 2)
) -> tuple[dict[int, str], PinnedContentStore]:
    fingerprints = {v: write_bundle(tmp_path, v, f"가상정답{v}") for v in versions}
    store = PinnedContentStore()
    service = NpcPublicationService(sessions)
    for version, fingerprint in fingerprints.items():
        APPROVALS[version] = await approve(sessions, version, fingerprint)
        await release(service, store, tmp_path, version)
    return fingerprints, store


async def reapprove(sessions, version: int, fingerprint: str):
    """차단 뒤 재승인(가상). 승인 이력 계약: 재승인은 직전 기록을 supersedes 로 잇고 사유(reason)가 있어야 한다."""
    records = {}
    for gate, previous in APPROVALS[version].items():
        async with sessions() as db:
            records[gate] = await create_gate_review(
                db,
                GateReviewCreate(
                    **ApprovalTarget(
                        target_type="case_content",
                        target_id=CASE_ID,
                        content_version=version,
                    ).model_dump(),
                    gate=gate,
                    target_hash=fingerprint,
                    decision="approved",
                    reason="(가상) 차단 뒤 재승인",
                    supersedes=previous.review_id,
                ),
                admin=ADMIN,
            )
    APPROVALS[version] = records


# ── A · B · D: published → suspend → resume ──


def test_mysql_cli_suspend_then_resume_keeps_running_sessions(tmp_path):
    # 버전 하나(나주 v1과 같은 모양). 다른 버전이 있을 때는 아래 version_order 테스트가 본다.
    async def scenario(sessions):
        fingerprints, store = await published_pair(sessions, tmp_path, (1,))
        fp = fingerprints[1]
        async with Api(sessions, store) as api:
            # A. published: 신규 회차 · 진행 중 회차 · Hint · NPC
            created = await api.start()
            assert created.status_code == 201
            session_id = created.json()["data"]["play_session_id"]
            assert (await api.answer(session_id, "오답")).json()[
                "result_type"
            ] == "incorrect"
            assert (await api.hint(session_id, 1)).status_code == 200
            row = await load(sessions, session_id)
            assert row.content_fingerprint == fp
            access = await npc_access(sessions, row)
            assert access.approval_source is not None and not access.withdrawn

            # status(읽기 전용)
            code, lines = await run_cli(
                sessions,
                tmp_path,
                "status",
                "--case-id",
                CASE_ID,
                "--content-version",
                "1",
            )
            assert code == cli.EXIT_OK
            assert f"status=published content_fingerprint={fp}" in lines[1]

            # 계획만(--commit 없음): 바뀌지 않는다
            code, lines = await run_cli(sessions, tmp_path, *change("suspend", fp))
            assert code == cli.EXIT_OK and "plan: published -> suspended" in lines
            assert await status_of(sessions) == "published"

            # B. suspend
            code, lines = await run_cli(
                sessions, tmp_path, *change("suspend", fp), *COMMIT
            )
            assert code == cli.EXIT_OK
            assert any(
                line.startswith("result=changed status=suspended") for line in lines
            )
            assert (await api.start()).status_code == 409  # 신규 회차 차단
            # 진행 중 회차는 그대로 — 퍼즐 · Hint · NPC 케이스 대사
            assert (await api.answer(session_id, "오답")).json()[
                "result_type"
            ] == "incorrect"
            assert (await api.hint(session_id, 2)).status_code == 200
            row = await load(sessions, session_id)
            assert (row.id, row.content_fingerprint) == (session_id, fp)
            access = await npc_access(sessions, row)
            assert access.approval_source is not None and not access.withdrawn

            # 같은 명령 다시: 변화 없음
            code, lines = await run_cli(
                sessions, tmp_path, *change("suspend", fp), *COMMIT
            )
            assert (
                code == cli.EXIT_OK and "result=unchanged (already suspended)" in lines
            )

            # D. resume(suspended → published)
            code, lines = await run_cli(
                sessions,
                tmp_path,
                *change("resume", fp, 1, "--content-root", str(tmp_path)),
                *COMMIT,
            )
            assert code == cli.EXIT_OK, "\n".join(lines)
            assert any(
                line.startswith("result=changed status=published") for line in lines
            )
            assert (await api.start()).status_code == 201
            solved = await api.answer(session_id, "가상정답1")
            assert solved.json()["result_type"] == "correct"
            row = await load(sessions, session_id)
            assert row.content_fingerprint == fp
            assert row.state_json["completed_puzzle_ids"] == ["PUZZLE_A"]

        # 서버 재시작: 상태 · 묶음 그대로
        restarted = PinnedContentStore()
        entries = await restore_on_startup(str(tmp_path), sessions, restarted)
        assert [
            (e.content_version, e.status, e.publication_status) for e in entries
        ] == [(1, "registered", "published")]
        events = await NpcPublicationService(sessions).events(CASE_ID, 1)
        assert [(e.from_status, e.to_status, e.actor) for e in events] == [
            (None, "published", "operator-test"),
            ("published", "suspended", "operator-test"),
            ("suspended", "published", "operator-test"),
        ]

    mysql_run(scenario)


# ── C · D: block → resume(재승인 필요) ──


def test_mysql_cli_block_keeps_game_content_and_needs_reapproval_to_resume(tmp_path):
    async def scenario(sessions):
        fingerprints, store = await published_pair(sessions, tmp_path, (1,))
        fp = fingerprints[1]
        async with Api(sessions, store) as api:
            session_id = (await api.start()).json()["data"]["play_session_id"]
            hint_event = str(uuid4())
            first_hint = await api.hint(session_id, 1, hint_event)
            assert first_hint.status_code == 200

            code, lines = await run_cli(
                sessions, tmp_path, *change("block", fp), *COMMIT
            )
            assert code == cli.EXIT_OK
            assert any(
                line.startswith("result=changed status=blocked") for line in lines
            )
            assert any(line.startswith("withdrawn bodies_deleted=") for line in lines)

            assert (await api.start()).status_code == 409  # 신규 회차 차단
            # 진행 중 회차: 게임 진행 · Hint 유지
            assert (await api.answer(session_id, "오답")).json()[
                "result_type"
            ] == "incorrect"
            assert (await api.hint(session_id, 2)).status_code == 200
            # 차단 전에 받은 Hint 를 같은 이벤트로 다시 보내면 처음 응답 그대로(게임 콘텐츠)
            replay = await api.hint(session_id, 1, hint_event)
            assert replay.status_code == 200 and replay.json() == first_hint.json()
            # NPC: 케이스 대사 차단(긴급 차단 표식)
            access = await npc_access(sessions, await load(sessions, session_id))
            assert access.withdrawn and access.approval_source is None

            # 같은 명령 다시: 변화 없음
            code, lines = await run_cli(
                sessions, tmp_path, *change("block", fp), *COMMIT
            )
            assert code == cli.EXIT_OK and "result=unchanged (already blocked)" in lines
            # blocked 에서 suspend 는 허용되지 않는다
            code, lines = await run_cli(
                sessions, tmp_path, *change("suspend", fp), *COMMIT
            )
            assert code == cli.EXIT_CONFLICT
            assert "refused: blocked -> suspended is not allowed" in lines

            resume = change("resume", fp, 1, "--content-root", str(tmp_path))
            # 차단 전 승인만으로는 재개할 수 없다(계약: 마지막 차단 뒤 G1~G3 재승인)
            code, lines = await run_cli(sessions, tmp_path, *resume, *COMMIT)
            assert code == cli.EXIT_BLOCKED
            assert "refused: G1 needs a final approved record after the block" in lines
            assert await status_of(sessions) == "blocked"

            await asyncio.sleep(0.01)
            await reapprove(sessions, 1, fp)  # 차단 뒤 재승인(가상)
            code, lines = await run_cli(sessions, tmp_path, *resume, *COMMIT)
            assert code == cli.EXIT_OK, "\n".join(lines)
            assert (await api.start()).status_code == 201
            access = await npc_access(sessions, await load(sessions, session_id))
            assert access.approval_source is not None and not access.withdrawn

    mysql_run(scenario)


# ── 다른 버전 영향 · 재개 VERSION_ORDER(기존 서비스 계약) ──


def test_mysql_cli_other_version_is_untouched_and_older_version_cannot_resume(
    tmp_path,
):
    """v1을 막아도 v2는 그대로다. 다만 v2가 등록돼 있으면 v1 재개는 게시 게이트의 VERSION_ORDER에서 막힌다.

    재개는 `NpcPublicationService.resume` → 게시 게이트를 다시 돌리고, VERSION_ORDER는 같은 케이스의 다른 등록 버전보다
    커야 통과한다. CLI가 아니라 기존 서비스 계약이다(보고 대상 — 나주는 지금 v1 하나라 해당 없음).
    """

    async def scenario(sessions):
        fingerprints, store = await published_pair(sessions, tmp_path, (1, 2))
        fp = fingerprints[1]
        async with Api(sessions, store) as api:
            other_id = (await api.start(version=2)).json()["data"]["play_session_id"]
            await run_cli(sessions, tmp_path, *change("suspend", fp), *COMMIT)
            assert await status_of(sessions, 2) == "published"
            assert (await api.start(version=2)).status_code == 201
            await run_cli(sessions, tmp_path, *change("block", fp), *COMMIT)
            assert await status_of(sessions, 2) == "published"
            other = await npc_access(sessions, await load(sessions, other_id))
            assert other.approval_source is not None and not other.withdrawn

            await asyncio.sleep(0.01)
            await reapprove(sessions, 1, fp)
            code, lines = await run_cli(
                sessions,
                tmp_path,
                *change("resume", fp, 1, "--content-root", str(tmp_path)),
                *COMMIT,
            )
            assert code == cli.EXIT_BLOCKED
            assert any("VERSION_ORDER" in line and "FAIL" in line for line in lines)
            assert await status_of(sessions) == "blocked"

    mysql_run(scenario)


# ── E: 실패 · 동시성 ──


def test_mysql_cli_rejects_bad_targets_and_serializes_concurrent_changes(tmp_path):
    async def scenario(sessions):
        fingerprints, _ = await published_pair(sessions, tmp_path)
        fp = fingerprints[1]

        # 없는 버전
        code, lines = await run_cli(
            sessions, tmp_path, *change("suspend", fp, 9), *COMMIT
        )
        assert (
            code == cli.EXIT_INPUT
            and "refused: target has no publication state" in lines
        )
        # 다른 버전의 fingerprint 를 적으면 거부
        code, lines = await run_cli(
            sessions, tmp_path, *change("suspend", fingerprints[2], 1), *COMMIT
        )
        assert code == cli.EXIT_CONFLICT
        assert await status_of(sessions) == "published"
        # published 를 resume: 변화 없음
        code, lines = await run_cli(
            sessions,
            tmp_path,
            *change("resume", fp, 1, "--content-root", str(tmp_path)),
            *COMMIT,
        )
        assert code == cli.EXIT_OK and "result=unchanged (already published)" in lines
        # 확인 플래그 없음 · DB 이름 불일치는 DB 를 바꾸기 전에 거부
        with pytest.raises(CliInputError):
            await run_cli(sessions, tmp_path, *change("suspend", fp), "--commit")
        with pytest.raises(CliInputError):
            await run_cli(
                sessions,
                tmp_path,
                *change("suspend", fp),
                "--commit",
                "--confirm-db",
                "other",
            )
        assert await status_of(sessions) == "published"

        # 동시에 suspend 두 번: 하나만 바뀌고 다른 하나는 거부 또는 변화 없음
        results = await asyncio.gather(
            run_cli(sessions, tmp_path, *change("suspend", fp), *COMMIT),
            run_cli(sessions, tmp_path, *change("suspend", fp), *COMMIT),
        )
        changed = [
            r for r in results if any(x.startswith("result=changed") for x in r[1])
        ]
        assert len(changed) == 1
        assert all(code in (cli.EXIT_OK, cli.EXIT_CONFLICT) for code, _ in results)
        # suspend 와 block 이 겹쳐도 최종 상태는 이력과 맞는다
        await asyncio.gather(
            run_cli(sessions, tmp_path, *change("block", fp), *COMMIT),
            run_cli(sessions, tmp_path, *change("block", fp), *COMMIT),
        )
        assert await status_of(sessions) == "blocked"
        events = await NpcPublicationService(sessions).events(CASE_ID, 1)
        assert [e.to_status for e in events] == ["published", "suspended", "blocked"]
        assert await status_of(sessions, 2) == "published"

    mysql_run(scenario)


def test_mysql_cli_resume_refuses_changed_files(tmp_path):
    async def scenario(sessions):
        fingerprints, _ = await published_pair(sessions, tmp_path)
        fp = fingerprints[1]
        await run_cli(sessions, tmp_path, *change("suspend", fp), *COMMIT)
        write_bundle(tmp_path, 1, "가상교체정답")  # 게시 뒤 파일이 바뀜
        code, lines = await run_cli(
            sessions,
            tmp_path,
            *change("resume", fp, 1, "--content-root", str(tmp_path)),
            *COMMIT,
        )
        assert code == cli.EXIT_CONFLICT
        assert (
            "refused: bundle on disk differs from the registered fingerprint" in lines
        )
        assert await status_of(sessions) == "suspended"

    mysql_run(scenario)
