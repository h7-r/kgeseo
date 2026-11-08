"""나주(앙암바위) content_version 1 게시 후보 묶음 만들기 — 승인 · 게시는 하지 않는다.

    .\\.venv\\Scripts\\python.exe -m scripts.build_naju_content_v1 \\
        --answers <비공개 정답 JSON(Git 밖)> --out <게시 루트(Git 밖)> \\
        [--situations-out <상황 대사 v2 초안 JSON>]

- 근거: `docs/naju/나주_ID대응표_v1_1108.md`(v1.1) · `docs/naju/나주_퍼즐_대응표_1105.md` ·
  10/27 idmap 초안(`naju-angam-01.idmap.draft.json`) · NPC 대사 초안(`naju-angam-01.npc-lines.draft.json`).
- 서버 연결 범위(v1.1 §2 · §6): P01 · P03 · P07 · P09 + 비석 inspect. 나머지 퍼즐은 넣지 않는다(화면 판정 유지).
  P09 서버 선행은 P07 완료만. 아이템(톱니돌 · 뜬 돌)은 서버가 모르므로 소비 조건에 넣지 않는다.
- 정답은 이 파일에 없다. `--answers`(공개 저장소 밖)에서 읽고, 출력 · 오류에 싣지 않는다.
- 10/27 초안의 Zone · 배치 소품 · 이동 · 차단물 · 보내지 않는 항목 ID는 그대로 싣는다. 생성본 퍼즐(PUZZLE_ANGAM_*)과
  그 단서는 v1.1 §7에 따라 싣지 않는다. 걸음 focus Object(v1.1 §4 · §8)는 서버 상호작용 인스턴스가 없으므로
  `object_groups_without_instances`에 ID만 예약한다.
- 장면(`scenes[].clear_when`)과 NPC 검수 목록(`proper_nouns` · `ng` · `open`)은 공식 근거가 없어 비워 둔다
  — 게시 게이트가 SCENES UNVERIFIED · POLICY_DATA FAIL · NG UNVERIFIED로 막는다(지어내지 않는다).
- 상황 대사(`situations[]`)는 계약 v0.4.16(PR #54) 전의 BE가 읽지 못하므로 v1 묶음에 넣지 않고 따로 만든다.
- 파일의 `status`는 `draft`다. 승인 · 게시 상태는 승인 기록 · 게시 절차만 만든다(파일 값은 판정에 쓰지 않는다).
"""

import argparse
import itertools
import json
import sys
from collections.abc import Mapping, Sequence
from copy import deepcopy
from pathlib import Path
from typing import Any

from app.services.content_fingerprint import compute_content_fingerprint

CASE_ID = "naju-angam-01"
CONTENT_VERSION = 1
ROLES = ("client", "server", "npc", "idmap")
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_IDMAP_DRAFT = REPO_ROOT / "docs" / "naju" / "naju-angam-01.idmap.draft.json"
DEFAULT_NPC_LINES = REPO_ROOT / "docs" / "naju" / "naju-angam-01.npc-lines.draft.json"

NPC_ID = "NPC_COMPANION"
ENTRY_ZONE_ID = "ZONE_FERRY_TERRACE"
# v1.1 §1. 10/27 초안 4개 + 물굴 2개(범위는 FE naju01/src/puzzles/cave/caveState.ts HALL · INNER).
CAVE_ZONES = (
    {
        "local": "cave-hall",
        "zone_id": "ZONE_RIVER_CAVE_HALL",
        "name": "물굴 큰 방(P07 · P08 · P09)",
        "x_m": [36, 54],
        "z_m": [58, 74],
    },
    {
        "local": "cave-inner",
        "zone_id": "ZONE_RIVER_CAVE_INNER",
        "name": "물굴 석실(P10) — 경계 물레 고리문 z74",
        "x_m": [40, 50],
        "z_m": [76, 88],
    },
)
ZONE_TYPES = {"ZONE_RIVER_CAVE_HALL": "cave", "ZONE_RIVER_CAVE_INNER": "cave"}

