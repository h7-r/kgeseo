# pytest fixture(overrides · reader_override)를 다른 테스트 모듈에서 가져와 인자로 쓴다.
# ruff: noqa: F811
import asyncio
import json
import logging
import unicodedata
from pathlib import Path

import pytest
from sqlalchemy.exc import OperationalError

from app.api.v1 import npc as npc_api
from app.api.v1.npc import get_general_line_pack, get_general_pack_access_reader
from app.core.config import settings
from app.main import app
from app.services import npc_general_pack as supply
from app.services.npc_dialogue import PM_GENERIC_PUZZLE_LINES
from app.services.npc_general_pack import (
    GENERAL_PACK_ROOT,
    NO_PACK_APPROVAL,
    GeneralPackAccess,
    GeneralPackLoadError,
    configured_general_pack,
    load_general_pack,
    read_general_pack_access,
)
from app.services.npc_line_supply import (
    PAUSE_LINE_PREFIX,
    general_pack_fingerprint,
    general_pack_line_provider,
    generic_line_approval,
    select_pause_line,
)
from tests.pack_policy_stub import passing_test_policy
from tests.test_npc_case_access import (  # noqa: F401  (pytest fixture)
    BLOCKED,
    Reader,
    approved_access,
    reader_override,
)
from tests.test_npc_generic_pause import PAUSE_LINES, pack_approval
from tests.test_npc_turn import approved
from tests.test_npc_turn_http import (  # noqa: F401  (pytest fixture)
    URL,
    body,
    overrides,
    session_row,
    stored,
)

OFFICIAL = "general_default/v1"
# PM 확정 원문(11/3). 한 글자도 바꾸지 않는다. 파일과 따로 적어 두어 파일이 바뀌면 이 테스트가 깨진다.
PM_PAUSE_LINES = {
    "GENERIC_PAUSE_01": "여기 왜곡이 짙어서 제 목소리가 잘 닿지 않네요. 잠시만 기다려 주세요.",
    "GENERIC_PAUSE_02": "저는 조용히 따라갈게요. 둘러보고 싶은 곳이 있으면 천천히 가 보세요.",
    "GENERIC_PAUSE_03": "지금은 이 사건 이야기를 하기가 조심스러워요. 둘러보는 건 계속하셔도 돼요.",
    "GENERIC_PAUSE_04": "제 기억이 잠깐 엉켰어요. 막히면 힌트 버튼을 눌러 주세요.",
    "GENERIC_PAUSE_05": "잠시 숨을 고를게요. 그동안 조사수첩을 다시 훑어보는 것도 좋아요.",
}
# 승인 대상 fingerprint. 파일 내용이 바뀌면 값이 바뀌고, 이전 승인은 새 내용에 쓰이지 않는다.
OFFICIAL_FINGERPRINT = (
    "sha256:a625988f0187d724f97184733be0e8a8d1b936c950dfc35d84329c19cea086be"
)


@pytest.fixture
def official():
    return load_general_pack(OFFICIAL)


# ── 공식 팩 파일 ──


def test_official_pack_holds_exactly_the_pm_lines(official) -> None:
    assert (official.pack_id, official.pack_version) == ("general_default", 1)
    assert {line.line_id: line.text for line in official.lines} == PM_PAUSE_LINES
    line_ids = [line.line_id for line in official.lines]
    assert len(line_ids) == len(set(line_ids)) == 5
    assert all(line_id.startswith(PAUSE_LINE_PREFIX) for line_id in line_ids)


def test_official_pack_file_is_plain_utf8_without_hidden_characters() -> None:
    raw = (GENERAL_PACK_ROOT / "general_default" / "v1.json").read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf")
    for line in json.loads(raw.decode("utf-8"))["lines"]:
        text = line["text"]
        assert text == text.strip()
        assert unicodedata.is_normalized("NFC", text)
        assert not any(unicodedata.category(ch) in ("Cf", "Cc") for ch in text)


