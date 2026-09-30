import argparse
import sys

from app.services.case_content import CaseClientContentError, load_case_client_content
from app.services.case_content_validation import (
    CaseContentLinkValidationError,
    validate_case_content_links,
)
from app.services.puzzle_runtime import PuzzleRuntimeError, load_case_runtime


def _report_failure(stage: str, case_id: str, error: Exception) -> int:
    print(f"[FAIL] {stage}: {type(error).__name__}", file=sys.stderr)
    if isinstance(error, CaseContentLinkValidationError):
        print(str(error), file=sys.stderr)
    print(f"Case {case_id!r}: INVALID", file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate a Case content pair.")
    parser.add_argument("case_id")
    case_id = parser.parse_args(argv).case_id

    try:
        client_content = load_case_client_content(case_id)
    except CaseClientContentError as error:
        return _report_failure("Client Content Schema", case_id, error)
    print("[OK] Client Content Schema")

    try:
        server_runtime = load_case_runtime(case_id)
    except PuzzleRuntimeError as error:
        return _report_failure("Server Runtime Schema", case_id, error)
    print("[OK] Server Runtime Schema")

    try:
        validate_case_content_links(client_content, server_runtime)
    except CaseContentLinkValidationError as error:
        return _report_failure("Client-Server Links", case_id, error)
    print("[OK] Client-Server Links")
    print(f"Case {case_id!r}: VALID")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
