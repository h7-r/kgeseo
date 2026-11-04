"""v0.4.15 real publication/republication on explicitly isolated MySQL only."""

import os

import pytest

from app.core.config import settings
from app.services.npc_publication import (
    NpcPublicationService,
    PublicationGateFailedError,
)
from app.services.pinned_content import PinnedContentStore
from tests.test_content_publication import documents
from tests.test_content_release_mysql import approve, mysql_run, release
from tests.test_publication_gate import CASE_ID, seal

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)


def write(root, version, field=None):
    docs = documents(version)
    if field:
        del docs["npc"][field]
    files, fingerprint = seal(docs)
    directory = root / CASE_ID / f"v{version}"
    directory.mkdir(parents=True, exist_ok=True)
    for role, raw in files.items():
        (directory / f"{role}.json").write_bytes(raw)
    return fingerprint


@pytest.mark.parametrize("field", ["proper_nouns", "ng"])
@pytest.mark.parametrize("version", [1, 2])
def test_missing_review_data_blocks_publication_and_republication(
    tmp_path, monkeypatch, field, version
):
    monkeypatch.setattr(settings, "npc_general_pack", "")
    first = write(tmp_path, 1) if version == 2 else None
    fingerprint = write(tmp_path, version, field)

    async def scenario(sessions):
        service = NpcPublicationService(sessions)
        store = PinnedContentStore()
        if first:
            await approve(sessions, 1, first)
            await release(service, store, tmp_path, version=1)
        await approve(sessions, version, fingerprint)
        with pytest.raises(PublicationGateFailedError) as caught:
            await release(service, store, tmp_path, version=version)
        assert caught.value.result.check("POLICY_DATA").status == "FAIL"
        assert await service.current(CASE_ID, version) is None
        assert store.versions(CASE_ID) == ((1,) if version == 2 else ())

    mysql_run(scenario)
