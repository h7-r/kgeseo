"""P2-A 변환기 — 기존 Case 파일 → ScenarioPack."""

import copy
import json

import pytest
from conftest import BACKEND_CASES, FIXTURE_CASES

from companion_npc.adapters import convert_case, load_case_sources
from companion_npc.adapters.__main__ import main as cli_main
from companion_npc.adapters.case_content import (
    FIELD_POLICY,
    FORBIDDEN_KEYS,
    canonical_json,
    canonical_sha256,
)
from companion_npc.adapters.errors import (
    AnswerLeakError,
    CaseFileDecodeError,
    CaseFileNotFoundError,
    CaseLinkError,
    ClientContentInvalidError,
    InvalidCaseIdError,
    ServerRuntimeInvalidError,
)
from companion_npc.contracts import ScenarioPack
from companion_npc.contracts.common import PlaySessionStateSnapshot
from companion_npc.contracts.visibility import visible_chunks

needs_backend = pytest.mark.skipif(
    not (BACKEND_CASES / "case_001.client.json").is_file(), reason="backend not found"
)
LIGHTHOUSE = "case_fixture_lighthouse"
LIGHTHOUSE_ANSWERS = ["0412", "NORTHEAST", "북동"]


def _convert(sources, **kwargs):
    return convert_case(
        sources.client,
        sources.server,
        client_ref=f"{sources.case_id}.client.json",
        **kwargs,
    )


@pytest.fixture
def case_001():
    return load_case_sources(BACKEND_CASES, "case_001")


@pytest.fixture
def lighthouse():
    return load_case_sources(FIXTURE_CASES, LIGHTHOUSE)


def _state(**overrides) -> PlaySessionStateSnapshot:
    base = {
        "current_zone_id": None,
        "completed_puzzle_ids": [],
        "acquired_clue_ids": [],
        "hint_levels": {},
        "flags": {},
    }
    return PlaySessionStateSnapshot.model_validate(base | overrides)


def _publish(pack: ScenarioPack) -> ScenarioPack:
    """사람이 승인·공개했다고 **가정**한 복사본 — 테스트 안에서만."""

    data = pack.model_dump(mode="json")
    data["publication"] = {
        "status": "published",
        "approved_by": "test-fixture",
        "approved_at": "2026-10-24T00:00:00+09:00",
    }
    data["premise"] = {"title": "test", "public_synopsis": "test"}
    data["safety_audit"] = {
        "answer_leak_check": "passed",
        "checked_at": "2026-10-24T00:00:00+09:00",
        "checker_version": "test",
    }
    return ScenarioPack.model_validate(data)


# ── 1. 실제 case_001 ──────────────────────────────────────────
@needs_backend
def test_case_001_converts(case_001):
    result = _convert(case_001)
    pack, report = result.pack, result.report
    assert pack.case_id == "case_001"
    assert pack.entry_zone_id == case_001.client["entry_zone_id"]
    assert [z.zone_id for z in pack.zones] == ["ZONE_SECRET_CORRIDOR"]
    assert [o.object_id for o in pack.objects] == ["OBJ_FIRE_CABINET_LOCK"]
    (puzzle,) = pack.puzzles
    assert puzzle.puzzle_id == "PUZZLE_FIRE_CABINET_LOCK"
    assert puzzle.host_object_ids == ["OBJ_FIRE_CABINET_LOCK"]
    assert puzzle.zone_id == "ZONE_SECRET_CORRIDOR"
    assert puzzle.sets_flags == {"fire_cabinet_unlocked": True}
    assert pack.objects[0].puzzle_id == puzzle.puzzle_id
    assert report.leak_check.status == "passed"
    assert report.counts == {
        "zones": 1, "navigation": 0, "objects": 1, "puzzles": 1,
        "clues": 0, "hints": 0, "knowledge": 2, "hidden_objects": 0,
    }  # fmt: skip