def test_official_fingerprint_uses_the_canonical_pack_hash(official) -> None:
    assert general_pack_fingerprint(official) == OFFICIAL_FINGERPRINT


def test_official_pack_is_separate_from_test_packs(official) -> None:
    official_texts = {line.text for line in official.lines}
    assert not official_texts & set(PAUSE_LINES.values())
    # 공식 팩에는 PM 기본 안내 문구(NPC_GENERIC_PUZZLE_*)가 없다(일반 응답 동작을 바꾸지 않는다).
    assert not {line.line_id for line in official.lines} & set(PM_GENERIC_PUZZLE_LINES)


def test_pause_lines_are_never_general_fallback_lines(official) -> None:
    approval = pack_approval(official)
    # 승인돼도 일반 대체 대사 · 재전송 원문 공급에는 나오지 않는다(긴급 중단 전용).
    assert (
        list(general_pack_line_provider(official, approval, passing_test_policy)())
        == []
    )
    approved_generic = generic_line_approval(
        official,
        approval,
        PM_GENERIC_PUZZLE_LINES,
        passing_test_policy,
    )
    assert not any(approved_generic(line_id) for line_id in PM_GENERIC_PUZZLE_LINES)
    assert (
        select_pause_line(official, approval, "e", passing_test_policy).line_id
        in PM_PAUSE_LINES
    )


def test_official_selection_is_fixed(official) -> None:
    # SHA-256(도메인 \0 fingerprint \0 키) 앞 8바이트 mod 5. 같은 팩 · 같은 요청 ID면 언제나 같은 대사.
    picks = [
        select_pause_line(
            official, pack_approval(official), key, passing_test_policy
        ).line_id
        for key in (
            "66666666-6666-4666-8666-666666666666",
            "00000000-0000-4000-8000-000000000000",
            "event-a",
        )
    ]
    # 기대값은 규칙을 hashlib로 따로 계산한 값이다(select_pause_line을 쓰지 않음).
    assert picks == ["GENERIC_PAUSE_03", "GENERIC_PAUSE_05", "GENERIC_PAUSE_01"]


# ── 불러오기(fail closed) ──


@pytest.mark.parametrize(
    "setting",
    [
        "../general_default/v1",
        "general_default/v0",
        "General/v1",
        "general_default",
        "a/b/v1",
    ],
)
def test_invalid_setting_is_rejected(setting: str) -> None:
    with pytest.raises(GeneralPackLoadError, match="invalid_setting"):
        load_general_pack(setting)


def write_pack(root: Path, pack_dir: str, version: str, document) -> None:
    (root / pack_dir).mkdir(parents=True, exist_ok=True)
    (root / pack_dir / f"{version}.json").write_text(
        document if isinstance(document, str) else json.dumps(document),
        encoding="utf-8",
    )


def test_missing_mismatched_or_invalid_files_are_not_loaded(tmp_path) -> None:
    pack = {
        "schema_version": "npc-general-pack 0.1",
        "pack_id": "general_other",
        "pack_version": 1,
        "lines": [{"line_id": "GENERIC_PAUSE_01", "text": "(가상)", "use": "pause"}],
    }
    write_pack(tmp_path, "general_default", "v1", pack)  # 파일 안 pack_id가 다르다
    write_pack(tmp_path, "general_bad", "v1", "{not json")
    write_pack(
        tmp_path,
        "general_dup",
        "v1",
        {**pack, "pack_id": "general_dup", "lines": pack["lines"] * 2},
    )

    for setting, reason in (
        ("general_default/v1", "id_mismatch"),
        ("general_default/v2", "file_missing"),
        ("general_bad/v1", "invalid_pack"),
        ("general_dup/v1", "invalid_pack"),
    ):
        with pytest.raises(GeneralPackLoadError, match=reason):
            load_general_pack(setting, tmp_path)


