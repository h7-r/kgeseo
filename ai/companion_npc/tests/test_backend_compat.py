"""backend 원본 계약과 값이 같은지 — 한쪽만 바뀌면 여기서 깨진다.

backend 는 **읽기만** 한다. 스키마 모듈은 pydantic 만 import 하므로 DB 설정 없이 읽힌다.
.pyc 를 backend 폴더에 남기지 않으려고 bytecode 쓰기를 끈다.
"""

import json
import sys
import typing

import pytest
from conftest import BACKEND_DIR

from companion_npc.contracts import ScenarioPack, common
from companion_npc.contracts.spoiler import find_answer_leaks

pytestmark = pytest.mark.skipif(
    not (BACKEND_DIR / "app" / "schemas").is_dir(), reason="backend not found"
)

CASES = BACKEND_DIR / "app" / "content" / "cases"


@pytest.fixture(scope="module")
def backend_schemas():
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(BACKEND_DIR))
    try:
        from app.schemas import interaction, interaction_api, play_session

        yield interaction, interaction_api, play_session
    finally:
        sys.path.remove(str(BACKEND_DIR))


@pytest.fixture(scope="module")
def backend_content_schemas():
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(BACKEND_DIR))
    try:
        from app.schemas import case_content, puzzle_runtime

        yield case_content, puzzle_runtime
    finally:
        sys.path.remove(str(BACKEND_DIR))


def _values(literal) -> set:
    return set(typing.get_args(literal))


# ── P2-A 변환기 입력 모델 (adapters/source_models.py) ─────────────
MIRRORED = [
    ("case_content", name)
    for name in [
        "ObjectInteractionDefinition",
        "ObjectDefinition",
        "NavigationDefinition",
        "ZoneDefinition",
        "CaseClientContent",
    ]
] + [
    ("puzzle_runtime", name)
    for name in [
        "RuntimeEffect",
        "HintDefinition",
        "PuzzleDefinition",
        "ClueCombinationDefinition",
        "PuzzleRuntimeDefinition",
    ]
]


@pytest.mark.parametrize("module, name", MIRRORED)
def test_source_models_mirror_backend(backend_content_schemas, module, name):
    from companion_npc.adapters import source_models

    backend = dict(zip(["case_content", "puzzle_runtime"], backend_content_schemas))
    ours = getattr(source_models, name).model_fields
    theirs = getattr(backend[module], name).model_fields
    assert set(ours) == set(theirs)
    for field in ours:
        assert ours[field].is_required() == theirs[field].is_required(), field
        assert ours[field].metadata == theirs[field].metadata, field


def _accepts(model, data) -> bool:
    try:
        model.model_validate(data)
        return True
    except Exception:
        return False


@pytest.mark.parametrize(
    "mutate",
    [
        lambda c, s: None,
        lambda c, s: c.pop("entry_zone_id"),
        lambda c, s: c["zones"][0].update(extra="x"),
        lambda c, s: c["zones"][0]["objects"].append(dict(c["zones"][0]["objects"][0])),
        lambda c, s: c.update(entry_zone_id="ZONE_NOPE"),
        lambda c, s: s["puzzles"][0].update(accepted_answers=[]),
        lambda c, s: s["puzzles"].append(dict(s["puzzles"][0])),
        lambda c, s: s["puzzles"][0].update(extra="x"),
        lambda c, s: s["puzzles"][0]["on_correct"].pop("complete_puzzle_ids"),
        # server.json 정식 힌트 원문 (PM v0.4.2)
        lambda c, s: s["puzzles"][0].update(
            hints=[{"level": 1, "text": "h1"}, {"level": 2, "text": "h2"}]
        ),
        lambda c, s: s["puzzles"][0].update(
            hints=[{"level": 1, "text": "h1"}, {"level": 1, "text": "h1b"}]
        ),
        lambda c, s: s["puzzles"][0].update(hints=[{"level": 2, "text": "h2"}]),
        lambda c, s: s["puzzles"][0].update(hints=[{"level": 1, "text": " "}]),
        lambda c, s: s["puzzles"][0].update(hints=[{"level": True, "text": "h1"}]),
        lambda c, s: s["puzzles"][0].update(hints=[{"level": 1}]),
    ],
)
def test_source_models_accept_what_backend_accepts(backend_content_schemas, mutate):
    from companion_npc.adapters import source_models

    case_content, puzzle_runtime = backend_content_schemas
    client = json.loads((CASES / "case_001.client.json").read_text(encoding="utf-8"))
    server = json.loads((CASES / "case_001.server.json").read_text(encoding="utf-8"))
    mutate(client, server)
    assert _accepts(source_models.CaseClientContent, client) == _accepts(
        case_content.CaseClientContent, client
    )
    assert _accepts(source_models.PuzzleRuntimeDefinition, server) == _accepts(
        puzzle_runtime.PuzzleRuntimeDefinition, server
    )


def test_play_session_state_fields_match(backend_schemas):
    _, _, play_session = backend_schemas
    assert set(common.PlaySessionStateSnapshot.model_fields) == set(
        play_session.PlaySessionState.model_fields
    )


def test_interaction_literals_match(backend_schemas):
    _, interaction_api, _ = backend_schemas
    assert _values(common.InteractionAction) == _values(
        interaction_api.InteractionAction
    )
    assert _values(common.InteractionTargetType) == _values(
        interaction_api.InteractionTargetType
    )
    assert _values(common.ExternalInteractionResultType) == _values(
        interaction_api.ExternalInteractionResultType
    )


def test_state_change_types_match(backend_schemas):
    interaction, _, _ = backend_schemas
    backend_types = {
        typing.get_args(member.model_fields["type"].annotation)[0]
        for member in typing.get_args(
            typing.get_args(interaction.InteractionStateChange)[0]
        )
    }
    assert _values(common.StateChangeType) == backend_types


def test_case_001_pack_ids_exist_in_backend_content(pack_case_001):
    pack = ScenarioPack.model_validate(pack_case_001)
    client = json.loads((CASES / "case_001.client.json").read_text(encoding="utf-8"))
    server = json.loads((CASES / "case_001.server.json").read_text(encoding="utf-8"))

    assert pack.entry_zone_id == client["entry_zone_id"]
    backend_zones = {z["zone_id"] for z in client["zones"]}
    backend_objects = {o["object_id"] for z in client["zones"] for o in z["objects"]}
    backend_puzzles = {p["puzzle_id"] for p in server["puzzles"]}
    assert {z.zone_id for z in pack.zones} <= backend_zones
    assert {o.object_id for o in pack.objects} <= backend_objects
    assert {p.puzzle_id for p in pack.puzzles} <= backend_puzzles


def test_case_001_pack_does_not_leak_answers(pack_case_001):
    # 서버 쪽 검사의 흉내: 정답은 여기(테스트)에서만 읽고 팩에는 들어가지 않는다.
    server = json.loads((CASES / "case_001.server.json").read_text(encoding="utf-8"))
    answers = [a for p in server["puzzles"] for a in p["accepted_answers"]]
    aliases = ["밸브"]  # 사람이 정한 별칭 (spoiler.py 참조)
    pack = ScenarioPack.model_validate(pack_case_001)
    texts = {f"hint:{h.hint_id}": h.text for h in pack.hints}
    texts |= {f"chunk:{k.chunk_id}": k.text for k in pack.knowledge}
    assert find_answer_leaks(texts, answers + aliases) == []
    assert json.dumps(pack_case_001, ensure_ascii=False).find(answers[0]) == -1