TABLET_INSPECT_ID = "INSPECT_CAVE_TABLET"
# v1.1 §2 · §3 · §6. at_m 는 FE 자리(DIG_SPOT · JAR_SITE · LIGHT_BIG · DOOR · TABLET).
V1_OBJECTS = (
    {
        "local": "clam-holes",
        "object_id": "OBJ_S1_CLAM_HOLES",
        "name": "조개 숨구멍",
        "zone": "Z1",
        "type": "input",
        "target": "P01",
        "at_m": [14.4, 42.0],
    },
    {
        "local": "jar-slots",
        "object_id": "OBJ_S1_JAR_SLOTS",
        "name": "장독대 자리",
        "zone": "Z2",
        "type": "input",
        "target": "P03",
        "at_m": [41.5, 31.9],
    },
    {
        "local": "cave-big-clam",
        "object_id": "OBJ_S1_CAVE_BIG_CLAM",
        "name": "큰 조개",
        "zone": "cave-hall",
        "type": "complete",
        "target": "P07",
        "at_m": [48.2, 68.5],
    },
    {
        "local": "cave-door",
        "object_id": "OBJ_S1_CAVE_RING_DOOR",
        "name": "물레 고리문",
        "zone": "cave-hall",
        "type": "input",
        "target": "P09",
        "at_m": [45.0, 74.0],
    },
    {
        "local": "cave-tablet",
        "object_id": "OBJ_S1_CAVE_TABLET",
        "name": "비석",
        "zone": "cave-hall",
        "type": "inspect",
        "target": TABLET_INSPECT_ID,
        "at_m": [41.65, 73.64],
    },
)
V1_PUZZLES = (
    ("P01", "clam-holes", "조개 숨구멍 캐기"),
    ("P03", "jar-slots", "소리로 항아리 맞추기"),
    ("P07", "cave-big-clam", "조개 진주 빛 잇기"),
    ("P09", "cave-door", "물레 고리 숫자"),
)
# 1105 대응표: P01~P09 는 씬 1. 초안의 씬 1(local 1) 장면 ID를 쓴다(생성 장면 = 나주 씬 번호 가정 🟡).
V1_SCENE_LOCAL = 1
# v1.1 §4 걸음 focus — (걸음, 로컬, 런타임). S1_FIRE(OBJ_S1_BONFIRE_0)는 초안 objects 에 이미 있다.
STEP_FOCUS = (
    ("S1_FIRE", "씬1.화톳불#0", "OBJ_S1_BONFIRE_0"),
    ("S1_SMOKE", "smoke-arrow", "OBJ_S1_SMOKE_ARROW"),
    ("S2_BOTTLE", "boat-bottle-intact", "OBJ_S1_MAKGEOLLI_BOTTLE"),
    ("S2_OFFER", "ritual-table", "OBJ_S1_RITUAL_TABLE"),
    ("S2_STONES", "float-stone-0", "OBJ_S1_FLOAT_STONES"),
    ("S2_ENTER", "river-entrance", "OBJ_S1_RIVER_ENTRANCE"),
    ("C_JAR", "cave-jar", "OBJ_S1_CAVE_JAR"),
    ("C_SOCKET", "cave-socket", "OBJ_S1_CAVE_SOCKET"),
    ("S3_GO", "ridge-path", "OBJ_S2_RIDGE_PATH"),
    ("S3_SCALE", "ridge-fossil", "OBJ_S2_TEAR_FOSSIL"),
    ("S3_KEY", "ridge-box-lock", "OBJ_S2_LOCKED_BOX"),
    ("S3_RIFT", "rift-entry", "OBJ_S2_TIME_RIFT"),
)
VIRTUAL_FOCUS_LOCALS = frozenset({"smoke-arrow", "river-entrance", "ridge-path"})
# v1.1 §1 잡담 구역. cave 는 잡담을 보내지 않는다(§10-5).
QUIET_ZONE_IDS = {
    "dock": "ZONE_FERRY_TERRACE",
    "rock": "ZONE_GRAVEL_BEACH",
    "ridge": "ZONE_JINBU_RIDGE",
}
NUDGE_TONE = "polite"  # 대사 초안의 베타 한 벌
ALWAYS = {"always": True}


class BuildError(ValueError):
    """입력이 계약을 어겼다. 메시지에는 정답 값을 싣지 않는다."""


def _effect() -> dict[str, Any]:
    return {"grant_clue_ids": [], "set_flags": {}}