@needs_backend
def test_case_001_invents_nothing(case_001):
    pack = _convert(case_001).pack
    assert pack.publication.status == "draft"
    assert pack.publication.approved_by is None
    assert pack.premise is None and pack.persona is None and pack.locale is None
    assert pack.hints == []
    assert pack.safety_audit is None
    assert pack.source.producer == "unknown"
    assert all(p.title is None and p.puzzle_type is None for p in pack.puzzles)
    assert all(
        k.spoiler_tier == 0 and k.kind in ("zone", "object") for k in pack.knowledge
    )


@needs_backend
def test_case_001_reports_missing_fields(case_001):
    report = _convert(case_001).report
    missing = {m.pack_path: m.needs for m in report.missing}
    assert missing["premise"] == "human_authoring"
    assert missing["hints[]"] == "human_approval"
    assert missing["puzzles[].puzzle_type"] == "generation_agent_spec"
    assert missing["puzzles[].prerequisite_puzzle_ids"] == "backend_contract"
    omitted = {o.source_path: o for o in report.omissions}
    assert omitted["server.puzzles[].accepted_answers"].count == 1
    assert omitted["server.puzzles[].accepted_answers"].category == "server_only_answer"


# ── 2. 잘못된 입력 ────────────────────────────────────────────
@pytest.mark.parametrize("case_id", ["../case_001", "a/b", "case 001", ""])
def test_loader_rejects_unsafe_case_id(case_id):
    with pytest.raises(InvalidCaseIdError):
        load_case_sources(FIXTURE_CASES, case_id)


def test_loader_missing_file(tmp_path):
    with pytest.raises(CaseFileNotFoundError):
        load_case_sources(tmp_path, "case_x")


@pytest.mark.parametrize(
    "content",
    [b"{not json", b"\xff\xfe\x00bad", b"[1, 2]"],
    ids=["json", "utf8", "array"],
)
def test_loader_bad_file(tmp_path, content):
    (tmp_path / "case_x.client.json").write_bytes(content)
    (tmp_path / "case_x.server.json").write_text("{}", encoding="utf-8")
    with pytest.raises(CaseFileDecodeError):
        load_case_sources(tmp_path, "case_x")


def test_missing_client_field(lighthouse):
    client = copy.deepcopy(lighthouse.client)
    del client["entry_zone_id"]
    with pytest.raises(ClientContentInvalidError) as info:
        convert_case(client, lighthouse.server, client_ref="x")
    assert any(loc.startswith("entry_zone_id") for loc in info.value.locations)


def test_client_rejects_unknown_field_like_backend(lighthouse):
    client = copy.deepcopy(lighthouse.client)
    client["zones"][0]["secret_0412"] = "x"
    with pytest.raises(ClientContentInvalidError) as info:
        convert_case(client, lighthouse.server, client_ref="x")
    assert info.value.locations == ["zones.0.<unknown key>: extra_forbidden"]
    assert "secret" not in str(info.value)
    assert "0412" not in str(info.value)


def test_invalid_server_error_does_not_echo_answer(lighthouse):
    server = copy.deepcopy(lighthouse.server)
    server["puzzles"][0]["accepted_answers"] = "0412"  # 목록이 아닌 문자열
    with pytest.raises(ServerRuntimeInvalidError) as info:
        convert_case(lighthouse.client, server, client_ref="x")
    assert "0412" not in str(info.value)


def test_duplicate_puzzle_rejected(lighthouse):
    server = copy.deepcopy(lighthouse.server)
    server["puzzles"].append(copy.deepcopy(server["puzzles"][0]))
    with pytest.raises(ServerRuntimeInvalidError):
        convert_case(lighthouse.client, server, client_ref="x")


def test_case_id_mismatch(lighthouse):
    server = copy.deepcopy(lighthouse.server)
    server["case_id"] = "case_other"
    with pytest.raises(CaseLinkError):
        convert_case(lighthouse.client, server, client_ref="x")


def test_input_target_must_exist(lighthouse):
    client = copy.deepcopy(lighthouse.client)
    client["zones"][0]["objects"][0]["interaction"]["target_id"] = "PUZZLE_NOPE"
    with pytest.raises(CaseLinkError):
        convert_case(client, lighthouse.server, client_ref="x")


