"""기존 이름 정책 점검(scripts.audit_existing_names) — 정책 로딩 확인 · 판정 분류 · 출력. DB 없이(가짜 행)."""

from collections import namedtuple
from datetime import datetime

import pytest

from app.services import nickname_policy as npol
from scripts import audit_existing_names as audit

Row = namedtuple("Row", "id nickname role is_test deleted_at display_name")
WHEN = datetime(2026, 11, 20)


def row(
    nickname, display_name=None, *, role="user", is_test=False, deleted=False, uid="u"
):
    return Row(uid, nickname, role, is_test, WHEN if deleted else None, display_name)


@pytest.fixture
def policy():
    return audit.load_policy_or_fail()


# ---------------------------------------------------------------- 공유 정책 확인


def test_shared_policy_loads_and_matches_the_running_judge(policy):
    e = policy.evidence
    assert e["file"] == "nickname-policy.json" and len(e["sha256"]) == 12
    assert (
        e["reserved_entries"] > 9 and e["forbidden_entries"] > 10
    )  # 내장 목록(9 · 10)보다 크다
    assert policy.shared_judge is npol.JUDGE


def test_missing_policy_file_stops_the_audit(monkeypatch, tmp_path):
    monkeypatch.setattr(npol, "POLICY_PATH", tmp_path / "nickname-policy.json")
    with pytest.raises(audit.PolicyUnavailable, match="missing or not a file"):
        audit.load_policy_or_fail()


@pytest.mark.parametrize("content", ["", "   ", "{bad", "[1,"])
def test_broken_policy_file_stops_the_audit(monkeypatch, tmp_path, content):
    broken = tmp_path / "nickname-policy.json"
    broken.write_text(content, encoding="utf-8")
    monkeypatch.setattr(npol, "POLICY_PATH", broken)
    with pytest.raises(audit.PolicyUnavailable, match="unreadable"):
        audit.load_policy_or_fail()


def test_running_fallback_judge_stops_the_audit(monkeypatch):
    # 파일은 멀쩡해도 돌고 있는 판정기가 내장 목록으로 만들어졌다면(파일 없이 기동한 서버) 점검하지 않는다
    monkeypatch.setattr(npol, "JUDGE", npol.Judge(npol._FALLBACK_POLICY))
    with pytest.raises(audit.PolicyUnavailable, match="fallback"):
        audit.load_policy_or_fail()


def test_policy_failure_exits_3_without_opening_the_database(
    monkeypatch, tmp_path, capsys
):
    import app.db.session as session_module

    def boom():
        raise AssertionError("DB must not be opened")

    monkeypatch.setattr(session_module, "AsyncSessionLocal", boom)
    monkeypatch.setattr(npol, "POLICY_PATH", tmp_path / "nickname-policy.json")
    assert audit.main([]) == audit.EXIT_POLICY
    out = capsys.readouterr().out
    assert (
        "Status: FAIL (nickname-policy.json missing or not a file)" in out
        and "Completed: FAIL" in out
    )
    assert str(tmp_path) not in out


@pytest.mark.parametrize(
    "argv",
    [["--batch-size", "0"], ["--batch-size", "5001"], ["--unknown"], ["--batch"]],
)
def test_bad_options_exit_2(argv):
    assert audit.main(argv) == audit.EXIT_USAGE


# ---------------------------------------------------------------- 판정 분류(실제 함수 재사용)


def audit_rows(policy, *rows):
    report = audit.Report()
    for r in rows:
        audit.audit_row(policy, report, r)
    return report


def test_nickname_classification_and_fallback_candidates(policy):
    report = audit_rows(
        policy,
        row("한서진"),  # 정상
        row("운영진"),  # 공유 정책에서만 예약어
        row("존나"),  # 공유 정책에서만 금칙어
        row("황보지은"),  # 옛 내장 목록이 잘못 막던 이름 — 지금은 정상
        row("조사_관"),  # 언더바 정상
        row("관리자"),  # 두 목록 모두 예약어 — 배포 누락과 무관
    )
    n = report.nicknames
    assert (n.scanned, n.valid, n.invalid) == (6, 3, 3)
    assert n.reasons["reserved"] == 2 and n.reasons["profanity"] == 1
    assert n.fallback_allowed == 2  # 운영진 · 존나(관리자는 옛 목록도 막았다)
    assert n.unexplained == 0


def test_site_and_lobby_rules_stay_different(policy):
    # 닉네임은 공백 · 자모를 받지 않고, 조사관명은 낱말 사이 한 칸 공백 · 자모를 받는다
    report = audit_rows(
        policy, row("김철수", "김 철수", uid="1"), row("김 철수", "ㅋㅋ조사관", uid="2")
    )
    assert report.nicknames.invalid == 1 and report.nicknames.reasons["format"] == 1
    assert report.characters.invalid == 0 and report.lobby_kept == 2


def test_multiple_reasons_count_once_in_invalid(policy):
    report = audit_rows(policy, row("운영자!!"))  # 형식 + 예약어
    n = report.nicknames
    assert n.invalid == 1 and n.reasons["format"] == 1 and n.reasons["reserved"] == 1


def test_withdrawn_admin_test_and_no_character(policy):
    report = audit_rows(
        policy,
        row("탈퇴#0123456789abcdef", deleted=True),
        row("운영진", role="admin"),
        row("관리팀", is_test=True),
        row("한서진"),
    )
    assert report.excluded["withdrawn"] == 1 and report.accounts_total == 4
    assert report.groups == {"admin": 1, "test": 1, "member": 1}
    assert report.nicknames.by_group["admin"] == 1
    assert report.no_character == 3


def test_lobby_fallback_counts_and_invalid_account_nickname(policy):
    report = audit_rows(
        policy,
        row("한서진", "운영진"),  # 조사관명 거부 → 계정 닉네임(정상)으로
        row(
            "존나", "개발자"
        ),  # 조사관명 거부 → 계정 닉네임도 정책 위반(그래도 그대로 보인다)
        row("미르", "조사_관"),  # 그대로
    )
    assert report.characters.invalid == 2 and report.characters.fallback_allowed == 2
    assert (
        report.lobby_kept,
        report.lobby_fallback,
        report.lobby_fallback_nickname_invalid,
    ) == (1, 2, 1)
    assert report.characters.unexplained == 0


def test_lobby_reason_mirror_matches_the_real_function(policy):
    for name in [
        "조사_관",
        "Agent_007",
        "김 철수",
        "관_리_자",
        "__",
        "조사-관",
        "가" * 13,
        "탭\t이름",
        "ㅋㅋ조사관",
        "존나",
    ]:
        mirrored_ok = not audit.lobby_reasons(policy.lobby, policy.shared_judge, name)
        assert mirrored_ok == (
            policy.lobby.public_investigator_name(name) is not None
        ), name


def test_report_contains_counts_only(policy):
    names = ["운영진", "존나", "한서진", "탈퇴검증", "개발자"]
    report = audit_rows(
        policy, *(row(n, n, uid=f"uid-{i}-secret") for i, n in enumerate(names))
    )
    out = audit.render(policy, report)
    for value in names + ["uid-0-secret", "@"]:
        assert value not in out
    assert "Completed: PASS" in out and "Violations found: yes" in out