def p01_accepted_answers(hole_count: int, clam_holes: Sequence[int]) -> list[str]:
    """P01 은 판 구멍 전부를 보낸다(clamAnswer). 조개 구멍을 모두 팠으면 다른 구멍을 더 팠어도 완료다
    (clamLocalJudge). 그래서 조개 구멍을 모두 담은 모든 구멍 묶음을 정답으로 적는다."""

    holes = list(clam_holes)
    if (
        not isinstance(hole_count, int)
        or hole_count < 1
        or not holes
        or len(set(holes)) != len(holes)
        or not all(isinstance(h, int) and 0 <= h < hole_count for h in holes)
    ):
        raise BuildError("P01 answer source is invalid")
    others = [hole for hole in range(hole_count) if hole not in holes]
    answers = []
    for size in range(len(others) + 1):
        for extra in itertools.combinations(others, size):
            answers.append(",".join(str(h) for h in sorted([*holes, *extra])))
    return answers


def _accepted(answers: Mapping[str, Any], puzzle_id: str) -> list[str]:
    values = (answers.get(puzzle_id) or {}).get("accepted_answers")
    if (
        not isinstance(values, list)
        or not values
        or not all(isinstance(v, str) and v.strip() for v in values)
    ):
        raise BuildError(f"{puzzle_id} accepted_answers missing")
    return list(values)


def build_server(answers: Mapping[str, Any]) -> dict[str, Any]:
    p01 = answers.get("P01") or {}
    return {
        "schema_version": "0.1",
        "case_id": CASE_ID,
        "puzzles": [
            {
                "puzzle_id": "P01",
                "accepted_answers": p01_accepted_answers(
                    p01.get("hole_count"), p01.get("clam_holes") or []
                ),
                "on_correct": _effect(),
            },
            {
                "puzzle_id": "P03",
                "accepted_answers": _accepted(answers, "P03"),
                "on_correct": _effect(),
            },
            {
                "puzzle_id": "P07",
                "solve": {"mode": "client_skill"},
                "on_correct": _effect(),
            },
            {
                "puzzle_id": "P09",
                "accepted_answers": _accepted(answers, "P09"),
                # v1.1 §6: 서버 선행은 P07 완료만(P08 · 톱니돌 개수는 넣지 않는다)
                "requires_puzzle_ids": ["P07"],
                "on_correct": _effect(),
            },
        ],
        "clue_combinations": [],
        "inspections": [{"inspect_id": TABLET_INSPECT_ID, "on_inspect": _effect()}],
        "clues": [],
    }


def _zone_list(idmap_draft: Mapping[str, Any]) -> list[dict[str, Any]]:
    zones = [deepcopy(zone) for zone in idmap_draft["zones"]]
    known = {zone["zone_id"] for zone in zones}
    zones += [deepcopy(zone) for zone in CAVE_ZONES if zone["zone_id"] not in known]
    return zones


def build_client(idmap_draft: Mapping[str, Any]) -> dict[str, Any]:
    zones = _zone_list(idmap_draft)
    local_to_zone = {zone["local"]: zone["zone_id"] for zone in zones}
    objects: dict[str, list[dict[str, Any]]] = {zone["zone_id"]: [] for zone in zones}
    # 10/27 초안의 배치 소품(상호작용 없음). idmap 교차 검사가 Client 에 있을 것을 요구한다.
    for item in idmap_draft["objects"]:
        name = item["local"].split(".", 1)[-1].split("#", 1)[0]
        objects[item["zone_id"]].append(
            {
                "object_id": item["object_id"],
                "object_name": name,
                "object_type": "prop",
                "visible": True,
                "enabled": True,
                "interaction": None,
            }
        )
    for item in V1_OBJECTS:
        objects[local_to_zone[item["zone"]]].append(
            {
                "object_id": item["object_id"],
                "object_name": item["name"],
                "object_type": "clue" if item["type"] == "inspect" else "puzzle",
                "visible": True,
                "enabled": True,
                "interaction": {"type": item["type"], "target_id": item["target"]},
            }
        )
    return {
        "case_id": CASE_ID,
        "entry_zone_id": ENTRY_ZONE_ID,
        "zones": [
            {
                "zone_id": zone["zone_id"],
                "zone_name": zone["name"],
                "zone_type": ZONE_TYPES.get(zone["zone_id"], "outdoor"),
                "description": zone["name"],
                "objects": objects[zone["zone_id"]],
                # 공식 문 Object ID 가 없어 이동(navigate)은 싣지 않는다 — 보고서의 차단 요소 참조
                "navigation": [],
            }
            for zone in zones
        ],
    }


