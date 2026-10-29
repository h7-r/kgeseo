"""G1~G3 게시 승인 이력 v0.4.3."""

import uuid
from typing import Any

import pytest
from pydantic import ValidationError

from app.services.approval_history import (
    ApprovalLog,
    DuplicateReviewError,
    ReviewRecord,
    UnknownSupersedesError,
    gate_decisions,
)

# 가상 테스트 데이터. 실제 승인 기록이 아니다.
FP = "sha256:" + "a" * 64
OLD_FP = "sha256:" + "b" * 64


def rid() -> str:
    return str(uuid.uuid4())


def rec(gate="G1", decision="approved", *, fp=FP, at="2026-10-29T00:00:00.000Z", **kw):
    if decision != "approved":
        kw.setdefault("reason", "(가상) 사유")
    data: dict[str, Any] = {
        "review_id": rid(),
        "gate": gate,
        "target_hash": fp,
        "decision": decision,
        "reviewer": "reviewer-test",
        "reviewed_at": at,
    }
    return ReviewRecord(**(data | kw))


def all_approved(fp: str = FP) -> list[ReviewRecord]:
    return [rec(g, fp=fp) for g in ("G1", "G2", "G3")]


# --- 기록 형식 ---


def test_valid_record() -> None:
    record = rec()

    assert record.decision == "approved"
    assert record.reason is None


@pytest.mark.parametrize(
    "override",
    [
        {"review_id": "not-a-uuid"},
        {"review_id": str(uuid.uuid1())},  # v1
        {"review_id": str(uuid.uuid4()).upper()},  # 정규형 아님
        {"gate": "G4"},
        {"target_hash": "a" * 64},  # 접두어 없음
        {"target_hash": "sha256:" + "A" * 64},  # 대문자
        {"target_hash": "sha256:" + "a" * 63},
        {"decision": "approve"},
        {"reviewer": ""},
        {"reviewer": "   "},
        {"reviewer": "가" * 101},
        {"reviewed_at": "2026-10-29T00:00:00Z"},  # 밀리초 없음
        {"reviewed_at": "2026-10-29T00:00:00.000+09:00"},  # UTC 아님
        {"reviewed_at": "2026-13-29T00:00:00.000Z"},  # 없는 날짜
        {"reason": "  "},
        {"supersedes": "not-a-uuid"},
        {"extra_field": 1},
    ],
)
def test_invalid_records_are_rejected(override: dict) -> None:
    with pytest.raises(ValidationError):
        rec(**override)


@pytest.mark.parametrize("decision", ["revise", "escalate", "rejected", "hold"])
def test_non_approved_decision_requires_reason(decision: str) -> None:
    with pytest.raises(ValidationError):
        ReviewRecord(
            review_id=rid(),
            gate="G1",
            target_hash=FP,
            decision=decision,
            reviewer="reviewer-test",
            reviewed_at="2026-10-29T00:00:00.000Z",
        )


def test_reviewer_of_100_chars_is_allowed() -> None:
    assert rec(reviewer="가" * 100).reviewer == "가" * 100


# --- 판정 ---


def test_all_three_approved_passes() -> None:
    assert gate_decisions(all_approved(), FP) == ()


@pytest.mark.parametrize("decision", ["revise", "escalate", "rejected", "hold"])
def test_non_approved_final_decision_fails(decision: str) -> None:
    records = [rec("G1"), rec("G2", decision), rec("G3")]

    assert gate_decisions(records, FP) == (f"G2:{decision}",)


def test_missing_and_stale_gates() -> None:
    records = [rec("G1"), rec("G2", fp=OLD_FP)]

    assert gate_decisions(records, FP) == ("G2:stale target_hash", "G3:missing")


def test_latest_by_reviewed_at_wins() -> None:
    first = rec("G2", "hold", at="2026-10-29T00:00:00.000Z")
    approval = rec(
        "G2",
        at="2026-10-29T00:00:00.001Z",
        reason="(가상) 보완 확인",
        supersedes=first.review_id,
    )
    records = [rec("G1"), approval, first, rec("G3")]  # 입력 순서와 무관

    assert gate_decisions(records, FP) == ()


