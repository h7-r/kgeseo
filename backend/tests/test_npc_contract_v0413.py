"""PM v0.4.13: 대상별 필수 관문 · 일반 팩 정책 검사(fail closed) · actor/reviewer 분리 · content_mode.

승인 기록 · 검토자 이름은 가상 데이터다(테스트용 기록이며 실제 승인이 아니다). 단, CLI의 관문별 기록 가능자
검사는 PM v0.4.13 §2 표(실명)를 그대로 시험한다.
"""

import asyncio
import uuid

import pytest

from app.api.v1.npc import get_general_pack_policy
from app.main import app
from app.schemas.gate_review import GateReviewCreate
from app.services.approval_history import (
    REQUIRED_GATES,
    ApprovalLog,
    ReviewRecord,
    gate_decisions,
)
from app.services.dialogue_pack_policy import (
    DEFAULT_DIALOGUE_PACK_POLICY,
    PackPolicyResult,
    run_dialogue_pack_policy,
)
from app.services.gate_review import (
    AdminAuthenticationRequired,
    DelegatedReviewInputError,
    InternalCliOperator,
    VerifiedAdmin,
    create_gate_review,
    record_delegated_gate_review,
)
from app.services.npc_general_pack import GeneralPackAccess, load_general_pack
from app.services.npc_line_supply import (
    general_pack_approved,
    general_pack_fingerprint,
    general_pack_gate_reasons,
    select_pause_line,
)
from app.services.pinned_content import ContentPin, PinnedContent, PinnedContentStore
from scripts import record_gate_review as cli
from tests.pack_policy_stub import passing_test_policy
from tests.test_npc_case_access import (  # noqa: F401  (pytest fixture)
    BLOCKED,
    Reader,
    approved_access,
    reader_override,  # noqa: F811
)
from tests.test_npc_general_pack import (  # noqa: F401  (pytest fixture)
    OFFICIAL,
    OFFICIAL_FINGERPRINT,
    db_pack,
)
from tests.test_npc_turn import FP, make_client, runtime_with_hints
from tests.test_npc_turn_http import (  # noqa: F401  (pytest fixture)
    URL,
    body,
    overrides,
    session_row,
    stored,
)

PACK_KEY = ("general_default", 1)
PM_G3_REASON = "PM 11/3 메시지로 G3 승인"


def review(gate: str, *, fp: str = OFFICIAL_FINGERPRINT, **extra) -> ReviewRecord:
    return ReviewRecord(
        **(
            {
                "review_id": str(uuid.uuid4()),
                "gate": gate,
                "target_hash": fp,
                "decision": "approved",
                "reviewer": "가상 검토자",
                "reviewed_at": "2026-11-03T00:00:00.000Z",
            }
            | extra
        )
    )


def log_with(*records: ReviewRecord, key=PACK_KEY) -> ApprovalLog:
    log = ApprovalLog()
    for record in records:
        log.append(*key, record)
    return log


@pytest.fixture
def official():
    return load_general_pack(OFFICIAL)


def failing_policy(pack):
    return PackPolicyResult("FAIL", "test_only_fail")


def raising_policy(pack):
    raise RuntimeError("boom")


# ── 1. 대상 종류별 필수 관문 ──


def test_required_gates_per_target_type() -> None:
    assert REQUIRED_GATES == {
        "case_content": ("G1", "G2", "G3"),
        "dialogue_pack": ("G3",),
    }


def test_case_content_still_needs_g1_g2_g3() -> None:
    fp = "sha256:" + "c" * 64
    only_g3 = [review("G3", fp=fp)]
    assert gate_decisions(only_g3, fp) == ("G1:missing", "G2:missing")
    assert gate_decisions(
        only_g3, fp, required=REQUIRED_GATES["case_content"]
    ) == gate_decisions(only_g3, fp)
    assert gate_decisions([review(g, fp=fp) for g in ("G1", "G2", "G3")], fp) == ()


