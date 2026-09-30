import json
import re
from pathlib import Path

from pydantic import ValidationError

from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition

CASES_DIRECTORY = Path(__file__).resolve().parents[1] / "content" / "cases"
CASE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class PuzzleRuntimeError(Exception):
    pass


class InvalidCaseIdError(PuzzleRuntimeError):
    pass


class CaseRuntimeNotFoundError(PuzzleRuntimeError):
    pass


class CaseRuntimeJSONDecodeError(PuzzleRuntimeError):
    pass


class CaseRuntimeValidationError(PuzzleRuntimeError):
    pass


def normalize_answer(value: str) -> str:
    return "".join(value.split()).casefold()


def load_case_runtime(case_id: str) -> PuzzleRuntimeDefinition:
    runtime_path = _resolve_runtime_path(case_id)

    try:
        raw_content = runtime_path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise CaseRuntimeNotFoundError(case_id) from error

    try:
        runtime_data = json.loads(raw_content)
    except json.JSONDecodeError as error:
        raise CaseRuntimeJSONDecodeError(case_id) from error

    try:
        return PuzzleRuntimeDefinition.model_validate(runtime_data)
    except ValidationError as error:
        raise CaseRuntimeValidationError(case_id) from error


def _resolve_runtime_path(case_id: str) -> Path:
    if CASE_ID_PATTERN.fullmatch(case_id) is None:
        raise InvalidCaseIdError(case_id)

    cases_directory = CASES_DIRECTORY.resolve()
    runtime_path = (cases_directory / f"{case_id}.server.json").resolve()

    if not runtime_path.is_relative_to(cases_directory):
        raise InvalidCaseIdError(case_id)

    return runtime_path
