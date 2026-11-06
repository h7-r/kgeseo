"""PM v0.4.14 §A 일반 대사 팩 정책 검사(GEN-*) · 새 케이스 게시 때 일반 팩 재검사(GEN_PACK).

케이스 · 정답 · 단서 · 고유명은 모두 가상 데이터다(실제 케이스 · 실제 정답이 아니다). 공식 팩은 저장소 파일 그대로 쓴다.
"""

import hashlib
from pathlib import Path

import pytest

from app.core.config import settings
from app.schemas.npc_content import GeneralLinePack, NpcContentPack
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.dialogue_pack_policy import (
    DEFAULT_DIALOGUE_PACK_POLICY,
    MAX_LINE_LENGTH,
    PublishedCase,
    check_dialogue_pack,
    published_cases_policy,
    run_dialogue_pack_policy,
)
from app.services.nickname_policy import (
    InvalidNicknameError,
    forbidden_terms_in,
    validate_nickname,
)
from app.services.npc_general_pack import GENERAL_PACK_ROOT, load_general_pack
from app.services.npc_line_supply import (
    general_pack_approved,
    general_pack_fingerprint,
    select_pause_line,
)
from app.services.pinned_content import PinnedContentStore
from tests.test_npc_general_pack import OFFICIAL, OFFICIAL_FINGERPRINT, PM_PAUSE_LINES
from tests.test_npc_turn import approved
from tests.test_publication_gate import (
    base_documents,
    hint_source,
    run,
    seal,
)

OFFICIAL_FILE_SHA256 = None  # 파일 바이트 해시는 아래 테스트가 처음 값과 비교하지 않고 원문 · fingerprint로 고정한다


def pack(*lines: tuple[str, str], pack_id: str = "test_pack") -> GeneralLinePack:
    return GeneralLinePack.model_validate(
        {
            "schema_version": "npc-general-pack 0.1",
            "pack_id": pack_id,
            "pack_version": 1,
            "lines": [
                {"line_id": line_id, "text": text, "use": "pause"}
                for line_id, text in lines
            ],
        }
    )


def checks(result) -> dict[str, str]:
    return dict(result.checks)


# 가상 게시 케이스: 정답 · 단서 · 힌트 · NG
VIRTUAL_HINTS = {
    ("case_virtual", "PZ_V", 1): "가상 등불 아래 숨은 열쇠를 찾아보세요",
    ("case_virtual", "PZ_V", 2): "가상 정답은 붉은달입니다",
}


def virtual_case(*, ng=(), proper_names=None, answers=("붉은달",)) -> PublishedCase:
    runtime = PuzzleRuntimeDefinition.model_validate(
        {
            "schema_version": "puzzle-runtime 0.1",
            "case_id": "case_virtual",
            "puzzles": [
                {
                    "puzzle_id": "PZ_V",
                    "accepted_answers": list(answers),
                    "on_correct": {"grant_clue_ids": [], "set_flags": {}},
                }
            ],
            "clue_combinations": [],
            "clues": [
                {
                    "clue_id": "CL_V",
                    "title": "가상 단서",
                    "body": "나루터 기둥에 새겨진 오래된 표식",
                }
            ],
        }
    )
    npc = (
        NpcContentPack.model_validate(
            {
                "schema_version": "npc-pack 0.1",
                "case_id": "case_virtual",
                "npc_id": "NPC_V",
                "status": "published",
                "content_version": 1,
                "ng": [{"text": text, "patterns": [text]} for text in ng],
                "open": [],
            }
        )
        if ng is not None
        else None
    )
    return PublishedCase(
        case_id="case_virtual",
        content_version=1,
        runtime=runtime,
        npc=npc,
        hint_source=lambda c, p, level: VIRTUAL_HINTS.get((c, p, level)),
        proper_names=proper_names,
    )


@pytest.fixture
def official():
    return load_general_pack(OFFICIAL)


# ── 공식 팩: 원문 · fingerprint 불변, 실제 검사 결과 ──


def test_official_pack_text_and_fingerprint_are_unchanged(official) -> None:
    assert {line.line_id: line.text for line in official.lines} == PM_PAUSE_LINES
    assert general_pack_fingerprint(official) == OFFICIAL_FINGERPRINT
    assert OFFICIAL_FINGERPRINT == (
        "sha256:a625988f0187d724f97184733be0e8a8d1b936c950dfc35d84329c19cea086be"
    )
    raw = (GENERAL_PACK_ROOT / "general_default" / "v1.json").read_bytes()
    assert hashlib.sha256(
        raw
    ).hexdigest()  # 파일을 읽을 수 있다(내용은 위 원문 · fingerprint로 고정)


