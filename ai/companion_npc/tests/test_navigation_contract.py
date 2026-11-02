"""최신 backend navigation 규칙(문 Object 의 navigate 선언 등) — 런타임 Case 계약.

변환기 입력 모델(source_models.CaseClientContent)은 실험용 견본 Case 를 지키려고 이 규칙을
넣지 않았다. 대신 navigation_contract_violations() 가 같은 규칙을 따로 보고, 여기서
① backend 와 판정이 같은지 ② 런타임에 연결할 Case 가 규칙을 지키는지 ③ 예외로 둔 견본이
바뀌지 않았는지를 검사한다.

backend 는 **읽기만** 한다(test_backend_compat.py 와 같은 방식).
"""

import copy
import json
import sys

import pytest
from conftest import BACKEND_CASES, BACKEND_DIR, FIXTURE_CASES

from companion_npc.adapters import source_models
from companion_npc.adapters.case_content import canonical_sha256

needs_backend = pytest.mark.skipif(
    not (BACKEND_DIR / "app" / "schemas").is_dir(), reason="backend not found"
)

# 규칙이 생기기 전에 만든 실험용 견본. 돌아오는 문에 navigate 선언이 없다.
# 고치면 견본 해시에 묶인 합성 데이터 · 실험 입력 해시가 바뀌므로 그대로 둔다.
# 새 Case 는 이 목록에 넣지 않는다 — 런타임에 연결할 Case 는 규칙을 지켜야 한다.
LEGACY_NAVIGATION_EXEMPT = {
    "case_fixture_archive.client.json": (
        "8c767b3fcbc8f1d4f6f3a818744f3d162a1df8f722874a93fc63fab7c605777c"
    ),
    "case_fixture_lighthouse.client.json": (
        "ed288481c67bde63da0f946e40dafdd2bc11ad8e79eeae245e0e4e4983de5bc8"
    ),
}


def _read(path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _violations(client: dict) -> list[str]:
    return source_models.navigation_contract_violations(
        source_models.CaseClientContent.model_validate(client)
    )


def _runtime_case_files():
    files = sorted(FIXTURE_CASES.glob("*.client.json"))
    if BACKEND_CASES.is_dir():
        files += sorted(BACKEND_CASES.glob("*.client.json"))
    return [f for f in files if f.name not in LEGACY_NAVIGATION_EXEMPT]


@pytest.fixture(scope="module")
def backend_case_content():
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(BACKEND_DIR))
    try:
        from app.schemas import case_content

        yield case_content
    finally:
        sys.path.remove(str(BACKEND_DIR))


def _backend_accepts(case_content, client: dict) -> bool:
    try:
        case_content.CaseClientContent.model_validate(client)
        return True
    except Exception:
        return False


# ── ① backend 와 같은 판정 ─────────────────────────────────────
def _zone(zone_id: str, door_id: str, target_zone_id: str) -> dict:
    return {
        "zone_id": zone_id,
        "zone_name": zone_id,
        "zone_type": "room",
        "description": "",
        "objects": [
            {
                "object_id": door_id,
                "object_name": "door",
                "object_type": "door",
                "visible": True,
                "enabled": True,
                "interaction": {"type": "navigate", "target_id": target_zone_id},
            }
        ],
        "navigation": [{"door_object_id": door_id, "target_zone_id": target_zone_id}],
    }


def _two_zone_case() -> dict:
    """규칙을 지키는 최소 Case — 두 Zone 이 서로 navigate 문을 가진다(새 Case 의 본보기)."""

    return {
        "case_id": "case_navigation_contract",
        "entry_zone_id": "ZONE_A",
        "zones": [
            _zone("ZONE_A", "OBJ_DOOR_A", "ZONE_B"),
            _zone("ZONE_B", "OBJ_DOOR_B", "ZONE_A"),
        ],
    }


def _door(client: dict) -> tuple[dict, dict]:
    """첫 navigation 이 있는 Zone 과 그 문 Object."""

    zone = next(z for z in client["zones"] if z["navigation"])
    door_id = zone["navigation"][0]["door_object_id"]
    return zone, next(o for o in zone["objects"] if o["object_id"] == door_id)


def _self_target(c):
    zone, _ = _door(c)
    zone["navigation"][0]["target_zone_id"] = zone["zone_id"]


def _duplicate_navigation(c):
    zone, _ = _door(c)
    zone["navigation"].append(dict(zone["navigation"][0]))


def _door_without_navigate(c):
    _door(c)[1]["interaction"] = None


def _door_wrong_target(c):
    _door(c)[1]["interaction"]["target_id"] = c["entry_zone_id"] + "_OTHER"


def _unregistered_navigate(c):
    zone, door = _door(c)
    extra = copy.deepcopy(door)
    extra["object_id"] = door["object_id"] + "_SPARE"
    zone["objects"].append(extra)


MUTATIONS = [
    lambda c: None,
    _self_target,
    _duplicate_navigation,
    _door_without_navigate,
    _door_wrong_target,
    _unregistered_navigate,
]
MUTATION_IDS = [
    "unchanged",
    "self_target",
    "duplicate_navigation",
    "door_without_navigate",
    "door_wrong_target",
    "unregistered_navigate",
]


@needs_backend
@pytest.mark.parametrize("mutate", MUTATIONS, ids=MUTATION_IDS)
def test_navigation_rules_match_backend(backend_case_content, mutate):
    client = _two_zone_case()
    mutate(client)
    ours_ok = not _violations(client)
    assert ours_ok == _backend_accepts(backend_case_content, client)
    # 변형하지 않은 본보기만 통과해야 변형이 실제로 규칙을 건드린 것이다.
    assert ours_ok == (mutate is MUTATIONS[0])


@needs_backend
def test_legacy_fixtures_are_the_only_known_backend_rejections(backend_case_content):
    for name in LEGACY_NAVIGATION_EXEMPT:
        client = _read(FIXTURE_CASES / name)
        assert _violations(client)
        assert not _backend_accepts(backend_case_content, client)


# ── ② 런타임 Case 는 규칙을 지킨다 ─────────────────────────────
@pytest.mark.parametrize("path", _runtime_case_files(), ids=lambda p: p.name)
def test_runtime_cases_follow_navigation_contract(path):
    assert _violations(_read(path)) == []


# ── ③ 예외로 둔 견본은 바뀌지 않았다 ──────────────────────────
@pytest.mark.parametrize("name", sorted(LEGACY_NAVIGATION_EXEMPT))
def test_legacy_fixture_is_unchanged(name):
    expected = LEGACY_NAVIGATION_EXEMPT[name]
    assert canonical_sha256(_read(FIXTURE_CASES / name)) == expected


def test_violations_name_zone_ids_only():
    client = _read(FIXTURE_CASES / "case_fixture_lighthouse.client.json")
    for message in _violations(client):
        assert message.startswith("zone ZONE_")
        assert "OBJ_" not in message