def test_dialogue_pack_needs_only_g3_and_ignores_non_applicable_gates() -> None:
    required = REQUIRED_GATES["dialogue_pack"]
    fp = OFFICIAL_FINGERPRINT
    assert gate_decisions([review("G3")], fp, required=required) == ()
    # G1 · G2는 일반 팩의 판정 대상이 아니다(기록이 있어도 판정에 쓰지 않는다).
    rejected_g1 = review("G1", decision="rejected", reason="(가상)")
    assert gate_decisions([rejected_g1, review("G3")], fp, required=required) == ()
    assert gate_decisions([review("G1"), review("G2")], fp, required=required) == (
        "G3:missing",
    )


@pytest.mark.parametrize("required", [(), ("G4",)])
def test_invalid_required_gates_fail_closed(required) -> None:
    assert gate_decisions([review("G3")], OFFICIAL_FINGERPRINT, required=required) == (
        "invalid required gates",
    )


# ── 2. 일반 팩: G3 판정과 정책 검사는 따로, 둘 다 통과해야 사용 ──


def test_g3_only_pack_approval_is_recorded_but_unusable_while_policy_unverified(
    official,
) -> None:
    source = log_with(review("G3")).source()
    assert general_pack_gate_reasons(official, source) == ()  # G3 승인 자체는 성립
    # 게시 케이스를 넘기지 않은 기본 검사: GEN-LEAK · GEN-CASE를 판정할 수 없다(PM v0.4.14, fail closed)
    policy = run_dialogue_pack_policy(DEFAULT_DIALOGUE_PACK_POLICY, official)
    assert policy.status == "UNVERIFIED"
    assert (policy.check("GEN-LEAK"), policy.check("GEN-CASE")) == (
        "UNVERIFIED",
        "UNVERIFIED",
    )
    assert general_pack_approved(official, source) is False
    assert select_pause_line(official, source, "event-1") is None


def test_g3_only_pack_is_usable_when_the_policy_passes(official) -> None:
    source = log_with(review("G3")).source()
    assert general_pack_approved(official, source, passing_test_policy) is True
    line = select_pause_line(official, source, "event-1", passing_test_policy)
    assert line is not None and line.line_id.startswith("GENERIC_PAUSE_")


@pytest.mark.parametrize("policy", [failing_policy, raising_policy, lambda p: "PASS"])
def test_policy_fail_error_or_bad_result_blocks_the_pack(official, policy) -> None:
    source = log_with(review("G3")).source()
    assert run_dialogue_pack_policy(policy, official).passed is False
    assert general_pack_approved(official, source, policy) is False


def test_g3_withdrawal_blocks_the_pack_even_when_the_policy_passes(official) -> None:
    first = review("G3")
    hold = review(
        "G3",
        decision="hold",
        reason="(가상) 철회",
        supersedes=first.review_id,
        reviewed_at="2026-11-03T00:00:01.000Z",
    )
    source = log_with(first, hold).source()
    assert general_pack_gate_reasons(official, source) == ("G3:hold",)
    assert general_pack_approved(official, source, passing_test_policy) is False


def test_g3_for_another_fingerprint_does_not_count(official) -> None:
    stale = review("G3", fp="sha256:" + "0" * 64)
    source = log_with(stale).source()
    assert general_pack_gate_reasons(official, source) == ("G3:stale target_hash",)
    assert general_pack_approved(official, source, passing_test_policy) is False


def test_existing_g1_g2_g3_test_history_still_approves_g3(official) -> None:
    # 기존 테스트 · 대역의 G1~G3 기록은 그대로 둔다. G3가 있으므로 관문 판정은 성립한다.
    source = log_with(*(review(g) for g in ("G1", "G2", "G3"))).source()
    assert general_pack_gate_reasons(official, source) == ()
    assert general_pack_approved(official, source) is False  # 정책 검사 미정
    assert general_pack_approved(official, source, passing_test_policy) is True


# ── 2-1. HTTP: 긴급 중단 + G3만 승인된 공식 팩 ──


