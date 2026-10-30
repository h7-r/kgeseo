"""PUB-GATE 넛지 작성 범위(PM v0.4.7): 넛지 없는 퍼즐은 차단하지 않고 경고로 남긴다."""

from app.services.publication_gate import NON_BLOCKING_STATUSES
from tests.test_publication_gate import base_documents, run, seal


def sealed(documents):
    del documents["idmap"]
    files, fingerprint = seal(documents)
    return {**files, "idmap": None}, fingerprint


def test_every_puzzle_with_nudges_passes_coverage() -> None:
    files, fingerprint = sealed(base_documents())

    result, _ = run(files, fingerprint)

    assert result.check("NUDGE_COVERAGE").status == "PASS"
    assert result.approved is True


def test_puzzle_without_nudges_is_a_warning_not_a_block() -> None:
    documents = base_documents()
    documents["npc"]["puzzles"] = []  # PUZZLE_A에 넛지를 작성하지 않음
    files, fingerprint = sealed(documents)

    result, store = run(files, fingerprint)

    coverage = result.check("NUDGE_COVERAGE")
    assert (coverage.status, coverage.reasons) == ("WARN", ("PUZZLE_A",))
    # 경고는 게시를 막지 않는다. 이유에는 퍼즐 ID만 있고 원문 · 정답은 없다.
    assert result.approved is True and result.registered is True
    assert "WARN" in NON_BLOCKING_STATUSES
    assert all("(가상)" not in reason for reason in coverage.reasons)


def test_warning_does_not_hide_real_failures() -> None:
    documents = base_documents()
    documents["npc"]["puzzles"] = []
    files, fingerprint = sealed(documents)

    result, _ = run(files, None)  # 신뢰할 수 있는 승인 없음

    assert result.check("NUDGE_COVERAGE").status == "WARN"
    assert result.check("APPROVALS").status == "FAIL"
    assert result.approved is False
