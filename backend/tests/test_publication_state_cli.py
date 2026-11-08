"""게시 상태 관리 CLI(scripts.publication_state) — DB 없이 입력 검사 · 계획/실행 · 오류 매핑을 본다.

실제 상태 전이 · 신규/진행 중 회차 영향은 `tests/test_publication_state_cli_mysql.py`가 격리 MySQL로 본다.
"""

import asyncio
from datetime import datetime

import pytest

from app.repositories.npc_publication import PublicationEventRecord, PublicationSnapshot
from app.repositories.npc_turn_idempotency import WithdrawalCounts
from app.services.npc_publication import (
    BlockedReapprovalRequiredError,
    BlockResult,
    PublicationStateConflictError,
    PublicationStateNotFoundError,
    PublicationTransitionError,
)
from scripts import publication_state as cli
from scripts.publish_case_content import CliInputError

FP = "sha256:" + "a" * 64
OTHER_FP = "sha256:" + "b" * 64
NOW = datetime(2026, 11, 9, 3, 0, 0)
DB = "test_db"


def snap(status: str, fingerprint: str = FP) -> PublicationSnapshot:
    return PublicationSnapshot("case_x", 1, fingerprint, status, 2, NOW)


class FakeService:
    def __init__(self, state: PublicationSnapshot | None) -> None:
        self.state = state
        self.calls: list[tuple] = []
        self.error: Exception | None = None

    async def current(self, case_id, version):
        return self.state

    async def events(self, case_id, version):
        return (
            PublicationEventRecord(
                "case_x", 1, None, "published", "(가상)", "op", NOW, 1
            ),
        )

    def _act(self, name, to_status, **kw):
        self.calls.append((name, kw))
        if self.error:
            raise self.error
        self.state = snap(to_status)
        return self.state

    async def suspend(self, case_id, version, *, reason, actor):
        return self._act("suspend", "suspended", reason=reason, actor=actor)

    async def block(self, case_id, version, *, reason, actor, expected_status=None):
        final = self._act("block", "blocked", expected_status=expected_status)
        return BlockResult(final, WithdrawalCounts(2, 1), True)


def argv(action, *extra, fingerprint=FP):
    base = [action, "--case-id", "case_x", "--content-version", "1"]
    if action != "status":
        base += [
            "--expect-fingerprint",
            fingerprint,
            "--actor",
            "op",
            "--reason",
            "(가상) 근거",
        ]
    return base + list(extra)


def run(service, *args, root=""):
    lines: list[str] = []
    code = asyncio.run(
        cli.run(
            cli.parse_args(list(args)),
            None,
            DB,
            root,
            out=lines.append,
            service=service,
        )
    )
    return code, lines


COMMIT = ("--commit", "--confirm-db", DB)


def test_status_prints_target_fingerprint_state_and_history_only():
    code, lines = run(FakeService(snap("published")), *argv("status"))
    assert code == cli.EXIT_OK
    assert lines[1] == (
        f"target=case_x@v1 status=published content_fingerprint={FP} "
        f"revision=2 updated_at={NOW.isoformat()}"
    )
    assert lines[2].startswith("  event rev=1 -->published")


def test_status_refuses_commit():
    with pytest.raises(CliInputError):
        run(FakeService(snap("published")), *argv("status", "--commit"))


@pytest.mark.parametrize(
    "extra",
    [
        ["--expect-fingerprint", "sha256:XYZ"],
        ["--expect-fingerprint", "md5:" + "a" * 64],
    ],
)
def test_change_needs_a_well_formed_fingerprint(extra):
    args = ["suspend", "--case-id", "case_x", "--content-version", "1", *extra]
    with pytest.raises(CliInputError):
        run(FakeService(snap("published")), *args, "--actor", "op", "--reason", "r")


@pytest.mark.parametrize("missing", ["--actor", "--reason"])
def test_change_needs_actor_and_reason(missing):
    args = argv("suspend")
    index = args.index(missing)
    args[index + 1] = " "
    with pytest.raises(CliInputError):
        run(FakeService(snap("published")), *args)


