"""Case 파일 한 쌍을 **읽기만** 한다.

경로 규칙은 backend services/case_content.py · puzzle_runtime.py 와 같다
(case_id 패턴 검사 + 결과 경로가 cases 폴더 밖으로 나가지 않는지 확인).
"""

import json
from dataclasses import dataclass
from pathlib import Path

from companion_npc.adapters.errors import (
    CaseFileDecodeError,
    CaseFileNotFoundError,
    InvalidCaseIdError,
)
from companion_npc.contracts.common import CASE_ID_PATTERN


@dataclass(frozen=True)
class CaseSources:
    case_id: str
    client: dict
    server: dict
    client_path: Path
    server_path: Path


def load_case_sources(cases_dir: Path, case_id: str) -> CaseSources:
    client_path = _resolve(cases_dir, case_id, "client")
    server_path = _resolve(cases_dir, case_id, "server")
    return CaseSources(
        case_id=case_id,
        client=_read_json(client_path),
        server=_read_json(server_path),
        client_path=client_path,
        server_path=server_path,
    )


def _resolve(cases_dir: Path, case_id: str, kind: str) -> Path:
    if CASE_ID_PATTERN.fullmatch(case_id) is None:
        raise InvalidCaseIdError(case_id)
    base = cases_dir.resolve()
    path = (base / f"{case_id}.{kind}.json").resolve()
    if not path.is_relative_to(base):
        raise InvalidCaseIdError(case_id)
    return path


def _read_json(path: Path) -> dict:
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise CaseFileNotFoundError(path.name) from error
    except UnicodeError as error:
        raise CaseFileDecodeError(f"{path.name}: not UTF-8") from error
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        # 위치만 남긴다. error.msg 에는 값이 없지만 doc 전문은 담지 않는다.
        raise CaseFileDecodeError(
            f"{path.name}: invalid JSON at line {error.lineno}"
        ) from error
    if not isinstance(data, dict):
        raise CaseFileDecodeError(f"{path.name}: top level must be an object")
    return data
