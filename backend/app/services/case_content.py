import json
from pathlib import Path

from pydantic import ValidationError

from app.schemas.case_content import CaseClientContent
from app.services.puzzle_runtime import CASE_ID_PATTERN, CASES_DIRECTORY


class CaseClientContentError(Exception):
    pass


class InvalidClientCaseIdError(CaseClientContentError):
    pass


class CaseClientContentNotFoundError(CaseClientContentError):
    pass


class CaseClientContentJSONDecodeError(CaseClientContentError):
    pass


class CaseClientContentValidationError(CaseClientContentError):
    pass


def load_case_client_content(case_id: str) -> CaseClientContent:
    content_path = _resolve_client_content_path(case_id)

    try:
        raw_content = content_path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise CaseClientContentNotFoundError(case_id) from error
    except UnicodeError as error:
        raise CaseClientContentJSONDecodeError(case_id) from error

    try:
        content_data = json.loads(raw_content)
    except json.JSONDecodeError as error:
        raise CaseClientContentJSONDecodeError(case_id) from error

    try:
        content = CaseClientContent.model_validate(content_data)
    except ValidationError as error:
        raise CaseClientContentValidationError(case_id) from error

    if content.case_id != case_id:
        raise CaseClientContentValidationError(case_id)
    return content


def _resolve_client_content_path(case_id: str) -> Path:
    if CASE_ID_PATTERN.fullmatch(case_id) is None:
        raise InvalidClientCaseIdError(case_id)

    cases_directory = CASES_DIRECTORY.resolve()
    content_path = (cases_directory / f"{case_id}.client.json").resolve()

    if not content_path.is_relative_to(cases_directory):
        raise InvalidClientCaseIdError(case_id)

    return content_path