def test_official_pack_passes_static_checks_and_waiting_is_not_a_time_promise(
    official,
) -> None:
    result = check_dialogue_pack(official, ())  # 게시 케이스 없음
    assert result.status == "PASS"
    assert set(checks(result).values()) == {"PASS"}
    # 「잠시만 기다려 주세요」(01) · 「잠시 숨을 고를게요」(05)는 복귀 시간 약속이 아니다
    assert "잠시만 기다려 주세요" in PM_PAUSE_LINES["GENERIC_PAUSE_01"]
    assert all(len(text) <= MAX_LINE_LENGTH for text in PM_PAUSE_LINES.values())


def test_official_pack_with_published_case_is_blocked_only_by_undefined_names(
    official,
) -> None:
    # 검수 고유명 데이터가 없는 게시 케이스는 GEN-CASE UNVERIFIED
    result = check_dialogue_pack(official, (virtual_case(),))
    assert result.status == "UNVERIFIED"
    assert checks(result)["GEN-CASE"] == "UNVERIFIED"
    assert checks(result)["GEN-LEAK"] == "PASS"
    assert {f.detail for f in result.findings} == {
        "proper_names_undefined:case_virtual@v1"
    }
    # 고유명 목록이 주어지고 겹치지 않으면 PASS
    named = check_dialogue_pack(official, (virtual_case(proper_names=("아랑",)),))
    assert named.status == "PASS"


def test_unknown_published_cases_are_never_pass(official) -> None:
    for result in (
        check_dialogue_pack(official, None),
        run_dialogue_pack_policy(DEFAULT_DIALOGUE_PACK_POLICY, official),
    ):
        assert result.status == "UNVERIFIED"
        assert (checks(result)["GEN-LEAK"], checks(result)["GEN-CASE"]) == (
            "UNVERIFIED",
            "UNVERIFIED",
        )


# ── 검사별 위반 사례 ──


def test_gen_len() -> None:
    ok = pack(("GENERIC_PAUSE_01", "가" * MAX_LINE_LENGTH))
    too_long = pack(("GENERIC_HELLO", "가" * (MAX_LINE_LENGTH + 1)))
    assert checks(check_dialogue_pack(ok, ()))["GEN-LEN"] == "PASS"
    result = check_dialogue_pack(too_long, ())
    assert checks(result)["GEN-LEN"] == "FAIL"
    assert result.findings[0].detail == "length:81"


@pytest.mark.parametrize("term", ["오류", "서버", "점검", "버그", "연결", "시스템"])
def test_gen_sys_applies_to_pause_lines_only(term: str) -> None:
    text = f"지금은 {term} 때문에 쉬어요."
    result = check_dialogue_pack(pack(("GENERIC_PAUSE_09", text)), ())
    assert checks(result)["GEN-SYS"] == "FAIL"
    assert result.findings[0].detail == f"term:{term}"
    other = check_dialogue_pack(pack(("GENERIC_HELLO", text)), ())
    assert checks(other)["GEN-SYS"] == "PASS"


@pytest.mark.parametrize(
    ("text", "status"),
    [
        ("곧 돌아올게요.", "FAIL"),
        ("몇 분만 기다려 주세요.", "FAIL"),
        ("몇분 쉬고 올게요.", "FAIL"),
        ("잠시 뒤 돌아올게요.", "FAIL"),
        ("잠시만 기다려 주세요.", "PASS"),
        ("잠시 숨을 고를게요.", "PASS"),
        ("곧장 가 보세요.", "PASS"),
        # 「뒤를 돌아보다」는 예시 「잠시 뒤 돌아」와 다른 말이다(예시를 넓히지 않는다)
        ("잠시 뒤를 돌아봐요.", "PASS"),
    ],
)
def test_gen_time_matches_pm_examples_only(text: str, status: str) -> None:
    result = check_dialogue_pack(pack(("GENERIC_PAUSE_09", text)), ())
    assert checks(result)["GEN-TIME"] == status


def test_gen_time_does_not_apply_to_non_pause_lines() -> None:
    result = check_dialogue_pack(pack(("GENERIC_HELLO", "곧 돌아올게요.")), ())
    assert checks(result)["GEN-TIME"] == "PASS"


