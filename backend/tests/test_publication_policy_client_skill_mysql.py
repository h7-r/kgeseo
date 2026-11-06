"""Synthetic approval/publication/restore/complete on isolated MySQL only."""

from uuid import uuid4

from app.api.v1.play_sessions import get_new_session_publication_guard
from app.main import app
from app.services.content_release import sync_published_content
from app.services.npc_publication import NpcPublicationService
from app.services.pinned_content import PinnedContentStore
from scripts import publish_case_content as cli
from scripts import record_gate_review as review_cli
from tests.test_case_publication_cli import write_documents
from tests.test_case_publication_cli_mysql import db_name, publish_args, review_args
from tests.test_content_release_mysql import mysql_run, pytestmark  # noqa: F401
from tests.test_hint_balance_mysql import Api, new_anonymous
from tests.test_publication_gate import CASE_ID
from tests.test_publication_policy_client_skill import skill_documents


def test_mysql_cli_policy_skill_end_to_end_preserves_approved_content(tmp_path):
    docs = skill_documents()
    fingerprint = write_documents(tmp_path, docs)
    name = db_name()

    async def scenario(sessions):
        service = NpcPublicationService(sessions)
        for gate in ("G1", "G2", "G3"):
            await review_cli.run(
                review_args(tmp_path, fingerprint, gate, "--commit", "--confirm-db", name),
                sessions,
                name,
                lambda line: None,
            )
        # A new fingerprint cannot reuse approvals for the old bytes.
        docs["npc"]["general_nudges"][0]["text"] = "(가상) 다른 안전한 문장"
        assert write_documents(tmp_path, docs) != fingerprint
        output = []
        assert await cli.run(
            publish_args(tmp_path, "--db"), sessions, name, "", output.append
        ) == cli.EXIT_BLOCKED
        assert any("stale" in line for line in output)
        assert await service.restorable_versions() == ()
        # Restore the approved synthetic bytes, then publish only to the test schema.
        docs["npc"]["general_nudges"][0]["text"] = "(가상) 둘러보자."
        assert write_documents(tmp_path, docs) == fingerprint
        args = publish_args(
            tmp_path, "--commit", "--confirm-db", name,
            actor="operator-test", reason="(가상) 정책·skill 통합",
        )
        output.clear()
        assert await cli.run(args, sessions, name, str(tmp_path), output.append) == cli.EXIT_OK
        states = await service.restorable_versions()
        assert len(states) == 1 and states[0].content_fingerprint == fingerprint
        store = PinnedContentStore()
        entries = await sync_published_content(service, store, tmp_path)
        assert entries[0].status == "registered"
        bundle = store.get_version(CASE_ID, 1)
        assert bundle.server().puzzles[0].solve.mode == "client_skill"
        assert bundle.npc().proper_nouns == [] and bundle.npc().ng == []
        anonymous_id = await new_anonymous(sessions)
        async with Api(sessions, store) as api:
            # Use the real publication guard, not the hint helper's test stub.
            app.dependency_overrides.pop(get_new_session_publication_guard, None)
            created = await api.client.post(
                "/api/v1/play-sessions",
                json={"anonymous_session_id": anonymous_id, "case_id": CASE_ID, "content_version": 1},
            )
            assert created.status_code == 201, created.text
            session_id = created.json()["data"]["play_session_id"]
            request = {
                "client_event_id": str(uuid4()),
                "client_timestamp": "2026-11-05T00:00:00+00:00",
                "zone_id": "ZONE_A", "action": "complete", "target_type": "object",
                "target_id": "OBJ_S1_LOCK_1", "payload": {},
            }
            url = f"/api/v1/play-sessions/{session_id}/interactions"
            first = await api.client.post(url, json=request)
            assert first.status_code == 200 and first.json()["result_type"] == "correct"
            replay = await api.client.post(url, json=request)
            assert replay.json() == first.json()
            duplicate = await api.client.post(url, json={**request, "client_event_id": str(uuid4())})
            assert duplicate.json()["result_type"] == "already_completed"
            assert duplicate.json()["state_changes"] == []
        # Failure against changed bytes must not replace the prior publication.
        docs["npc"]["general_nudges"][0]["text"] = "(가상) 게시 후 변경"
        write_documents(tmp_path, docs)
        assert await cli.run(args, sessions, name, str(tmp_path), lambda line: None) == cli.EXIT_CONFLICT
        assert (await service.restorable_versions())[0].content_fingerprint == fingerprint
        assert len(await service.events(CASE_ID, 1)) == 1
        assert store.get_version(CASE_ID, 1).pin.content_fingerprint == fingerprint

    mysql_run(scenario)