def g3_access(pack) -> GeneralPackAccess:
    return GeneralPackAccess(log_with(review("G3")).source(), basis=("g3",))


def test_http_blocked_turn_keeps_reply_null_while_policy_undefined(
    client,
    db_session,
    reader_override,  # noqa: F811
    db_pack,  # noqa: F811
) -> None:
    db_pack["access"] = g3_access(db_pack["pack"])
    reader_override(Reader(BLOCKED))
    db_session.get_result = session_row()
    # 운영 기본값(정책 검사 기준 미정)으로 되돌린다.
    app.dependency_overrides[get_general_pack_policy] = lambda: (
        DEFAULT_DIALOGUE_PACK_POLICY
    )

    response = client.post(URL, json=body())

    assert response.status_code == 200
    data = response.json()
    assert data["reply"] is None
    assert data["suggest_hint"] is None
    assert (data["fallback_reason"], data["content_mode"]) == (
        "NPC_CONTENT_WITHDRAWN",
        "generic",
    )


def test_http_blocked_turn_uses_g3_only_pack_when_policy_passes(
    client,
    db_session,
    reader_override,  # noqa: F811
    db_pack,  # noqa: F811
) -> None:
    db_pack["access"] = g3_access(db_pack["pack"])
    reader_override(Reader(BLOCKED))
    db_session.get_result = session_row()

    first = client.post(URL, json=body()).json()
    expected = select_pause_line(
        db_pack["pack"],
        g3_access(db_pack["pack"]).approval_source,
        body()["client_event_id"],
        passing_test_policy,
    )
    assert first["reply"]["line_id"] == expected.line_id
    assert first["reply"]["text"] == expected.text
    assert (first["fallback_reason"], first["content_mode"]) == (
        "NPC_CONTENT_WITHDRAWN",
        "generic",
    )

    # 같은 client_event_id 재전송 → 같은 일반 대사(결정적), 새 이벤트 없음
    db_session.scalar_result = stored(db_session)
    db_session.added.clear()
    again = client.post(URL, json=body()).json()
    assert db_session.added == []
    assert again == first


def test_router_pack_policy_is_fail_closed_when_published_cases_unreadable(
    official,
) -> None:
    from app.api.v1 import npc as npc_api
    from app.services.pinned_content import PinnedContentStore

    class BrokenDb:
        async def execute(self, *args, **kwargs):
            raise RuntimeError("db down")

        async def rollback(self):
            return None

    policy = asyncio.run(
        npc_api.get_general_pack_policy(BrokenDb(), PinnedContentStore())
    )
    result = run_dialogue_pack_policy(policy, official)
    assert result.status == "UNVERIFIED"
    assert result.check("GEN-LEAK") == "UNVERIFIED"


# ── 3. content_mode ──


def test_http_normal_case_response_is_case(
    client,
    db_session,
    reader_override,  # noqa: F811
    overrides,  # noqa: F811
) -> None:
    reader_override(Reader(approved_access()))
    db_session.get_result = session_row()

    data = client.post(URL, json=body()).json()

    assert data["reply"] is not None
    assert (data["fallback_reason"], data["content_mode"]) == (None, "case")


def test_http_missing_npc_content_is_generic_with_reason(
    client,
    db_session,
    reader_override,  # noqa: F811
    overrides,  # noqa: F811
) -> None:
    # 기존 저장소 대신 npc.json 없는 묶음만 둔다(게시 경로로는 만들 수 없는 묶음)
    store = PinnedContentStore()
    store.add(
        PinnedContent(
            ContentPin("case_test", 1, FP),
            client=make_client(),
            server=runtime_with_hints(),
            npc=None,
            idmap=None,
        )
    )
    overrides["store"] = store
    reader_override(Reader(approved_access()))
    db_session.get_result = session_row()

    first = client.post(URL, json=body()).json()

    assert (first["fallback_reason"], first["content_mode"]) == (
        "NPC_CONTENT_MISSING",
        "generic",
    )
    assert stored(db_session).response_json["fallback_reason"] == "NPC_CONTENT_MISSING"

    db_session.scalar_result = stored(db_session)
    db_session.added.clear()
    again = client.post(URL, json=body()).json()
    assert again == first