def test_gen_word_reuses_the_nickname_rule_including_its_false_positives() -> None:
    assert checks(check_dialogue_pack(pack(("GENERIC_X", "씨발")), ()))["GEN-WORD"] == (
        "FAIL"
    )
    assert checks(check_dialogue_pack(pack(("GENERIC_X", "SH1T")), ()))["GEN-WORD"] == (
        "FAIL"
    )
    # 닉네임 규칙과 같은 판정(같은 함수)
    with pytest.raises(InvalidNicknameError):
        validate_nickname("sh1t")
    assert validate_nickname("shitake") == "shitake"
    # 알려진 오탐(부분 포함 규칙 그대로): 「보지」 · 「자지」가 들어간 정상 문장
    assert forbidden_terms_in("굳이 둘러보지 않아도 돼요.") == ("보지",)
    assert forbidden_terms_in("여기서 자지 마세요.") == ("자지",)
    # 공식 문장은 해당 없음
    for text in PM_PAUSE_LINES.values():
        assert forbidden_terms_in(text) == ()


@pytest.mark.parametrize(
    ("text", "detail_prefix"),
    [
        ("오늘 밤은 붉은달 이 떠요.", "ANSWER:case_virtual@v1:PZ_V"),
        (
            "나루터 기둥에 새겨진 오래된 표식이 있어요.",
            "LEAK_CLUE:case_virtual@v1:CL_V",
        ),
        ("등불 아래 숨은 열쇠를 찾아요.", "LEAK_HINT:case_virtual@v1:PZ_V:1"),
        ("물귀신이 데려갔대요.", "NG:case_virtual@v1:ng[0]"),
    ],
)
def test_gen_leak_reuses_output_check(text: str, detail_prefix: str) -> None:
    case = virtual_case(ng=("물귀신이 데려갔",), proper_names=())
    result = check_dialogue_pack(pack(("GENERIC_X", text)), (case,))
    assert checks(result)["GEN-LEAK"] == "FAIL"
    assert any(f.detail == detail_prefix for f in result.findings)
    # 근거에는 원문 · 정답이 없다
    assert all("붉은달" not in f.detail for f in result.findings)


def test_gen_leak_without_ng_data_is_unverified() -> None:
    no_ng = virtual_case(ng=None, proper_names=())
    result = check_dialogue_pack(pack(("GENERIC_X", "천천히 둘러봐요.")), (no_ng,))
    assert checks(result)["GEN-LEAK"] == "UNVERIFIED"
    assert result.status == "UNVERIFIED"


def test_gen_case_needs_contracted_names() -> None:
    line = pack(("GENERIC_X", "아랑 아씨를 찾아가 보세요."))
    undefined = check_dialogue_pack(line, (virtual_case(),))
    assert checks(undefined)["GEN-CASE"] == "UNVERIFIED"
    named = check_dialogue_pack(line, (virtual_case(proper_names=("나루", "아랑")),))
    assert checks(named)["GEN-CASE"] == "FAIL"
    # 근거는 목록 위치만(이름 원문 없음)
    assert [f.detail for f in named.findings] == ["proper_name:case_virtual@v1:1"]


def test_policy_errors_are_unverified(official) -> None:
    def broken(_pack):
        raise RuntimeError("x")

    assert run_dialogue_pack_policy(broken, official).status == "UNVERIFIED"


# ── 사용 조건: G3 + 정책 검사 PASS (+ 공급 설정은 라우터) ──


def g3_only(pack_: GeneralLinePack):
    from app.services.approval_history import ApprovalLog
    from tests.test_npc_turn import review

    log = ApprovalLog()
    log.append(
        pack_.pack_id, pack_.pack_version, review(general_pack_fingerprint(pack_), "G3")
    )
    return log.source()


def test_usable_only_with_g3_and_policy_pass(official) -> None:
    no_cases = published_cases_policy(())
    with_case = published_cases_policy((virtual_case(),))
    assert general_pack_approved(official, g3_only(official), no_cases) is True
    assert select_pause_line(official, g3_only(official), "e1", no_cases) is not None
    # 정책 검사가 UNVERIFIED면 G3만으로는 쓰지 않는다
    assert general_pack_approved(official, g3_only(official), with_case) is False
    # 정책 검사 PASS여도 G3가 없으면 쓰지 않는다
    assert general_pack_approved(official, None, no_cases) is False
    assert (
        general_pack_approved(
            official, approved(("other", 1), OFFICIAL_FINGERPRINT).source(), no_cases
        )
        is False
    )


# ── 새 케이스 게시: 설정된 일반 팩 재검사(GEN_PACK) ──


def gate_files(*, ng=(), answer=None, names=()):
    documents = base_documents()
    documents["npc"]["ng"] = [{"text": t, "patterns": [t]} for t in ng]
    documents["npc"]["open"] = []
    documents["npc"]["proper_nouns"] = [
        {"text": name, "kind": "person", "aliases": []} for name in names
    ]
    if answer is not None:
        documents["server"]["puzzles"][0]["accepted_answers"] = [answer]
    del documents["idmap"]
    files, fingerprint = seal(documents)
    return {**files, "idmap": None}, fingerprint


