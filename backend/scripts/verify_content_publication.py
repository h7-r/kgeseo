"""게시 → 버전 고정 세션 → 고정 콘텐츠로 상호작용을 실제 MySQL에서 확인한다(격리 DB에서만 실행).

    $env:DB_NAME = "waegok_test"
    .\\.venv\\Scripts\\python.exe -m scripts.verify_content_publication

게시 저장소는 이 스크립트 안의 메모리 저장소이고, 콘텐츠 · 승인 기록은 이 스크립트 안의 가상 데이터다
(실제 PM 콘텐츠 · 실제 승인이 아니다). 검증용 세션 행을 직접 만들고, 끝나면 그 행만 지운다.
"""

import asyncio
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal, engine
from app.models.anonymous_session import AnonymousSession
from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.schemas.interaction import SubmitAnswerInteraction, SubmitAnswerPayload
from app.services.approval_history import ReviewRecord
from app.services.content_fingerprint import compute_content_fingerprint
from app.services.content_publication import ContentPublisher, PublicationBundle
from app.services.interaction import process_interaction
from app.services.pinned_content import PinnedContentStore, resolve_session_content
from app.services.play_session import create_play_session

ZONE_ID = "ZONE_A"


def _documents(case_id: str, version: int, answer: str) -> dict[str, dict]:
    client = {
        "entry_zone_id": ZONE_ID,
        "zones": [
            {
                "zone_id": ZONE_ID,
                "zone_name": "(가상) 방",
                "zone_type": "room",
                "description": "(가상) 방",
                "objects": [
                    {
                        "object_id": "OBJ_LOCK",
                        "object_name": "(가상) 자물쇠",
                        "object_type": "lock",
                        "visible": True,
                        "enabled": True,
                        "interaction": {"type": "input", "target_id": "PUZZLE_A"},
                    }
                ],
                "navigation": [],
            }
        ],
    }
    server = {
        "schema_version": "0.1",
        "puzzles": [
            {
                "puzzle_id": "PUZZLE_A",
                "accepted_answers": [answer],
                "on_correct": {"grant_clue_ids": [], "set_flags": {}},
                "hints": [{"level": 1, "text": "(가상) 힌트"}],
            }
        ],
        "clue_combinations": [],
    }
    npc = {
        "schema_version": "npc-pack 0.1",
        "npc_id": "NPC_COMPANION",
        "status": "published",
        "approvals": [],
        "generated_at": "2026-11-03T00:00:00Z",
        "general_nudges": [],
        "puzzles": [
            {
                "puzzle_id": "PUZZLE_A",
                "nudges": [
                    {
                        "line_id": "NUDGE_LOOK",
                        "text": "(가상) 둘러보자.",
                        "reveal_when": {"always": True},
                    }
                ],
                "hints": [{"level": 1}],
            }
        ],
    }
    documents = {"client": client, "server": server, "npc": npc}
    for document in documents.values():
        document["case_id"] = case_id
        document["content_version"] = version
    return documents


def _seal(documents: dict[str, dict]) -> tuple[PublicationBundle, str]:
    def encode() -> dict[str, bytes]:
        return {
            role: json.dumps(doc, ensure_ascii=False).encode("utf-8")
            for role, doc in documents.items()
        }

    fingerprint = compute_content_fingerprint(**encode())
    for document in documents.values():
        document["content_fingerprint"] = fingerprint
    return PublicationBundle(**encode()), fingerprint


def _approving(fingerprint: str):
    records = [
        ReviewRecord(
            review_id=str(uuid.uuid4()),
            gate=gate,
            target_hash=fingerprint,
            decision="approved",
            reviewer="reviewer-verification",
            reviewed_at="2026-11-03T00:00:00.000Z",
        )
        for gate in ("G1", "G2", "G3")
    ]
    return lambda case_id, version: records


def _publish(store: PinnedContentStore, case_id: str, version: int, answer: str):
    bundle, fingerprint = _seal(_documents(case_id, version, answer))
    report = ContentPublisher(
        store, approval_source=_approving(fingerprint), ng_checker=lambda text: False
    ).publish(bundle)
    if report.outcome != "published":
        failing = [
            c for c in report.checks if c.status not in ("PASS", "NOT_APPLICABLE")
        ]
        raise AssertionError(f"v{version} was not published: {failing}")
    return fingerprint


async def _answer(play_session_id: str, store: PinnedContentStore, value: str) -> str:
    async with AsyncSessionLocal() as db:
        row = await db.get(PlaySession, play_session_id)
        bundle = resolve_session_content(row, store)
        await db.rollback()
        result = await process_interaction(
            db,
            play_session_id,
            SubmitAnswerInteraction(
                client_event_id=str(uuid.uuid4()),
                interaction_type="submit_answer",
                target_id="PUZZLE_A",
                zone_id=ZONE_ID,
                payload=SubmitAnswerPayload(answer=value),
            ),
            runtime_loader=bundle.runtime_loader(),
            client_content_loader=bundle.client_content_loader(),
        )
    return result.result.result_type


async def _cleanup(anonymous_session_id: str, case_id: str) -> None:
    # 이 실행만 쓰는 case_id로 지운다(세션 ID를 받기 전에 실패해도 남지 않는다).
    async with AsyncSessionLocal() as db:
        session_ids = select(PlaySession.id).where(PlaySession.case_id == case_id)
        await db.execute(
            delete(InteractionEvent).where(
                InteractionEvent.play_session_id.in_(session_ids)
            )
        )
        await db.execute(delete(PlaySession).where(PlaySession.case_id == case_id))
        await db.execute(
            delete(AnonymousSession).where(AnonymousSession.id == anonymous_session_id)
        )
        await db.commit()


async def _verify() -> None:
    anonymous_session_id = str(uuid.uuid4())
    case_id = f"publish-verification-{uuid.uuid4().hex[:12]}"
    store = PinnedContentStore()

    try:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        async with AsyncSessionLocal() as db:
            db.add(
                AnonymousSession(
                    id=anonymous_session_id,
                    created_at=now,
                    expires_at=now + timedelta(hours=1),
                )
            )
            await db.commit()

        # 1. 승인된 v1을 게시하고, 그 버전으로 세션을 만들면 행에 버전 · fingerprint가 저장된다
        fp1 = _publish(store, case_id, 1, "first")
        async with AsyncSessionLocal() as db:
            created = await create_play_session(
                db=db,
                anonymous_session_id=anonymous_session_id,
                case_id=case_id,
                pinned_content=store.get_version(case_id, 1),
            )
        async with AsyncSessionLocal() as db:
            row = (
                await db.execute(
                    select(
                        PlaySession.content_version, PlaySession.content_fingerprint
                    ).where(PlaySession.id == created.id)
                )
            ).one()
        if (row.content_version, row.content_fingerprint) != (1, fp1):
            raise AssertionError("Session row did not store the published pin.")
        print("[OK] A session created from published v1 stored its version pin.")

        # 2. v2를 게시한 뒤에도 v1 세션은 v1 콘텐츠로만 판정한다
        _publish(store, case_id, 2, "second")
        results = [
            await _answer(created.id, store, value) for value in ("second", "first")
        ]
        if results != ["incorrect", "correct"]:
            raise AssertionError(f"Pinned session answers {results}")
        print("[OK] The v1 session kept v1 content after v2 was published.")
    finally:
        await _cleanup(anonymous_session_id, case_id)
        print("[OK] Verification rows were cleaned up.")


async def _run() -> None:
    try:
        await _verify()
    finally:
        await engine.dispose()


def main() -> int:
    try:
        asyncio.run(_run())
    except Exception as error:
        print(f"[FAIL] {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