def test_http_legacy_session_stays_409(client, db_session, overrides) -> None:  # noqa: F811
    # 케이스 자체 버전을 못 쓰는 경우는 기존 계약대로 HTTP 오류다(200 generic으로 바꾸지 않는다).
    db_session.get_result = session_row(version=None, fingerprint=None)

    response = client.post(URL, json=body())

    assert response.status_code == 409
    assert response.json() == {"detail": "CASE_VERSION_UNAVAILABLE"}


def test_openapi_content_mode_and_fallback_reason_values() -> None:
    schema = app.openapi()["components"]["schemas"]["NpcTurnResponse"]
    assert "content_mode" in schema["required"]
    assert schema["properties"]["content_mode"]["enum"] == ["case", "generic"]
    reasons = schema["properties"]["fallback_reason"]["anyOf"][0]["enum"]
    assert reasons == [
        "NPC_GENERIC_PACK_MISSING",
        "NPC_CONTENT_WITHDRAWN",
        "NPC_CONTENT_MISSING",
        "NPC_CONTENT_VERSION_MISMATCH",
        "NPC_CONTENT_INVALID",
    ]


# ── 4. actor / reviewer 분리 ──


def test_record_actor_is_optional_for_existing_history_and_validated() -> None:
    assert review("G3").actor is None
    assert review("G3", actor="가상 실행자").actor == "가상 실행자"
    for bad in ("", "  ", " 가상", "x" * 101):
        with pytest.raises(ValueError):
            review("G3", actor=bad)


def test_actor_does_not_change_gate_decisions() -> None:
    fp = OFFICIAL_FINGERPRINT
    required = REQUIRED_GATES["dialogue_pack"]
    assert (
        gate_decisions([review("G3", actor="가상 실행자")], fp, required=required) == ()
    )


class RecordingDb:
    """`_record_review` 경로 대역: 잠금 · 조회 · 추가를 흉내 낸다(MySQL 판정은 _mysql 테스트)."""

    def __init__(self) -> None:
        self.records: list[ReviewRecord] = []
        self.commits = 0
        self.rollbacks = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1


@pytest.fixture
def recording_repository(monkeypatch):
    from app.services import gate_review

    appended: list[ReviewRecord] = []

    class FakeRepository:
        def __init__(self, db) -> None:
            pass

        async def lock_target(self, target) -> None:
            return None

        async def records(self, target, *, current=False):
            return tuple(appended)

        async def append(self, target, record) -> None:
            appended.append(record)

    monkeypatch.setattr(gate_review, "ApprovalHistoryRepository", FakeRepository)
    return appended


def pack_request(**extra) -> GateReviewCreate:
    return GateReviewCreate(
        **(
            {
                "target_type": "dialogue_pack",
                "target_id": "general_default",
                "content_version": 1,
                "gate": "G3",
                "target_hash": OFFICIAL_FINGERPRINT,
                "decision": "approved",
                "reason": "(가상) 근거",
            }
            | extra
        )
    )


def test_delegated_review_records_actor_and_reviewer_separately(
    recording_repository,
) -> None:
    record = asyncio.run(
        record_delegated_gate_review(
            RecordingDb(),
            pack_request(),
            operator=InternalCliOperator(actor="가상 실행자"),
            reviewer="가상 판정자",
        )
    )
    assert (record.actor, record.reviewer) == ("가상 실행자", "가상 판정자")
    assert recording_repository == [record]


def test_verified_admin_path_records_the_same_person_as_actor(
    recording_repository,
) -> None:
    record = asyncio.run(
        create_gate_review(
            RecordingDb(), pack_request(), admin=VerifiedAdmin(reviewer="가상 관리자")
        )
    )
    assert (record.actor, record.reviewer) == ("가상 관리자", "가상 관리자")


