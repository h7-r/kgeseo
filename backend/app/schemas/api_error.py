"""오류 응답 본문 형식(OpenAPI 명세용). 라우터가 이미 내는 본문을 그대로 적는다 — 이 모델로 응답을 만들지 않는다.

형식은 넷이다.
- `ErrorMessage`: FastAPI 기본 `{"detail": "<영문 문장>"}`. 같은 상태 코드 안에서는 문장으로만 구분된다.
- `CodedError`: `{"detail": {"code", "message"}}`. 상태는 `code`로 구분한다(`message`는 화면에 쓰지 않는다).
- `MissingRequirementsError`: `{"detail": "<문장>", "missing_*_count": n}`(부족한 ID는 알리지 않는다).
- `ValidationErrorResponse`: 요청 형식 검사 실패(FastAPI `RequestValidationError` 기본 형식).
"""

from pydantic import BaseModel, ConfigDict


class ErrorModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ErrorMessage(ErrorModel):
    detail: str


class ErrorCodeDetail(ErrorModel):
    code: str
    message: str


class CodedError(ErrorModel):
    detail: ErrorCodeDetail


class HintBalanceEmptyDetail(ErrorCodeDetail):
    """`code`는 `HINT_BALANCE_EMPTY`. 미니게임으로 힌트를 다시 얻을 수 있는지 함께 싣는다."""

    minigames_left: int
    special_minigame_available: bool


class HintBalanceEmptyError(ErrorModel):
    detail: HintBalanceEmptyDetail


class MissingRequirementsError(ErrorModel):
    """세 개수 중 하나만 실린다(단서 · 퍼즐 · 아이템)."""

    detail: str
    missing_clue_count: int | None = None
    missing_puzzle_count: int | None = None
    missing_item_count: int | None = None


class ValidationErrorItem(BaseModel):
    # `input` · `ctx` · `url` 등은 Pydantic 버전에 따라 붙는다.
    model_config = ConfigDict(extra="allow")

    loc: list[str | int]
    msg: str
    type: str


class ValidationErrorResponse(ErrorModel):
    detail: list[ValidationErrorItem]