def build_idmap(idmap_draft: Mapping[str, Any]) -> dict[str, Any]:
    zones = _zone_list(idmap_draft)
    local_to_zone = {zone["local"]: zone["zone_id"] for zone in zones}
    scene_id = next(
        scene["scene_id"]
        for scene in idmap_draft["scenes"]
        if scene["local"] == V1_SCENE_LOCAL
    )
    objects = [deepcopy(item) for item in idmap_draft["objects"]]
    objects += [
        {
            "local": item["local"],
            "object_id": item["object_id"],
            "scene": V1_SCENE_LOCAL,
            "zone": item["zone"],
            "zone_id": local_to_zone[item["zone"]],
            "status": "placed",
            "interaction": {"type": item["type"]},
            "at_m": list(item["at_m"]),
        }
        for item in V1_OBJECTS
    ]
    existing = {item["object_id"] for item in objects}
    groups = [
        deepcopy(group) for group in idmap_draft["object_groups_without_instances"]
    ]
    for step, local, object_id in STEP_FOCUS:
        if object_id in existing:
            continue  # OBJ_S1_BONFIRE_0 — 초안에 이미 있다(중복 생성하지 않는다)
        kind = (
            "가상(화면 상호작용 없음)"
            if local in VIRTUAL_FOCUS_LOCALS
            else "서버 상호작용 없음(v1)"
        )
        groups.append(
            {
                "local_group": local,
                "object_id_base": object_id,
                "note": f"걸음 {step} focus_object_id 전용 — {kind}. v1.1 §4 · §8",
            }
        )
    return {
        "schema": "naju-idmap/0.1",
        "case_id": CASE_ID,
        "status": "draft",
        "local_source": {
            **idmap_draft["local_source"],
            "v1_table": "docs/naju/나주_ID대응표_v1_1108.md (v1.1)",
        },
        "rules": deepcopy(idmap_draft["rules"]),
        "zones": zones,
        "scenes": deepcopy(idmap_draft["scenes"]),
        "navigation": deepcopy(idmap_draft["navigation"]),
        "blockers": deepcopy(idmap_draft["blockers"]),
        "objects": objects,
        "object_groups_without_instances": groups,
        "puzzles": [
            {
                "local": local,
                "puzzle_id": puzzle_id,
                "scene_id": scene_id,
                "src_id": puzzle_id,
                "status": "placed",
                "title": title,
                "note": "v1.1 §2 서버 연결(v1)",
            }
            for puzzle_id, local, title in V1_PUZZLES
        ],
        "clues": [],
        "not_mapped": deepcopy(idmap_draft["not_mapped"]),
    }


def _lines(npc_lines: Mapping[str, Any], category: str) -> list[Mapping[str, Any]]:
    return [
        line
        for line in npc_lines["lines"]
        if line["category"] == category and line["tone"] == NUDGE_TONE
    ]


def build_npc(npc_lines: Mapping[str, Any]) -> dict[str, Any]:
    puzzles = []
    for puzzle_id, _, _ in V1_PUZZLES:
        nudges = [
            {"line_id": line["line_id"], "text": line["text"], "reveal_when": ALWAYS}
            for line in _lines(npc_lines, "퍼즐 넛지")
            if line["puzzle_id"] == puzzle_id
        ]
        if nudges:
            puzzles.append({"puzzle_id": puzzle_id, "nudges": nudges})
    # proper_nouns · ng · open 은 검수 근거가 없어 싣지 않는다(빈 배열은 「검수했고 없음」이라는 뜻이다).
    return {
        "schema_version": "npc-pack 0.1",
        "case_id": CASE_ID,
        "npc_id": NPC_ID,
        "status": "draft",
        "general_nudges": [],
        "puzzles": puzzles,
    }