def test_server_rejects_unknown_field_like_backend(lighthouse):
    server = copy.deepcopy(lighthouse.server)
    server["puzzles"][0]["designer_note"] = "secret plan"
    with pytest.raises(ServerRuntimeInvalidError) as info:
        convert_case(lighthouse.client, server, client_ref="x")
    assert info.value.locations == ["puzzles.0.<unknown key>: extra_forbidden"]
    assert "designer_note" not in str(info.value)
    assert "secret plan" not in str(info.value)


def test_unknown_key_name_with_answer_is_not_echoed(lighthouse):
    server = copy.deepcopy(lighthouse.server)
    server["puzzles"][0]["note_northeast"] = "x"
    with pytest.raises(ServerRuntimeInvalidError) as info:
        convert_case(lighthouse.client, server, client_ref="x")
    shown = str(info.value).casefold()
    for answer in LIGHTHOUSE_ANSWERS:
        assert answer.casefold() not in shown


def test_unknown_interaction_type_is_warned(lighthouse):
    client = copy.deepcopy(lighthouse.client)
    client["zones"][0]["objects"][1]["interaction"]["type"] = "rotate"
    result = convert_case(client, lighthouse.server, client_ref="x")
    logbook = next(o for o in result.pack.objects if o.object_id == "OBJ_LOGBOOK")
    assert logbook.interaction_type is None
    assert any("OBJ_LOGBOOK" in w for w in result.report.warnings)


# ── 3. 정답 · 서버 전용 정보 ──────────────────────────────────
@needs_backend
def test_case_001_pack_has_no_answer_or_server_keys(case_001):
    result = _convert(case_001)
    answers = [a for p in case_001.server["puzzles"] for a in p["accepted_answers"]]
    for text in (canonical_json(result.pack), canonical_json(result.report)):
        assert all(a.casefold() not in text.casefold() for a in answers)
    dumped = result.pack.model_dump(mode="json")
    assert not FORBIDDEN_KEYS & set(json.dumps(dumped).replace('"', " ").split())


def test_lighthouse_hides_combination_linkage(lighthouse):
    pack = _convert(lighthouse).pack
    by_id = {p.puzzle_id: p for p in pack.puzzles}
    # 조합 결과(CLUE_KEEPER_TRUTH · PUZZLE_RECONSTRUCT · truth_known)는 어떤 퍼즐과도 이어지지 않는다
    assert all("CLUE_KEEPER_TRUTH" not in p.grants_clue_ids for p in pack.puzzles)
    assert all("PUZZLE_RECONSTRUCT" not in p.completes_puzzle_ids for p in pack.puzzles)
    assert all("truth_known" not in p.sets_flags for p in pack.puzzles)
    assert by_id["PUZZLE_RECONSTRUCT"].sets_flags == {}
    # 단서는 ID 만, 짝 없이
    assert {c.clue_id for c in pack.clues} == {
        "CLUE_LENS_NOTE", "CLUE_LOG_DATES", "CLUE_KEEPER_TRUTH"
    }  # fmt: skip
    assert all(c.title is None and c.description is None for c in pack.clues)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda c, s: c["zones"][0]["objects"][0].update(object_name="Drawer 0412"),
        lambda c, s: c["zones"][1].update(description="Turn it north-east"),
        lambda c, s: s["puzzles"][0]["on_correct"]["set_flags"].update(
            {"code_0412_ok": True}
        ),
    ],
    ids=["object_name", "description", "flag_key"],
)
def test_leak_blocks_pack(lighthouse, mutate):
    client, server = copy.deepcopy(lighthouse.client), copy.deepcopy(lighthouse.server)
    mutate(client, server)
    with pytest.raises(AnswerLeakError) as info:
        convert_case(client, server, client_ref="x")
    report = info.value.report
    assert report.leak_check.status == "failed"
    shown = canonical_json(report) + str(info.value)
    for answer in LIGHTHOUSE_ANSWERS:
        assert answer.casefold() not in shown.casefold().replace("-", "")


