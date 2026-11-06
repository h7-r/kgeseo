"""FE 진행 동기화(naju01/src/progress/progressSync.ts) 실서버 통합 검증용 가상 케이스를 게시 루트에 쓴다.

    .\\.venv\\Scripts\\python.exe -m scripts.it_progress_sync_case <게시 루트>

- 실제 나주 콘텐츠가 아니다. 케이스 ID · Zone · Object · 퍼즐 · 정답 · 대사는 전부 가상 값이다.
- 파일만 쓴다(DB 접속 없음). 승인 · 게시는 기존 CLI(`record_gate_review` · `publish_case_content`)로 격리 DB에만 한다.
- 출력은 fingerprint 한 줄이다(정답 · 힌트 원문을 출력하지 않는다).

구성(FE 테스트가 기대하는 모양):
    ZONE_IT_A(입구) ─ OBJ_IT_A_DOOR ↔ OBJ_IT_B_DOOR ─ ZONE_IT_B
    ZONE_IT_A: OBJ_IT_SKILL (complete → PZ_IT_SKILL, solve.mode client_skill)
    ZONE_IT_B: OBJ_IT_LOCK  (input    → PZ_IT_INPUT, PZ_IT_SKILL 선행)
               OBJ_IT_DIAL  (select   → PZ_IT_SELECT)
    case_completion: PZ_IT_SKILL · PZ_IT_INPUT · PZ_IT_SELECT
    npc: PZ_IT_INPUT nudge 는 PZ_IT_SKILL 완료 뒤에만 공개, 힌트 1 · 2단계
"""

import json
import sys
from pathlib import Path
from typing import Any

from app.services.content_fingerprint import compute_content_fingerprint

CASE_ID = "progress_sync_it"
VERSION = 1


def _obj(object_id: str, name: str, kind: str, target: str) -> dict[str, Any]:
    return {
        "object_id": object_id,
        "object_name": name,
        "object_type": "prop",
        "visible": True,
        "enabled": True,
        "interaction": {"type": kind, "target_id": target},
    }


def documents() -> dict[str, dict[str, Any]]:
    client = {
        "case_id": CASE_ID,
        "entry_zone_id": "ZONE_IT_A",
        "zones": [
            {
                "zone_id": "ZONE_IT_A",
                "zone_name": "가상 마당",
                "zone_type": "room",
                "description": "(가상) 통합 검증용 입구",
                "objects": [
                    _obj("OBJ_IT_A_DOOR", "가상 문", "navigate", "ZONE_IT_B"),
                    _obj("OBJ_IT_SKILL", "가상 물레", "complete", "PZ_IT_SKILL"),
                ],
                "navigation": [
                    {"door_object_id": "OBJ_IT_A_DOOR", "target_zone_id": "ZONE_IT_B"}
                ],
            },
            {
                "zone_id": "ZONE_IT_B",
                "zone_name": "가상 창고",
                "zone_type": "room",
                "description": "(가상) 통합 검증용 안쪽",
                "objects": [
                    _obj("OBJ_IT_B_DOOR", "가상 뒷문", "navigate", "ZONE_IT_A"),
                    _obj("OBJ_IT_LOCK", "가상 자물쇠", "input", "PZ_IT_INPUT"),
                    _obj("OBJ_IT_DIAL", "가상 문양판", "select", "PZ_IT_SELECT"),
                ],
                "navigation": [
                    {"door_object_id": "OBJ_IT_B_DOOR", "target_zone_id": "ZONE_IT_A"}
                ],
            },
        ],
        "content_version": VERSION,
    }
    hints = lambda name: [  # noqa: E731
        {"level": 1, "text": f"(가상) {name} 1단계 힌트"},
        {"level": 2, "text": f"(가상) {name} 2단계 힌트"},
    ]
    server = {
        "schema_version": "0.1",
        "case_id": CASE_ID,
        "puzzles": [
            {
                "puzzle_id": "PZ_IT_SKILL",
                "solve": {"mode": "client_skill"},
                "on_correct": {
                    "grant_clue_ids": ["CLUE_IT_SKILL"],
                    "set_flags": {"it_skill_done": True},
                },
            },
            {
                "puzzle_id": "PZ_IT_INPUT",
                "accepted_answers": ["가상답"],
                "requires_puzzle_ids": ["PZ_IT_SKILL"],
                "on_correct": {"grant_clue_ids": ["CLUE_IT_INPUT"], "set_flags": {}},
                "hints": hints("자물쇠"),
            },
            {
                "puzzle_id": "PZ_IT_SELECT",
                "accepted_answers": ["CHOICE_IT_B"],
                "on_correct": {"grant_clue_ids": [], "set_flags": {}},
                "hints": hints("문양판"),
            },
        ],
        "clue_combinations": [],
        "inspections": [],
        "clues": [
            {"clue_id": "CLUE_IT_SKILL", "title": "(가상) 물레 자국"},
            {"clue_id": "CLUE_IT_INPUT", "title": "(가상) 자물쇠 조각"},
        ],
        "case_completion": {
            "requires_puzzle_ids": ["PZ_IT_SKILL", "PZ_IT_INPUT", "PZ_IT_SELECT"]
        },
        "content_version": VERSION,
    }
    npc = {
        "schema_version": "npc-pack 0.1",
        "case_id": CASE_ID,
        "npc_id": "NPC_COMPANION",
        "proper_nouns": [],
        "ng": [],
        "open": [],
        "status": "published",
        "approvals": [],
        "generated_at": "2026-11-05T00:00:00Z",
        "general_nudges": [
            {
                "line_id": "NUDGE_IT_LOOK",
                "text": "(가상) 천천히 둘러보자.",
                "reveal_when": {"always": True},
            }
        ],
        "puzzles": [
            {
                "puzzle_id": "PZ_IT_INPUT",
                "nudges": [
                    {
                        "line_id": "NUDGE_IT_LOCK",
                        "text": "(가상) 물레를 돌린 뒤라 자물쇠가 달라 보인다.",
                        "reveal_when": {"puzzle_completed": "PZ_IT_SKILL"},
                    }
                ],
                "hints": [{"level": 1}, {"level": 2}],
            },
            {
                "puzzle_id": "PZ_IT_SELECT",
                "nudges": [
                    {
                        "line_id": "NUDGE_IT_DIAL",
                        "text": "(가상) 문양판 무늬를 하나씩 보자.",
                        "reveal_when": {"always": True},
                    }
                ],
                "hints": [{"level": 1}, {"level": 2}],
            },
        ],
        "content_version": VERSION,
    }
    return {"client": client, "server": server, "npc": npc}


def _encode(docs: dict[str, dict[str, Any]]) -> dict[str, bytes]:
    return {
        role: json.dumps(doc, ensure_ascii=False).encode("utf-8")
        for role, doc in docs.items()
    }


def write(root: Path) -> str:
    docs = documents()
    fingerprint = compute_content_fingerprint(**_encode(docs))
    for doc in docs.values():
        doc["content_fingerprint"] = fingerprint
    directory = root / CASE_ID / f"v{VERSION}"
    directory.mkdir(parents=True, exist_ok=True)
    for role, content in _encode(docs).items():
        (directory / f"{role}.json").write_bytes(content)
    return fingerprint


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(
            "usage: python -m scripts.it_progress_sync_case <content-root>",
            file=sys.stderr,
        )
        sys.exit(1)
    print(write(Path(sys.argv[1])))