def test_configured_pack_is_none_unless_set(caplog) -> None:
    assert configured_general_pack("") is None
    with caplog.at_level(logging.ERROR):
        assert configured_general_pack("general_missing/v9") is None
    assert "file_missing" in caplog.text
    assert configured_general_pack(OFFICIAL).pack_id == "general_default"


def test_router_supplies_the_pack_only_when_configured(monkeypatch) -> None:
    monkeypatch.setattr(settings, "npc_general_pack", "")
    assert npc_api.get_general_line_pack() == (None, None)  # 기본: 공급 없음
    monkeypatch.setattr(settings, "npc_general_pack", OFFICIAL)
    pack, static_approval = npc_api.get_general_line_pack()
    # 공식 팩을 주되 고정 승인은 없다. 승인은 매 턴 DB에서 읽는다.
    assert (pack.pack_id, static_approval) == ("general_default", None)
    assert npc_api.get_general_pack_access_reader() is read_general_pack_access


# ── DB 판정(fail closed) ──


class BrokenDb:
    async def execute(self, *args, **kwargs):
        raise OperationalError("SELECT", {}, Exception("down"))


@pytest.mark.parametrize("lock", [False, True])
def test_db_error_means_no_pack_approval(official, lock: bool) -> None:
    access = asyncio.run(read_general_pack_access(BrokenDb(), official, lock=lock))
    assert access == NO_PACK_APPROVAL
    assert (
        select_pause_line(official, access.approval_source, "e", passing_test_policy)
        is None
    )


# ── HTTP: 공식 팩 · DB 판정 경로 ──


@pytest.fixture
def db_pack(overrides, monkeypatch):
    """운영 경로(설정으로 공식 팩 공급 + DB 승인 판정)를 쓰되, 판정 결과만 대역으로 바꾼다."""

    app.dependency_overrides.pop(get_general_line_pack, None)
    official = load_general_pack(OFFICIAL)
    state = {"access": GeneralPackAccess(None, basis=())}
    calls: list[bool] = []

    async def reader(db, pack, *, lock):
        assert pack == official  # 설정한 공식 팩만 판정한다
        calls.append(lock)
        return state["access"]

    app.dependency_overrides[get_general_pack_access_reader] = lambda: reader
    monkeypatch.setattr(settings, "npc_general_pack", OFFICIAL)
    state["calls"] = calls
    state["pack"] = official
    return state


def approved_access_for(pack, basis=("r1",)):
    return GeneralPackAccess(pack_approval(pack), basis=basis)


def test_blocked_turn_uses_the_official_pause_line_when_db_approved(
    client, db_session, reader_override, db_pack
) -> None:
    db_pack["access"] = approved_access_for(db_pack["pack"])
    reader_override(Reader(BLOCKED))
    db_session.get_result = session_row()

    response = client.post(URL, json=body()).json()

    line = select_pause_line(
        db_pack["pack"],
        pack_approval(db_pack["pack"]),
        body()["client_event_id"],
        passing_test_policy,
    )
    assert response["reply"] == {
        "source": "approved_line",
        "text": PM_PAUSE_LINES[line.line_id],
        "line_id": line.line_id,
    }
    assert response["fallback_reason"] == "NPC_CONTENT_WITHDRAWN"
    assert response["content_mode"] == "generic"
    assert response["suggest_hint"] is None
    # 계산 전(잠금 없음) · 확정 때(공유 잠금) 두 번 읽는다.
    assert db_pack["calls"] == [False, True]


