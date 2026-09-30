import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.models.anonymous_session import AnonymousSession
from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.services import case_content


def _write_client_content(directory: Path, case_id: str) -> None:
    content = {
        "case_id": case_id,
        "entry_zone_id": "ZONE_ENTRY",
        "zones": [
            {
                "zone_id": "ZONE_FIRST",
                "zone_name": "First",
                "zone_type": "room",
                "description": "First zone",
                "objects": [],
                "navigation": [],
            },
            {
                "zone_id": "ZONE_ENTRY",
                "zone_name": "Entry",
                "zone_type": "room",
                "description": "Entry zone",
                "objects": [],
                "navigation": [],
            },
        ],
    }
    (directory / f"{case_id}.client.json").write_text(
        json.dumps(content),
        encoding="utf-8",
    )


async def _prepare_anonymous_session(anonymous_session_id: str) -> None:
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


async def _cleanup_rows(
    anonymous_session_id: str,
    play_session_id: str | None,
) -> None:
    async with AsyncSessionLocal() as db:
        if play_session_id is not None:
            await db.execute(
                delete(InteractionEvent).where(
                    InteractionEvent.play_session_id == play_session_id
                )
            )
            await db.execute(
                delete(PlaySession).where(PlaySession.id == play_session_id)
            )
        await db.execute(
            delete(AnonymousSession).where(AnonymousSession.id == anonymous_session_id)
        )
        await db.commit()


async def _verify() -> None:
    anonymous_session_id = str(uuid4())
    case_id = f"entry-zone-verification-{uuid4()}"
    play_session_id: str | None = None
    original_cases_directory = case_content.CASES_DIRECTORY

    try:
        with TemporaryDirectory() as temporary_directory:
            cases_directory = Path(temporary_directory)
            _write_client_content(cases_directory, case_id)
            case_content.CASES_DIRECTORY = cases_directory
            await _prepare_anonymous_session(anonymous_session_id)

            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                create_response = await client.post(
                    "/api/v1/play-sessions",
                    json={
                        "anonymous_session_id": anonymous_session_id,
                        "case_id": case_id,
                    },
                )
                if create_response.status_code != 201:
                    raise AssertionError(
                        "PlaySession POST failed: "
                        f"{create_response.status_code} {create_response.text}"
                    )

                create_data = create_response.json()["data"]
                play_session_id = create_data["play_session_id"]
                if create_data["state"]["current_zone_id"] != "ZONE_ENTRY":
                    raise AssertionError(
                        "POST did not return the configured Entry Zone."
                    )

                get_response = await client.get(
                    f"/api/v1/play-sessions/{play_session_id}"
                )
                if get_response.status_code != 200:
                    raise AssertionError(
                        "PlaySession GET failed: "
                        f"{get_response.status_code} {get_response.text}"
                    )
                if (
                    get_response.json()["data"]["state"]["current_zone_id"]
                    != "ZONE_ENTRY"
                ):
                    raise AssertionError("GET did not return the stored Entry Zone.")

            async with AsyncSessionLocal() as verification_db:
                play_session = await verification_db.get(
                    PlaySession,
                    play_session_id,
                )
                if play_session is None:
                    raise AssertionError("Created PlaySession was not found in MySQL.")
                if play_session.state_json.get("current_zone_id") != "ZONE_ENTRY":
                    raise AssertionError(
                        "MySQL state_json did not store the configured Entry Zone."
                    )

        print("[OK] POST initialized current_zone_id from entry_zone_id.")
        print("[OK] MySQL state_json stored current_zone_id.")
        print("[OK] GET returned the stored current_zone_id.")
    finally:
        case_content.CASES_DIRECTORY = original_cases_directory
        await _cleanup_rows(anonymous_session_id, play_session_id)
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