def test_same_reviewed_at_is_ordered_by_review_id() -> None:
    at = "2026-10-29T00:00:00.000Z"
    low, high = sorted([rid(), rid()])
    first = rec("G2", "hold", at=at, review_id=low)
    last = rec("G2", at=at, review_id=high, reason="(가상) 재승인", supersedes=low)

    assert gate_decisions([rec("G1"), first, last, rec("G3")], FP) == ()


def test_reapproval_without_reason_is_invalid_history() -> None:
    first = rec("G2", "rejected")
    again = rec("G2", at="2026-10-29T01:00:00.000Z", supersedes=first.review_id)

    assert gate_decisions([rec("G1"), first, again, rec("G3")], FP) == (
        "G2:invalid history",
    )


def test_reapproval_without_supersedes_is_invalid_history() -> None:
    first = rec("G2", "rejected")
    again = rec("G2", at="2026-10-29T01:00:00.000Z", reason="(가상) 재검토")

    assert gate_decisions([rec("G1"), first, again, rec("G3")], FP) == (
        "G2:invalid history",
    )


def test_supersedes_must_point_to_previous_record() -> None:
    first = rec("G2", "hold")
    second = rec("G2", "revise", at="2026-10-29T01:00:00.000Z")
    wrong = rec(
        "G2",
        at="2026-10-29T02:00:00.000Z",
        reason="(가상) 재승인",
        supersedes=first.review_id,  # 직전은 second
    )

    assert gate_decisions([rec("G1"), first, second, wrong, rec("G3")], FP) == (
        "G2:invalid history",
    )


def test_first_record_may_supersede_record_of_previous_content() -> None:
    old = rec("G1", fp=OLD_FP)
    new = rec("G1", supersedes=old.review_id)
    records = [old, new, rec("G2"), rec("G3")]

    assert gate_decisions(records, FP) == ()
    unknown = rec("G1", supersedes=rid())
    assert gate_decisions([unknown, rec("G2"), rec("G3")], FP) == (
        "G1:invalid history",
    )


def test_duplicate_review_id_fails() -> None:
    first = rec("G1")
    copy = rec("G2", review_id=first.review_id)

    assert gate_decisions([first, copy, rec("G3")], FP) == ("duplicate review_id",)


def test_legacy_or_foreign_objects_are_not_converted() -> None:
    legacy = {"gate": "G1", "decision": "approved", "target_hash": FP}

    assert gate_decisions([*all_approved(), legacy], FP) == (
        "incompatible approval record",
    )


def test_result_has_no_hash_or_reviewer() -> None:
    reasons = gate_decisions([rec("G1", "rejected", reason="(가상) 비공개 사유")], FP)

    assert all("sha256" not in r and "reviewer" not in r for r in reasons)
    assert all("비공개 사유" not in r for r in reasons)


# --- append-only ---


def test_log_is_append_only() -> None:
    log = ApprovalLog()
    first = rec("G1", "hold")
    log.append("case_test", 1, first)
    log.append(
        "case_test",
        1,
        rec(
            "G1",
            at="2026-10-29T01:00:00.000Z",
            reason="(가상)",
            supersedes=first.review_id,
        ),
    )

    assert len(log.records("case_test", 1)) == 2
    assert log.records("case_test", 2) == ()
    assert not hasattr(log, "update") and not hasattr(log, "delete")
    assert not hasattr(log, "remove") and not hasattr(log, "clear")


def test_log_rejects_duplicate_ids_unknown_supersedes_and_foreign_objects() -> None:
    log = ApprovalLog()
    first = rec("G1")
    log.append("case_test", 1, first)

    with pytest.raises(DuplicateReviewError):
        log.append("case_test", 1, first)
    with pytest.raises(UnknownSupersedesError):
        log.append("case_test", 1, rec("G2", supersedes=rid()))
    with pytest.raises(TypeError):
        log.append("case_test", 1, {"gate": "G1"})  # type: ignore[arg-type]


def test_log_records_cannot_be_mutated() -> None:
    log = ApprovalLog()
    log.append("case_test", 1, rec("G1"))

    records = log.records("case_test", 1)
    with pytest.raises(ValidationError):
        records[0].decision = "rejected"  # type: ignore[misc]
    assert isinstance(records, tuple)


def test_log_source_feeds_gate_decisions() -> None:
    log = ApprovalLog()
    for record in all_approved():
        log.append("case_test", 1, record)

    assert gate_decisions(log.source()("case_test", 1), FP) == ()