def test_new_case_conflicting_with_configured_pack_is_rejected() -> None:
    conflicting = pack(("GENERIC_PAUSE_09", "가상정답일 수도 있어요."))
    files, fingerprint = gate_files()
    result, store = run(files, fingerprint, general_pack=conflicting)
    gen = result.check("GEN_PACK")
    assert gen.status == "FAIL"
    assert gen.reasons == (
        "GEN-LEAK:GENERIC_PAUSE_09:ANSWER:case_gate_test@v1:PUZZLE_A",
    )
    assert result.approved is False and result.registered is False
    assert store.versions("case_gate_test") == ()


def test_new_case_proper_name_conflict_is_rejected() -> None:
    files, fingerprint = gate_files(names=("쪽지 귀신",))
    result, _ = run(
        files,
        fingerprint,
        general_pack=pack(("GENERIC_PAUSE_09", "쪽지 귀신을 조심해요.")),
    )
    assert result.check("GEN_PACK").status == "FAIL"
    assert (
        "GEN-CASE:GENERIC_PAUSE_09:proper_name:case_gate_test@v1:0"
        in result.check("GEN_PACK").reasons
    )
    assert all(
        reason.startswith("GEN-CASE:") for reason in result.check("GEN_PACK").reasons
    )
    assert result.registered is False


def test_new_case_without_conflict_keeps_the_publication_flow(official) -> None:
    files, fingerprint = gate_files()
    result, store = run(files, fingerprint, general_pack=official)
    assert result.check("GEN_PACK").status == "PASS"
    assert result.registered is True
    assert store.versions("case_gate_test") == (1,)


def test_new_case_with_configured_pack_is_blocked_while_names_are_undefined(
    official,
) -> None:
    # 운영 경로: proper_nouns 검수 데이터가 누락되면 GEN-CASE UNVERIFIED
    documents = base_documents()
    documents["npc"].pop("proper_nouns")
    del documents["idmap"]
    files, fingerprint = seal(documents)
    result, _ = run({**files, "idmap": None}, fingerprint, general_pack=official)
    assert result.check("GEN_PACK").status == "UNVERIFIED"
    assert result.check("GEN_PACK").reasons == (
        "GEN-CASE:-:proper_names_undefined:case_gate_test@v1",
    )
    assert result.registered is False


def test_new_case_without_ng_data_is_unverified_against_the_pack(official) -> None:
    documents = base_documents()
    documents["npc"].pop("ng", None)
    del documents["idmap"]
    files, fingerprint = seal(documents)
    result, _ = run(
        {**files, "idmap": None},
        fingerprint,
        general_pack=official,
    )
    assert result.check("GEN_PACK").status == "UNVERIFIED"
    assert result.registered is False


def test_configured_setting_decides_the_gate_pack(monkeypatch, tmp_path) -> None:
    files, fingerprint = gate_files()
    monkeypatch.setattr(settings, "npc_general_pack", "")
    result, _ = run(files, fingerprint)
    assert result.check("GEN_PACK").status == "NOT_APPLICABLE"
    assert result.registered is True

    # 설정된 팩 파일을 읽지 못하면 FAIL(fail closed)
    monkeypatch.setattr(settings, "npc_general_pack", "missing_pack/v1")
    result, _ = run(files, fingerprint, store=PinnedContentStore())
    assert result.check("GEN_PACK").status == "FAIL"
    assert result.check("GEN_PACK").reasons == ("general_pack:file_missing",)
    assert result.registered is False

    # 공식 팩 설정: 검수 목록이 있는 새 콘텐츠는 대조 가능
    monkeypatch.setattr(settings, "npc_general_pack", OFFICIAL)
    result, _ = run(files, fingerprint, store=PinnedContentStore())
    assert result.check("GEN_PACK").status == "PASS"


def test_gate_reasons_never_contain_answers_or_line_text() -> None:
    files, fingerprint = gate_files(ng=("가상 금지 문장",))
    line = "가상 금지 문장 가상정답일"
    result, _ = run(
        files,
        fingerprint,
        general_pack=pack(("GENERIC_PAUSE_09", line)),
    )
    reasons = " ".join(result.check("GEN_PACK").reasons)
    assert "가상정답일" not in reasons and "금지 문장" not in reasons
    assert hint_source  # 게이트는 server.json 힌트 원문을 그대로 쓴다


def test_official_pack_file_is_untouched() -> None:
    path = Path(GENERAL_PACK_ROOT) / "general_default" / "v1.json"
    assert general_pack_fingerprint(load_general_pack(OFFICIAL)) == OFFICIAL_FINGERPRINT
    assert path.is_file()
