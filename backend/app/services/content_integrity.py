"""콘텐츠 무결성 도구 (런타임 미사용).

PlaySession · DB · 게임 판정에 쓰지 않는다. 콘텐츠 버전 정책이 정해지기 전에 쓸 수 있는
계산 · 점검만 담는다. 입력값(정답 등 비공개 내용)은 결과에 담지 않는다.

[해시 두 가지]
- 파일 해시 `file_sha256`: 파일 바이트 그대로의 SHA-256. 공백 · 줄바꿈(CRLF/LF) · 키 순서 ·
  BOM이 달라도 값이 바뀐다. "배포한 파일과 같은 파일인가"를 확인할 때 쓴다.
- 정규화 해시 `canonical_json_sha256`: JSON을 읽은 뒤 아래 규칙으로 다시 써서 해시한다.
  내용(값)이 같으면 서식이 달라도 같다. "같은 콘텐츠인가"를 확인할 때 쓴다.

[JSON 정규화 규칙]
1. 바이트를 UTF-8로 엄격히 읽는다(BOM 불허 — 콘텐츠 로더의 `read_text(encoding="utf-8")`와
   같아서, 로더가 못 읽는 파일은 여기서도 실패한다).
2. `NaN` · `Infinity` · `-Infinity`는 표준 JSON이 아니므로 거부한다.
3. 객체 키를 정렬하고(`sort_keys`), 구분자 공백을 없애고(`(",", ":")`), 한글 등은 이스케이프하지
   않고(`ensure_ascii=False`) UTF-8로 인코딩한다.
4. 배열 순서는 바꾸지 않는다(순서가 의미를 갖는 콘텐츠가 있다).

정규화로 사라지는 차이: 공백 · 줄바꿈 · 키 순서 · `\\uXXXX`와 같은 글자의 표기 차이.
정규화 후에도 남는 차이: 배열 순서, 숫자 형태(`1`과 `1.0`은 다르다), 문자열 내용.
같은 객체에 키가 중복되면 파서가 마지막 값만 남기므로 정규화 해시는 그 차이를 잃는다
(파일 해시는 다르다).
"""

import difflib
import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition, RuntimeEffect


def file_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _reject_constant(value: str) -> Any:
    raise ValueError(f"Non-standard JSON constant: {value}")


def canonical_json_bytes(content: bytes) -> bytes:
    data = json.loads(content.decode("utf-8"), parse_constant=_reject_constant)
    return json.dumps(
        data, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def canonical_json_sha256(content: bytes) -> str:
    return hashlib.sha256(canonical_json_bytes(content)).hexdigest()


def content_fingerprint(parts: Mapping[str, bytes]) -> str:
    """역할별 JSON(예: client · server · idmap)의 정규화 해시를 묶은 하나의 값.

    역할 이름과 각 정규화 해시를 정규화 JSON으로 만들어 해시한다. 역할 이름이 결과에 들어가므로
    같은 파일을 다른 역할로 넣으면 값이 다르다.
    """

    if not parts:
        raise ValueError("parts must not be empty")
    digests = {role: canonical_json_sha256(content) for role, content in parts.items()}
    summary = json.dumps(digests, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(summary).hexdigest()


CompletionReferenceKind = Literal["blank_id", "near_defined_puzzle", "marker_candidate"]


@dataclass(frozen=True)
class UndefinedCompletionReference:
    """정의되지 않은 퍼즐을 가리키는 `complete_puzzle_ids` 항목."""

    puzzle_id: str
    kind: CompletionReferenceKind
    # 이 ID를 참조한 효과 위치 (예: "Inspection 'INS_01' on_inspect")
    owners: tuple[str, ...]
    # 같은 효과 목록 안에서 두 번 이상 나온 위치
    duplicate_owners: tuple[str, ...]
    # kind="near_defined_puzzle"일 때 비슷한 정의 퍼즐 ID
    similar_to: str | None = None


def _effects(runtime: PuzzleRuntimeDefinition) -> list[tuple[str, RuntimeEffect]]:
    return [
        *(
            (f"Puzzle '{p.puzzle_id}' on_correct", p.on_correct)
            for p in runtime.puzzles
        ),
        *(
            (f"Inspection '{i.inspect_id}' on_inspect", i.on_inspect)
            for i in runtime.inspections
        ),
        *(
            (f"Combination '{c.combination_id}' on_success", c.on_success)
            for c in runtime.clue_combinations
        ),
    ]


def _similar_puzzle_id(puzzle_id: str, defined: list[str]) -> str | None:
    folded = {item.casefold(): item for item in defined}
    if puzzle_id.casefold() in folded:
        return folded[puzzle_id.casefold()]
    matches = difflib.get_close_matches(puzzle_id, defined, n=1, cutoff=0.85)
    return matches[0] if matches else None


def find_undefined_completion_references(
    runtime: PuzzleRuntimeDefinition,
) -> list[UndefinedCompletionReference]:
    """`complete_puzzle_ids`가 정의되지 않은 퍼즐을 가리키는 곳을 찾는다. 경고용이며 판정에 쓰지 않는다.

    분류(의도 여부는 콘텐츠 작성자가 판단한다):
    - blank_id: 빈 문자열 · 공백뿐인 ID
    - near_defined_puzzle: 정의된 퍼즐 ID와 대소문자만 다르거나 매우 비슷하다 → 오타 의심
    - marker_candidate: 그 밖 → 퍼즐 없이 완료만 표시하는 마커(예: 씬 완료)일 수 있다
    """

    defined = [puzzle.puzzle_id for puzzle in runtime.puzzles]
    defined_set = set(defined)
    owners: dict[str, list[str]] = {}
    duplicates: dict[str, list[str]] = {}

    for owner, effect in _effects(runtime):
        seen_here: set[str] = set()
        for puzzle_id in effect.complete_puzzle_ids:
            if puzzle_id in defined_set:
                continue
            if puzzle_id in seen_here:
                duplicates.setdefault(puzzle_id, []).append(owner)
                continue
            seen_here.add(puzzle_id)
            owners.setdefault(puzzle_id, []).append(owner)

    references: list[UndefinedCompletionReference] = []
    for puzzle_id, puzzle_owners in owners.items():
        similar = None
        kind: CompletionReferenceKind
        if not puzzle_id.strip():
            kind = "blank_id"
        else:
            similar = _similar_puzzle_id(puzzle_id, defined)
            kind = "near_defined_puzzle" if similar else "marker_candidate"
        references.append(
            UndefinedCompletionReference(
                puzzle_id=puzzle_id,
                kind=kind,
                owners=tuple(puzzle_owners),
                duplicate_owners=tuple(duplicates.get(puzzle_id, [])),
                similar_to=similar,
            )
        )
    return references


_KIND_LABELS: dict[CompletionReferenceKind, str] = {
    "blank_id": "빈 ID",
    "near_defined_puzzle": "정의된 퍼즐과 비슷함(오타 의심)",
    "marker_candidate": "정의 없는 완료 마커 후보",
}


def format_completion_reference_warnings(
    references: list[UndefinedCompletionReference],
) -> list[str]:
    lines: list[str] = []
    for reference in references:
        detail = _KIND_LABELS[reference.kind]
        if reference.similar_to is not None:
            detail += f" ← '{reference.similar_to}'"
        if reference.duplicate_owners:
            detail += f", 같은 효과 안 중복 {len(reference.duplicate_owners)}회"
        lines.append(
            f"[WARN] Server Runtime: complete_puzzle_ids → {reference.puzzle_id!r}"
            f" → {detail} → 참조 {len(reference.owners)}곳: {', '.join(reference.owners)}"
        )
    return lines