@needs_backend
def test_alias_blocks_pack(case_001):
    client = copy.deepcopy(case_001.client)
    client["zones"][0]["description"] = "밸브 손잡이가 달린 소화전"
    with pytest.raises(AnswerLeakError):
        convert_case(
            client, case_001.server, client_ref="x", forbidden_aliases=("밸브",)
        )
    # 별칭을 안 주면 못 잡는다 — 한계를 문서·보고서에 적어 둔 이유
    convert_case(client, case_001.server, client_ref="x")


def test_short_answer_has_no_false_positive(lighthouse):
    server = copy.deepcopy(lighthouse.server)
    server["puzzles"][0]["accepted_answers"] = ["1"]
    result = convert_case(lighthouse.client, server, client_ref="x")
    assert result.report.leak_check.short_terms == 1
    client = copy.deepcopy(lighthouse.client)
    client["zones"][0]["description"] = "Room 1 of the house"
    with pytest.raises(AnswerLeakError):
        convert_case(client, server, client_ref="x")


def test_field_policy_marks_answers_unreferable():
    by_path = {f.source_path: f for f in FIELD_POLICY}
    answers = by_path["server.puzzles[].accepted_answers"]
    assert not answers.client_public and not answers.npc_referable
    target = by_path["client.zones[].objects[].interaction.target_id"]
    assert not target.client_public and target.npc_referable


# ── 4. P0~P1 계약 · 차단 규칙과의 호환 ─────────────────────────
@pytest.mark.parametrize("which", ["case_001", "lighthouse"])
def test_output_round_trips_through_contract(which, request):
    if which == "case_001" and not (BACKEND_CASES / "case_001.client.json").is_file():
        pytest.skip("backend not found")
    pack = _convert(request.getfixturevalue(which)).pack
    assert ScenarioPack.model_validate_json(canonical_json(pack)) == pack


def test_draft_pack_is_never_retrievable(lighthouse):
    pack = _convert(lighthouse).pack
    state = _state(current_zone_id="ZONE_KEEPER_HOUSE")
    assert visible_chunks(pack, LIGHTHOUSE, state, max_tier=2) == []


def test_draft_cannot_be_marked_published_without_premise(lighthouse):
    data = _convert(lighthouse).pack.model_dump(mode="json")
    data["publication"] = {
        "status": "published",
        "approved_by": "x",
        "approved_at": "2026-10-24T00:00:00+09:00",
    }
    with pytest.raises(ValueError, match="premise"):
        ScenarioPack.model_validate(data)


def test_published_copy_respects_zone_and_hidden_gates(lighthouse):
    pack = _publish(_convert(lighthouse).pack)
    house = {
        c.chunk_id
        for c in visible_chunks(
            pack, LIGHTHOUSE, _state(current_zone_id="ZONE_KEEPER_HOUSE"), 2
        )
    }
    lamp = {
        c.chunk_id
        for c in visible_chunks(
            pack, LIGHTHOUSE, _state(current_zone_id="ZONE_LAMP_ROOM"), 2
        )
    }
    assert "zone:ZONE_KEEPER_HOUSE" in house and "zone:ZONE_LAMP_ROOM" not in house
    assert "object:OBJ_LENS_DIAL" in lamp and "object:OBJ_DESK_DRAWER" not in lamp
    assert "object:OBJ_HIDDEN_PANEL" not in house | lamp  # 처음에 숨은 물건


