import argparse
import json
import sys

from pydantic import ValidationError

from app.services.case_content import CaseClientContentError, load_case_client_content
from app.services.case_content_validation import (
    CaseContentLinkValidationError,
    validate_case_content_links,
)
from app.services.content_integrity import (
    find_undefined_completion_references,
    format_completion_reference_warnings,
)
from app.services.puzzle_runtime import PuzzleRuntimeError, load_case_runtime


def _failure_details(file_name: str, error: Exception) -> list[str]:
    """원인 예외에서 파일·경로·오류 종류·메시지를 꺼낸다.

    입력값은 출력하지 않는다. Server 콘텐츠에는 정답 같은 비공개 값이 들어 있다.
    """
    cause = error.__cause__
    if isinstance(cause, ValidationError):
        return [
            f"{file_name} → {'.'.join(str(part) for part in item['loc']) or '(root)'}"
            f" → {item['type']} → {item['msg']}"
            for item in cause.errors()
        ]
    if isinstance(cause, json.JSONDecodeError):
        return [
            f"{file_name} → line {cause.lineno}, column {cause.colno}"
            f" → json_invalid → {cause.msg}"
        ]
    return []


def _print_error(line: str) -> None:
    # 콘솔·파이프 인코딩이 '→'나 한글을 표현하지 못해도 Traceback 없이 출력한다.
    try:
        print(line, file=sys.stderr)
    except UnicodeEncodeError:
        encoding = sys.stderr.encoding or "ascii"
        safe = line.encode(encoding, "backslashreplace").decode(encoding)
        print(safe, file=sys.stderr)


def _print_line(line: str) -> None:
    try:
        print(line)
    except UnicodeEncodeError:
        encoding = sys.stdout.encoding or "ascii"
        print(line.encode(encoding, "backslashreplace").decode(encoding))


def _report_failure(
    stage: str,
    case_id: str,
    error: Exception,
    file_name: str | None = None,
) -> int:
    print(f"[FAIL] {stage}: {type(error).__name__}", file=sys.stderr)
    if isinstance(error, CaseContentLinkValidationError):
        print(str(error), file=sys.stderr)
    if file_name is not None:
        for line in _failure_details(file_name, error):
            _print_error(line)
    print(f"Case {case_id!r}: INVALID", file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate a Case content pair.")
    parser.add_argument("case_id")
    case_id = parser.parse_args(argv).case_id

    try:
        client_content = load_case_client_content(case_id)
    except CaseClientContentError as error:
        return _report_failure(
            "Client Content Schema", case_id, error, f"{case_id}.client.json"
        )
    print("[OK] Client Content Schema")

    try:
        server_runtime = load_case_runtime(case_id)
    except PuzzleRuntimeError as error:
        return _report_failure(
            "Server Runtime Schema", case_id, error, f"{case_id}.server.json"
        )
    print("[OK] Server Runtime Schema")

    try:
        validate_case_content_links(client_content, server_runtime)
    except CaseContentLinkValidationError as error:
        return _report_failure("Client-Server Links", case_id, error)
    print("[OK] Client-Server Links")
    # 경고는 판정(VALID/INVALID · 종료 코드)을 바꾸지 않는다. 경고가 없으면 출력도 이전과 같다.
    for line in format_completion_reference_warnings(
        find_undefined_completion_references(server_runtime)
    ):
        _print_line(line)
    print(f"Case {case_id!r}: VALID")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
