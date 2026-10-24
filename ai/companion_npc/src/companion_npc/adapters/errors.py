"""변환기 오류.

[메시지에 입력값을 담지 않는다]
  pydantic 의 ValidationError 를 그대로 문자열로 만들면 잘못 들어온 **값**이 찍힌다.
  server.json 이 깨졌을 때 그 값이 accepted_answers 일 수 있으므로, 여기서는
  「어느 위치에서 · 어떤 종류의 오류」만 남긴다.
"""

from pydantic import ValidationError


def error_locations(error: ValidationError) -> list[str]:
    return [
        f"{'.'.join(str(part) for part in item['loc']) or '<root>'}: {item['type']}"
        for item in error.errors(include_input=False, include_url=False)
    ]


class AdapterError(Exception):
    pass


class InvalidCaseIdError(AdapterError):
    pass


class CaseFileNotFoundError(AdapterError):
    pass


class CaseFileDecodeError(AdapterError):
    pass


class _LocatedError(AdapterError):
    label = ""

    def __init__(self, locations: list[str]) -> None:
        self.locations = locations
        super().__init__(f"{self.label}: " + "; ".join(locations))


class ClientContentInvalidError(_LocatedError):
    label = "client content does not match CaseClientContent"


class ServerRuntimeInvalidError(_LocatedError):
    label = "server runtime does not match PuzzleRuntimeDefinition"


class PackContractError(_LocatedError):
    label = "converted data does not satisfy ScenarioPack"


class CaseLinkError(AdapterError):
    """client · server 를 이어 볼 때 어긋남 (backend validate_case_content_links 와 같은 규칙)."""


class AnswerLeakError(AdapterError):
    """변환 결과에 정답(또는 별칭)이 들어 있다. 팩을 내보내지 않는다."""

    def __init__(self, report) -> None:  # report: ConversionReport
        self.report = report
        paths = ", ".join(report.leak_check.matched_paths)
        super().__init__(f"answer leak detected at: {paths}")