def test_commit_needs_matching_database_name():
    service = FakeService(snap("published"))
    with pytest.raises(CliInputError):
        run(service, *argv("suspend", "--commit"))
    with pytest.raises(CliInputError):
        run(service, *argv("suspend", "--commit", "--confirm-db", "prod"))
    assert service.calls == []


def test_resume_needs_the_configured_content_root():
    with pytest.raises(CliInputError):
        run(FakeService(snap("suspended")), *argv("resume", *COMMIT))
    with pytest.raises(CliInputError):
        run(
            FakeService(snap("suspended")),
            *argv("resume", "--content-root", "/other", *COMMIT),
            root="/published",
        )


@pytest.mark.parametrize("case_id", ["../x", "a b", ""])
def test_invalid_case_id_is_refused(case_id):
    args = argv("status")
    args[2] = case_id
    with pytest.raises(CliInputError):
        run(FakeService(None), *args)


def test_plan_mode_never_changes_state():
    service = FakeService(snap("published"))
    code, lines = run(service, *argv("suspend"))
    assert code == cli.EXIT_OK
    assert "plan: published -> suspended" in lines and service.calls == []


def test_missing_target_and_fingerprint_mismatch_are_refused():
    code, lines = run(FakeService(None), *argv("block", *COMMIT))
    assert (
        code == cli.EXIT_INPUT and "refused: target has no publication state" in lines
    )
    service = FakeService(snap("published"))
    code, lines = run(service, *argv("block", *COMMIT, fingerprint=OTHER_FP))
    assert code == cli.EXIT_CONFLICT and service.calls == []


@pytest.mark.parametrize(
    ("action", "status"),
    [("suspend", "suspended"), ("block", "blocked"), ("resume", "published")],
)
def test_same_state_is_unchanged_without_calling_the_service(action, status):
    service = FakeService(snap(status))
    extra = ["--content-root", "/r"] if action == "resume" else []
    code, lines = run(service, *argv(action, *extra, *COMMIT), root="/r")
    assert code == cli.EXIT_OK
    assert f"result=unchanged (already {status})" in lines
    assert service.calls == []


@pytest.mark.parametrize(
    ("action", "status"),
    [("suspend", "blocked"), ("resume", "none-like")],
)
def test_disallowed_transitions_are_refused(action, status):
    service = FakeService(snap("blocked") if action == "suspend" else snap("unknown"))
    extra = ["--content-root", "/r"] if action == "resume" else []
    code, lines = run(service, *argv(action, *extra, *COMMIT), root="/r")
    assert code == cli.EXIT_CONFLICT and service.calls == []


def test_block_passes_the_observed_status_for_an_atomic_check():
    service = FakeService(snap("suspended"))
    code, lines = run(service, *argv("block", *COMMIT))
    assert code == cli.EXIT_OK
    assert service.calls == [("block", {"expected_status": "suspended"})]
    assert "withdrawn bodies_deleted=2 processing_fenced=1" in lines
    assert "result=changed status=blocked revision=2" in lines


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (PublicationTransitionError(), cli.EXIT_CONFLICT),
        (PublicationStateConflictError(), cli.EXIT_CONFLICT),
        (PublicationStateNotFoundError(), cli.EXIT_INPUT),
        (BlockedReapprovalRequiredError("G2"), cli.EXIT_BLOCKED),
    ],
)
def test_service_errors_map_to_exit_codes(error, code):
    service = FakeService(snap("published"))
    service.error = error
    result, lines = run(service, *argv("suspend", *COMMIT))
    assert result == code
    assert not any(line.startswith("result=changed") for line in lines)


def test_output_has_no_connection_details():
    _, lines = run(FakeService(snap("published")), *argv("suspend"))
    joined = "\n".join(lines).lower()
    for word in ("password", "mysql+", "@127.", "secret"):
        assert word not in joined