def build_situations_draft(npc_lines: Mapping[str, Any]) -> dict[str, Any]:
    """계약 v0.4.16(PR #54 배포 뒤) content_version 2 에 합칠 상황 대사 · 구역 잡담. v1 묶음에는 넣지 않는다."""

    focus_ids = {step: object_id for step, _, object_id in STEP_FOCUS}
    by_code: dict[str, list[dict[str, Any]]] = {}
    for line in _lines(npc_lines, "상황 대사"):
        entry: dict[str, Any] = {"line_id": line["line_id"], "text": line["text"]}
        if line["step"] is not None:
            entry["focus_object_id"] = focus_ids[line["step"]]
        by_code.setdefault(line["situation_code"], []).append(entry)
    quiet = []
    skipped_cave = []
    for category in ("일반 잡담", "나주 잡담"):
        for line in _lines(npc_lines, category):
            zone = line["zone"]
            if zone == "cave":
                skipped_cave.append(line["line_id"])
                continue
            entry = {
                "line_id": line["line_id"],
                "text": line["text"],
                "reveal_when": ALWAYS,
            }
            if zone is not None:
                entry["zone_id"] = QUIET_ZONE_IDS[zone]
            quiet.append(entry)
    return {
        "_note": "v1 묶음에 넣지 않는다. PR #54(계약 v0.4.16) 운영 배포 뒤 content_version 2 의 npc.json 에 "
        "situations · general_nudges 로 합친다. 원문은 G3 승인 대기.",
        "situations": [
            {"code": code, "lines": lines} for code, lines in by_code.items()
        ],
        "general_nudges": quiet,
        "skipped_cave_quiet_line_ids": skipped_cave,
    }


def build_documents(
    answers: Mapping[str, Any],
    idmap_draft: Mapping[str, Any],
    npc_lines: Mapping[str, Any],
) -> dict[str, dict[str, Any]]:
    documents = {
        "client": build_client(idmap_draft),
        "server": build_server(answers),
        "npc": build_npc(npc_lines),
        "idmap": build_idmap(idmap_draft),
    }
    for document in documents.values():
        document["case_id"] = CASE_ID
        document["content_version"] = CONTENT_VERSION
    return documents


def _encode(document: Mapping[str, Any]) -> bytes:
    return (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def seal(documents: Mapping[str, dict[str, Any]]) -> tuple[dict[str, bytes], str]:
    """머리 필드를 뺀 본문으로 공식 fingerprint 를 계산하고 각 파일 머리에 적는다."""

    fingerprint = compute_content_fingerprint(
        **{role: _encode(documents[role]) for role in ROLES}
    )
    sealed = {}
    for role in ROLES:
        document = dict(documents[role])
        document["content_fingerprint"] = fingerprint
        sealed[role] = _encode(document)
    return sealed, fingerprint


def write_bundle(root: Path, files: Mapping[str, bytes]) -> Path:
    directory = root / CASE_ID / f"v{CONTENT_VERSION}"
    directory.mkdir(parents=True, exist_ok=True)
    for role in ROLES:
        (directory / f"{role}.json").write_bytes(files[role])
    return directory


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise BuildError(f"{label} not readable: {type(error).__name__}") from error


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--answers", required=True, help="비공개 정답 JSON(Git 밖)")
    parser.add_argument("--out", required=True, help="게시 루트(Git 밖)")
    parser.add_argument("--idmap-draft", default=str(DEFAULT_IDMAP_DRAFT))
    parser.add_argument("--npc-lines", default=str(DEFAULT_NPC_LINES))
    parser.add_argument("--situations-out", default=None)
    args = parser.parse_args(argv)
    try:
        out = Path(args.out).resolve()
        if out.is_relative_to(REPO_ROOT):
            raise BuildError(
                "--out must be outside the repository (answers are private)"
            )
        documents = build_documents(
            _read_json(Path(args.answers), "answers"),
            _read_json(Path(args.idmap_draft), "idmap draft"),
            _read_json(Path(args.npc_lines), "npc lines"),
        )
        files, fingerprint = seal(documents)
    except BuildError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    directory = write_bundle(out, files)
    print(f"bundle={CASE_ID}@v{CONTENT_VERSION} dir={directory}")
    print(f"content_fingerprint={fingerprint}")
    if args.situations_out:
        path = Path(args.situations_out)
        path.write_bytes(
            _encode(
                build_situations_draft(_read_json(Path(args.npc_lines), "npc lines"))
            )
        )
        print(f"situations_draft={path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