# ── 5. 가상 시나리오 — 같은 변환기, 분기 없음 ──────────────────
def test_lighthouse_structure(lighthouse):
    result = _convert(lighthouse)
    pack, report = result.pack, result.report
    house, lamp = pack.zones
    assert [(n.door_object_id, n.target_zone_id) for n in house.navigation] == [
        ("OBJ_STAIR_DOOR", "ZONE_LAMP_ROOM")
    ]
    assert lamp.navigation[0].target_zone_id == "ZONE_KEEPER_HOUSE"
    objects = {o.object_id: o for o in pack.objects}
    assert objects["OBJ_HIDDEN_PANEL"].initially_visible is False
    assert (
        objects["OBJ_LOGBOOK"].puzzle_id is None
    )  # inspect 의 target_id 는 퍼즐로 보지 않는다
    assert objects["OBJ_LAMP_STAIR"].interaction_type is None
    by_id = {p.puzzle_id: p for p in pack.puzzles}
    assert list(by_id) == [
        "PUZZLE_DRAWER",
        "PUZZLE_LENS",
        "PUZZLE_FINALE",
        "PUZZLE_RECONSTRUCT",
    ]
    assert by_id["PUZZLE_DRAWER"].grants_clue_ids == ["CLUE_LENS_NOTE"]
    assert by_id["PUZZLE_LENS"].completes_puzzle_ids == ["PUZZLE_FINALE"]
    assert by_id["PUZZLE_FINALE"].host_object_ids == []
    assert any("PUZZLE_FINALE" in w for w in report.warnings)
    omitted = {o.source_path: o.count for o in report.omissions}
    assert omitted["client.zones[].objects[].asset_key"] == 1
    assert omitted["server.clue_combinations[].clue_ids"] == 1
    assert "drawer_v1" not in canonical_json(pack)


# ── 6. 재현성 · 일관성 ────────────────────────────────────────
def test_same_input_same_output(lighthouse):
    first, second = _convert(lighthouse), _convert(lighthouse)
    assert canonical_json(first.pack) == canonical_json(second.pack)
    assert canonical_json(first.report) == canonical_json(second.report)


def test_formatting_does_not_change_hash(lighthouse, tmp_path):
    # 키 순서 · 들여쓰기 · CRLF 가 달라도 같은 내용이면 같은 해시와 같은 팩
    for kind, data in (("client", lighthouse.client), ("server", lighthouse.server)):
        text = json.dumps(
            dict(reversed(list(data.items()))), ensure_ascii=False, indent=4
        )
        (tmp_path / f"{LIGHTHOUSE}.{kind}.json").write_bytes(
            text.replace("\n", "\r\n").encode()
        )
    reformatted = load_case_sources(tmp_path, LIGHTHOUSE)
    assert canonical_json(_convert(reformatted).pack) == canonical_json(
        _convert(lighthouse).pack
    )
    assert canonical_sha256(reformatted.server) == canonical_sha256(lighthouse.server)


def test_content_change_changes_hash(lighthouse):
    server = copy.deepcopy(lighthouse.server)
    server["puzzles"][0]["accepted_answers"] = ["9999"]
    changed = convert_case(lighthouse.client, server, client_ref="x")
    assert (
        changed.pack.source.server_runtime_sha256
        != _convert(lighthouse).pack.source.server_runtime_sha256
    )


def test_converter_does_not_mutate_input(lighthouse):
    client, server = copy.deepcopy(lighthouse.client), copy.deepcopy(lighthouse.server)
    _convert(lighthouse)
    assert lighthouse.client == client and lighthouse.server == server


def test_no_absolute_paths_in_pack(lighthouse):
    text = canonical_json(_convert(lighthouse).pack)
    assert str(FIXTURE_CASES) not in text and ":\\" not in text


# ── CLI ───────────────────────────────────────────────────────
def test_cli_writes_pack_and_report(tmp_path, capsys):
    code = cli_main(
        [LIGHTHOUSE, "--cases-dir", str(FIXTURE_CASES), "--out-dir", str(tmp_path)]
    )
    assert code == 0
    pack = ScenarioPack.model_validate_json(
        (tmp_path / f"{LIGHTHOUSE}.scenario_pack.json").read_text(encoding="utf-8")
    )
    assert pack.publication.status == "draft"
    assert json.loads(capsys.readouterr().out)["leak_check"]["status"] == "passed"


def test_cli_leak_exit_code(tmp_path):
    code = cli_main(
        [
            LIGHTHOUSE,
            "--cases-dir",
            str(FIXTURE_CASES),
            "--alias",
            "Lens",
            "--out-dir",
            str(tmp_path),
        ]
    )
    assert code == 2
    assert not list(tmp_path.iterdir())  # 걸리면 아무 파일도 쓰지 않는다


def test_cli_bad_case_id():
    assert cli_main(["../etc", "--cases-dir", str(FIXTURE_CASES)]) == 1