@pytest.mark.parametrize(
    "access",
    ["none", "other_fingerprint", "case_record_key", "db_error"],
)
def test_blocked_turn_without_a_valid_db_approval_keeps_null(
    client, db_session, reader_override, db_pack, access
) -> None:
    pack = db_pack["pack"]
    db_pack["access"] = {
        "none": GeneralPackAccess(None, basis=()),
        "other_fingerprint": GeneralPackAccess(
            pack_approval(pack, "sha256:" + "f" * 64), basis=("r1",)
        ),
        # 같은 승인 기록이라도 케이스 키((case_test, 1))로 읽힌 것은 팩 승인이 아니다.
        "case_record_key": GeneralPackAccess(
            approved(("case_test", 1), OFFICIAL_FINGERPRINT).source(), basis=("r1",)
        ),
        "db_error": NO_PACK_APPROVAL,
    }[access]
    reader_override(Reader(BLOCKED))
    db_session.get_result = session_row()

    response = client.post(URL, json=body()).json()

    assert response["reply"] is None
    assert (response["fallback_reason"], response["content_mode"]) == (
        "NPC_CONTENT_WITHDRAWN",
        "generic",
    )


def test_pack_approval_withdrawn_during_turn_is_recomputed(
    client, db_session, reader_override, db_pack
) -> None:
    pack = db_pack["pack"]
    sequence = iter(
        [approved_access_for(pack), GeneralPackAccess(None, basis=("r1", "r2"))]
    )

    async def reader(db, pack_, *, lock):
        return next(sequence)

    app.dependency_overrides[get_general_pack_access_reader] = lambda: reader
    reader_override(Reader(BLOCKED))
    db_session.get_result = session_row()

    response = client.post(URL, json=body()).json()

    assert response["reply"] is None  # 확정 때 철회를 보고 다시 계산했다
    assert stored(db_session).response_json["line_id"] is None


def test_published_case_response_is_unchanged_with_official_pack(
    client, db_session, reader_override, db_pack
) -> None:
    db_pack["access"] = approved_access_for(db_pack["pack"])
    reader_override(Reader(approved_access()))
    db_session.get_result = session_row()

    response = client.post(URL, json=body()).json()

    assert response["reply"]["line_id"] == "NUDGE_A_01"
    assert (response["fallback_reason"], response["content_mode"]) == (None, "case")


def test_resend_of_a_pause_reply_after_unblock_never_reuses_the_pause_line(
    client, db_session, reader_override, db_pack
) -> None:
    db_pack["access"] = approved_access_for(db_pack["pack"])
    reader_override(Reader(BLOCKED))
    db_session.get_result = session_row()
    first = client.post(URL, json=body()).json()
    assert first["reply"]["line_id"].startswith(PAUSE_LINE_PREFIX)
    event = stored(db_session)

    # 다시 게시(차단 해제)된 뒤의 재전송: 잠시 멈춤 대사는 차단 중에만 쓴다. 저장 결과(철회 응답)만 돌려준다.
    reader_override(Reader(approved_access()))
    db_session.added.clear()
    db_session.scalar_result = event
    again = client.post(URL, json=body()).json()

    assert db_session.added == []
    assert again["reply"] is None
    assert (again["fallback_reason"], again["content_mode"]) == (
        "NPC_CONTENT_WITHDRAWN",
        "generic",
    )


def test_module_has_no_hidden_approval() -> None:
    # 공급 모듈은 승인 기록을 만들지 않는다(관리자 · 승인 생성 경로가 없다).
    source = Path(supply.__file__).read_text(encoding="utf-8")
    assert "create_gate_review" not in source and "VerifiedAdmin" not in source


def test_status_script_prints_the_approval_target_without_db(capsys) -> None:
    from scripts import general_pack_status

    assert general_pack_status.main([OFFICIAL]) == 0
    out = capsys.readouterr().out
    assert (
        "target_type=dialogue_pack target_id=general_default content_version=1" in out
    )
    assert f"target_hash={OFFICIAL_FINGERPRINT}" in out
    assert general_pack_status.main(["../x/v1"]) == 1
    # 승인 기록을 쓰는 경로가 없다(읽기 전용).
    source = Path(general_pack_status.__file__).read_text(encoding="utf-8")
    assert "create_gate_review" not in source and "VerifiedAdmin" not in source