@pytest.mark.parametrize(
    ("operator", "reviewer", "request_extra", "error"),
    [
        (None, "가상 판정자", {}, AdminAuthenticationRequired),
        (
            "가상 실행자",
            "가상 판정자",
            {},
            AdminAuthenticationRequired,
        ),  # 문자열은 불가
        (InternalCliOperator(" "), "가상 판정자", {}, DelegatedReviewInputError),
        (InternalCliOperator("가상 실행자"), "", {}, DelegatedReviewInputError),
        (
            InternalCliOperator("가상 실행자"),
            "가상 판정자",
            {"reason": None},
            DelegatedReviewInputError,
        ),
    ],
)
def test_delegated_review_rejects_bad_input(
    recording_repository, operator, reviewer, request_extra, error
) -> None:
    with pytest.raises(error):
        asyncio.run(
            record_delegated_gate_review(
                RecordingDb(),
                pack_request(**request_extra),
                operator=operator,
                reviewer=reviewer,
            )
        )
    assert recording_repository == []


# ── 5. 내부 CLI(DB 없이: 입력 검사 · fingerprint 재계산) ──


def cli_args(*extra: str, **values: str) -> list[str]:
    base = {
        "--target-type": "dialogue_pack",
        "--target-id": "general_default",
        "--target-version": "1",
        "--gate": "G3",
        "--decision": "approved",
        "--actor": "세진",
        "--reviewer": "황미르",
        "--reason": PM_G3_REASON,
        "--target-hash": OFFICIAL_FINGERPRINT,
    }
    for key, value in values.items():
        base["--" + key.replace("_", "-")] = value
    return [item for pair in base.items() for item in pair] + list(extra)


def test_cli_dry_run_recomputes_the_fingerprint_without_db(capsys) -> None:
    assert cli.main(cli_args()) == 0
    out = capsys.readouterr().out
    assert f"target_hash={OFFICIAL_FINGERPRINT}" in out
    assert "actor=세진 reviewer=황미르" in out
    assert f"reason={PM_G3_REASON}" in out
    assert "mode=dry-run" in out


def test_official_pack_fingerprint_matches_the_pm_value(official) -> None:
    assert general_pack_fingerprint(official) == (
        "sha256:a625988f0187d724f97184733be0e8a8d1b936c950dfc35d84329c19cea086be"
    )


@pytest.mark.parametrize(
    ("values", "message"),
    [
        ({"target_hash": "sha256:" + "0" * 64}, "target_hash mismatch"),
        ({"gate": "G1", "reviewer": "박지하"}, "not a required gate"),
        ({"reviewer": "세진"}, "not allowed"),
        ({"reviewer": "가상 판정자"}, "not allowed"),
        ({"target_type": "unknown_kind"}, "unsupported target_type"),
        # 케이스 콘텐츠는 게시 루트의 묶음으로만 fingerprint를 계산한다(tests/test_case_publication_cli.py)
        ({"target_type": "case_content"}, "--content-root is required"),
        ({"content_root": "anything"}, "--content-root is only for case_content"),
        ({"target_version": "2"}, "pack not loadable"),
        ({"actor": " "}, "actor"),
        ({"reason": " "}, "reason"),
    ],
)
def test_cli_rejects_invalid_input(capsys, values, message) -> None:
    assert cli.main(cli_args(**values)) == 1
    assert message in capsys.readouterr().out


def test_cli_commit_requires_matching_confirm_db() -> None:
    args = cli.parse_args(cli_args("--commit", "--confirm-db", "other_db"))

    class NeverOpened:
        def __call__(self):
            raise AssertionError("must not connect")

    with pytest.raises(cli.CliInputError, match="confirm-db"):
        asyncio.run(cli.run(args, NeverOpened(), "configured_db", out=lambda *_: None))


def test_cli_reviewer_table_follows_pm_v0413() -> None:
    assert cli.GATE_REVIEWERS == {
        "G1": ("박지하", "황미르"),
        "G2": ("이해랑", "황미르"),
        "G3": ("황미르",),
    }
