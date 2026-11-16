"""라우터별 오류 응답 OpenAPI 명세(`responses=`). 응답 본문 · 상태 코드는 바꾸지 않고 지금 내는 그대로 적는다.

설명에는 그 상태에서 나올 수 있는 `detail` 문장(또는 `code`)을 모두 적는다. 문장으로만 구분되는 상태는
「문장 구분」이라고 표시한다 — 클라이언트가 문장을 비교하지 않아도 되도록 바꿀지는 별도 결정 사항이다.
목록이 라우터와 어긋나지 않는지는 `tests/test_api_error_contract.py`가 소스의 문장 · 코드와 대조한다.
"""

from typing import Any

from app.schemas.api_error import (
    CodedError,
    ErrorMessage,
    HintBalanceEmptyError,
    MissingRequirementsError,
    ValidationErrorResponse,
)
from app.services.session_content import CASE_VERSION_UNAVAILABLE


def _describe(summary: str, details: tuple[str, ...]) -> str:
    return summary + "".join(f"\n- `{detail}`" for detail in details)


def error(model: Any, summary: str, *details: str) -> dict[str, Any]:
    return {"model": model, "description": _describe(summary, details)}


PLAY_SESSION_NOT_FOUND = "Play session not found."
CASE_NOT_FOUND = "Case not found."
INVALID_CASE_ID = "Invalid case ID."
CASE_CONTENT_UNAVAILABLE = "Case content is unavailable."
EVENT_ID_CONFLICT = "Client event ID conflicts with a previous interaction."
VERSION_UNAVAILABLE_SUMMARY = f"`{CASE_VERSION_UNAVAILABLE}` — 세션이 고정한 콘텐츠 버전을 쓸 수 없다(최신 버전으로 바꾸지 않는다)."

_VALIDATION = "요청 형식 오류(FastAPI 검증 형식)."
_VALIDATION_OR_CASE_ID = ValidationErrorResponse | ErrorMessage


# --- PlaySession · Case bundle ---

PLAY_SESSION_CREATE = {
    404: error(
        ErrorMessage,
        "익명 세션 또는 케이스가 없다(문장 구분).",
        "Anonymous session not found.",
        CASE_NOT_FOUND,
    ),
    409: error(
        ErrorMessage,
        f"`{CASE_VERSION_UNAVAILABLE}` — `content_version`을 지정했는데 그 버전이 등록되지 않았거나, "
        "게시 상태가 새 세션을 받지 않는다(미게시 · 일시 중단 · 긴급 중단). 이 셋은 구분되지 않는다. "
        "`content_version`이 없는 레거시 세션에는 게시 상태 확인이 없다.",
        CASE_VERSION_UNAVAILABLE,
    ),
    410: error(ErrorMessage, "익명 세션이 만료됐다.", "Anonymous session has expired."),
    422: error(
        _VALIDATION_OR_CASE_ID,
        _VALIDATION + " 또는 케이스 ID 형식 오류.",
        INVALID_CASE_ID,
    ),
    500: error(ErrorMessage, "케이스 콘텐츠를 읽지 못했다.", CASE_CONTENT_UNAVAILABLE),
}

PLAY_SESSION_READ = {
    404: error(ErrorMessage, "플레이 세션이 없다.", PLAY_SESSION_NOT_FOUND),
}

PLAY_SESSION_CLUES = {
    404: error(ErrorMessage, "플레이 세션이 없다.", PLAY_SESSION_NOT_FOUND),
    409: error(ErrorMessage, VERSION_UNAVAILABLE_SUMMARY, CASE_VERSION_UNAVAILABLE),
    500: error(ErrorMessage, "케이스 콘텐츠를 읽지 못했다.", CASE_CONTENT_UNAVAILABLE),
}

PLAY_SESSION_BUNDLE = {
    404: error(
        ErrorMessage,
        "플레이 세션 또는 케이스가 없다(문장 구분).",
        PLAY_SESSION_NOT_FOUND,
        CASE_NOT_FOUND,
    ),
    409: error(ErrorMessage, VERSION_UNAVAILABLE_SUMMARY, CASE_VERSION_UNAVAILABLE),
    422: error(
        _VALIDATION_OR_CASE_ID,
        _VALIDATION + " 또는 케이스 ID 형식 오류.",
        INVALID_CASE_ID,
    ),
    500: error(ErrorMessage, "케이스 콘텐츠를 읽지 못했다.", CASE_CONTENT_UNAVAILABLE),
}

CASE_BUNDLE = {
    404: error(ErrorMessage, "케이스가 없다.", CASE_NOT_FOUND),
    422: error(
        _VALIDATION_OR_CASE_ID,
        _VALIDATION + " 또는 케이스 ID 형식 오류.",
        INVALID_CASE_ID,
    ),
    500: error(ErrorMessage, "케이스 콘텐츠를 읽지 못했다.", CASE_CONTENT_UNAVAILABLE),
}


# --- Interaction ---

INTERACTION = {
    404: error(
        ErrorMessage,
        "대상이 없다(문장 구분).",
        PLAY_SESSION_NOT_FOUND,
        "Puzzle not found.",
        "Inspection not found.",
        "Zone not found.",
        "Object not found.",
    ),
    409: error(
        ErrorMessage | MissingRequirementsError,
        "지금 상태로는 처리할 수 없다(문장 구분). 선행 조건 부족은 `missing_clue_count` · "
        "`missing_puzzle_count` · `missing_item_count` 중 하나를 함께 싣는다. "
        f"같은 `client_event_id`에 다른 요청이면 `{EVENT_ID_CONFLICT}`"
        "(같은 요청이면 처음 응답을 그대로 200으로 돌려준다).",
        CASE_VERSION_UNAVAILABLE,
        "Clue is not acquired.",
        "Object interaction is unavailable.",
        "Interaction action does not match the object.",
        "Interaction action does not match the puzzle solve mode.",
        "Current zone is unknown.",
        "Zone is not current.",
        "Navigation is unavailable.",
        "Object is not visible.",
        "Object is not enabled.",
        EVENT_ID_CONFLICT,
        "Required clues are not acquired.",
        "Required puzzles are not completed.",
        "Required items are not held.",
    ),
    500: error(
        ErrorMessage,
        "콘텐츠 · 런타임을 읽지 못했다(문장 구분).",
        CASE_CONTENT_UNAVAILABLE,
        "Puzzle runtime is unavailable.",
    ),
    501: error(
        ErrorMessage,
        "처리하지 않는 action. 문장에 action 이름이 들어간다.",
        "Interaction action '<action>' is not implemented.",
    ),
}


# --- Hint ---

_HINT_404 = error(
    ErrorMessage,
    "세션 · 퍼즐 · 힌트 단계가 없다(문장 구분). 발견하지 않은 퍼즐도 `Puzzle not found.`다. "
    f"레거시 세션(`content_version` 없음)의 케이스 파일이 없으면 `{CASE_NOT_FOUND}`"
    "(세션 번들과 같은 매핑, 차감 없음 · 같은 `client_event_id` 재전송도 같은 응답).",
    PLAY_SESSION_NOT_FOUND,
    "Puzzle not found.",
    "Hint not found.",
    CASE_NOT_FOUND,
)
_HINT_409_DETAILS = (
    CASE_VERSION_UNAVAILABLE,
    "Previous hint level is not unlocked.",
    "Hint is not available yet.",
    EVENT_ID_CONFLICT,
    "Required clues are not acquired.",
)
_HINT_409_SUMMARY = (
    "잔액 0은 `{code: HINT_BALANCE_EMPTY, minigames_left, special_minigame_available}`(차감 없음). "
    "그 밖은 문장 구분이고, 선행 단서 부족은 `missing_clue_count`를 함께 싣는다. "
    "같은 `client_event_id`의 같은 요청은 처음 응답을 그대로 200으로 돌려준다."
)
_HINT_500 = error(
    ErrorMessage,
    "저장된 힌트 상태가 잘못됐거나, 레거시 세션의 케이스 파일을 읽었지만 형식 · 검증 오류다(문장 구분).",
    "Hint state is invalid.",
    CASE_CONTENT_UNAVAILABLE,
)

HINT = {
    404: _HINT_404,
    409: error(
        HintBalanceEmptyError | CodedError | ErrorMessage | MissingRequirementsError,
        _HINT_409_SUMMARY
        + " `hint_ref`가 이 세션 · 고정 콘텐츠와 맞지 않으면 `code: HINT_REF_MISMATCH`(레거시 세션 포함).",
        "HINT_BALANCE_EMPTY",
        "HINT_REF_MISMATCH",
        *_HINT_409_DETAILS,
    ),
    422: error(
        ValidationErrorResponse | CodedError,
        _VALIDATION
        + " `puzzle_id` · `hint_ref`가 둘 다 있거나 둘 다 없을 때도 이 형식이다."
        " `hint_ref` 형식이 틀리면 `code: HINT_REF_INVALID`.",
        "HINT_REF_INVALID",
    ),
    500: _HINT_500,
    503: error(
        CodedError,
        "`hint_ref` 검증 키가 없거나 그 key id를 모른다(운영 설정 문제).",
        "HINT_REF_UNAVAILABLE",
    ),
}

HINT_ALIAS = {
    404: _HINT_404,
    409: error(
        HintBalanceEmptyError | ErrorMessage | MissingRequirementsError,
        _HINT_409_SUMMARY,
        "HINT_BALANCE_EMPTY",
        *_HINT_409_DETAILS,
    ),
    500: _HINT_500,
}


# --- NPC ---

NPC_TURN = {
    404: error(ErrorMessage, "플레이 세션이 없다.", PLAY_SESSION_NOT_FOUND),
    409: error(
        ErrorMessage,
        "고정 콘텐츠 버전을 쓸 수 없거나(`content_version` 없이 만든 레거시 세션 포함), "
        "같은 `client_event_id`에 다른 요청이다(문장 구분). "
        "같은 요청의 재전송은 200(현재 승인 · 게시 상태로 다시 판정한 응답). "
        "긴급 중단 · NPC 콘텐츠 없음은 오류가 아니다 — 200 `fallback_reason: NPC_CONTENT_WITHDRAWN` · "
        '`NPC_CONTENT_MISSING`, `content_mode: "generic"`, 승인 일반 대사 또는 `reply: null`. '
        '정상 응답은 `content_mode: "case"`.',
        CASE_VERSION_UNAVAILABLE,
        EVENT_ID_CONFLICT,
    ),
    500: error(
        ErrorMessage,
        "승인 대사에 정답 · 힌트 원문이 섞였다(콘텐츠 수정 필요).",
        "NPC content is unavailable.",
    ),
}


# --- Auth · 소셜 가입 ---

_NO_STORE = " 응답 헤더 `Cache-Control: no-store`."
_ACCOUNT_LINK_OR_CONFLICT = error(
    CodedError | ErrorMessage,
    "같은 이메일의 다른 가입 방법이 있으면 `code: account_link_required`. "
    "계정 생성 경합은 문장 `Social account login could not be completed.`." + _NO_STORE,
    "account_link_required",
    "Social account login could not be completed.",
)

GOOGLE_LOGIN = {
    401: error(
        ErrorMessage, "credential 검증 실패." + _NO_STORE, "Invalid Google credential."
    ),
    409: _ACCOUNT_LINK_OR_CONFLICT,
    503: error(
        ErrorMessage,
        "서버에 Google 설정이 없다." + _NO_STORE,
        "Google authentication is not configured.",
    ),
}

NAVER_LOGIN = {
    401: error(
        ErrorMessage,
        "인가 코드 · 프로필이 유효하지 않다(문장 구분)." + _NO_STORE,
        "Invalid Naver authorization code.",
        "Invalid Naver profile.",
    ),
    409: _ACCOUNT_LINK_OR_CONFLICT,
    502: error(
        ErrorMessage,
        "네이버 서버 호출 실패(문장 구분)." + _NO_STORE,
        "Naver token exchange failed.",
        "Naver profile request failed.",
    ),
    503: error(
        ErrorMessage,
        "서버에 네이버 설정이 없다." + _NO_STORE,
        "Naver authentication is not configured.",
    ),
}

_SENSITIVE_422 = (
    "요청 형식 오류도 입력값을 되돌려 보내지 않고 `{code, message}`로 답한다"
    "(필드 순서대로 `invalid_email` · `invalid_password` · `invalid_nickname`, 그 밖은 `invalid_input`)."
)

REGISTER = {
    409: error(
        ErrorMessage,
        "이미 쓰는 이메일 · 닉네임(문장 구분).",
        "Email already registered.",
        "Nickname already registered.",
    ),
    422: error(
        CodedError | ErrorMessage,
        _SENSITIVE_422 + " 동의 누락 · 그 밖의 입력 오류는 문장(문장 구분).",
        "invalid_email",
        "invalid_password",
        "invalid_nickname",
        "invalid_input",
        "Required consent is missing.",
        "Invalid local account input.",
    ),
}

LOGIN = {
    401: error(
        ErrorMessage,
        "없는 계정과 틀린 비밀번호를 구분하지 않는다." + _NO_STORE,
        "Invalid email or password.",
    ),
    422: error(
        CodedError, _SENSITIVE_422, "invalid_email", "invalid_password", "invalid_input"
    ),
    429: error(
        CodedError,
        "같은 이메일 또는 IP 의 로그인 실패가 많아 잠시 막혔다. `Retry-After` 헤더가 잠금이 풀릴 때까지 "
        "남은 초다(이메일 · IP 잠금이 둘 다면 더 늦게 풀리는 쪽)." + _NO_STORE,
        "login_locked",
    ),
}


def _rate_limited(limit: str) -> dict[int, dict[str, Any]]:
    """IP 기준 요청 빈도 제한(베타 전 보안 PR B). 한도는 `RATE_LIMIT_*` 설정의 기본값이다."""

    return {
        429: error(
            CodedError,
            f"같은 IP 의 요청이 최근 60초 한도(기본 {limit}, 운영 설정 `RATE_LIMIT_*`로 바뀔 수 있다)를 넘었다. "
            "`Retry-After` 헤더(정수 초) 뒤 다시 보낸다. API 마다 · IP 마다 따로 센다."
            + _NO_STORE,
            "rate_limited",
        )
    }


REGISTER.update(_rate_limited("30회"))

EMAIL_EXISTS = _rate_limited("30회")

NICKNAME_EXISTS = {
    422: error(
        ValidationErrorResponse | CodedError,
        _VALIDATION
        + " 닉네임 정책 위반은 `code: invalid_nickname`(이때만 `Cache-Control: no-store`).",
        "invalid_nickname",
    ),
    **_rate_limited("30회"),
}

SOCIAL_ONBOARDING = {
    401: error(
        CodedError,
        "증표 형식이 아니거나 없거나 만료됐다." + _NO_STORE,
        "invalid_onboarding_token",
    ),
    409: error(
        CodedError | ErrorMessage,
        "`code`로 구분한다. 계정 생성 경합만 문장 `Social account login could not be completed.`."
        + _NO_STORE,
        "onboarding_token_used",
        "terms_version_mismatch",
        "nickname_unavailable",
        "account_link_required",
        "Social account login could not be completed.",
    ),
    422: error(
        CodedError,
        _SENSITIVE_422 + " 필수 동의 누락은 `consent_required`." + _NO_STORE,
        "consent_required",
        "invalid_nickname",
        "invalid_input",
    ),
}


# --- Health ---

HEALTH_READY = {
    503: error(ErrorMessage, "DB에 접속하지 못했다.", "Database is not ready."),
}


# --- 로그인 사용자 · 관리자 ---

_LOGIN_REQUIRED = {
    401: error(ErrorMessage, "로그인 세션이 없거나 끝났다.", "Login required.")
}
FOREIGN_ORIGIN = {
    403: error(ErrorMessage, "다른 사이트에서 온 쓰기 요청이다.", "Origin not allowed.")
}
# 관리자 쓰기(문의 답변 · 상태 · 설정) — 관리자 검사 + Origin 검사
_ADMIN_WRITE = {
    **_LOGIN_REQUIRED,
    403: error(
        ErrorMessage,
        "관리자가 아니거나 다른 사이트에서 온 쓰기 요청이다(문장 구분).",
        "Admin only.",
        "Origin not allowed.",
    ),
}
_TOO_LARGE = {
    413: error(ErrorMessage, "저장 값이 크기 한도를 넘었다.", "Save data too large.")
}
_ADMIN_ONLY = {403: error(ErrorMessage, "관리자가 아니다.", "Admin only.")}

ME_READ = _LOGIN_REQUIRED
ME_LOGOUT = FOREIGN_ORIGIN
GAME_SAVE_WRITE = {
    **_LOGIN_REQUIRED,
    **FOREIGN_ORIGIN,
    409: error(
        CodedError,
        "다른 창이 먼저 저장했다. `revision` 이 최신 값이다.",
        "save_conflict",
    ),
    **_TOO_LARGE,
    422: error(
        ValidationErrorResponse | ErrorMessage,
        _VALIDATION + " 저장 값이 너무 깊어도 같은 상태다.",
        "Save data too deep.",
    ),
}
GAME_SAVE_DELETE = {**_LOGIN_REQUIRED, **FOREIGN_ORIGIN}
CHARACTER_WRITE = {
    **_LOGIN_REQUIRED,
    **FOREIGN_ORIGIN,
    **_TOO_LARGE,
    422: GAME_SAVE_WRITE[422],
}
ADMIN_LIST = {**_LOGIN_REQUIRED, **_ADMIN_ONLY}
ADMIN_DETAIL = {
    **_LOGIN_REQUIRED,
    **_ADMIN_ONLY,
    404: error(ErrorMessage, "없는 사용자다.", "User not found."),
}
_INVALID_QUERY_SUMMARY = "새 쿼리 값(검색어 · 날짜 · 개수 · 필터) 오류. 입력값을 되돌려 보내지 않는다(관리자 API v0.2 §2.2)."
# 회원 목록 — 기존 `offset` 형식 오류는 지금처럼 FastAPI 기본 422, 새 `q` · `limit` 은 `invalid_query`
ADMIN_USER_SEARCH = {
    **ADMIN_LIST,
    422: error(
        ValidationErrorResponse | CodedError,
        _VALIDATION + " / " + _INVALID_QUERY_SUMMARY,
        "invalid_query",
    ),
}
# 새 관리자 조회(통계 · 감사 기록) — 쿼리 값 오류는 모두 `invalid_query`
ADMIN_QUERY = {
    **ADMIN_LIST,
    422: error(CodedError, _INVALID_QUERY_SUMMARY, "invalid_query"),
}

# --- 관리자 API v0.3 3단계(11/13 해랑): 1:1 문의 · 설정 · 콘텐츠 ---
INQUIRY_CREATE = {
    **FOREIGN_ORIGIN,
    422: error(
        ValidationErrorResponse | CodedError,
        _VALIDATION
        + " 분류 다섯 값 · 제목 1~100자 · 본문 1~4000자 / 답변 받을 이메일이 형식에 안 맞음.",
        "invalid_email",
    ),
    429: error(
        CodedError,
        "같은 IP 의 문의 접수가 최근 창(기본 10분 5건, 운영 설정 `RATE_LIMIT_INQUIRY_*`)을 넘었다. "
        "`Retry-After` 헤더(정수 초) 뒤 다시 보낸다." + _NO_STORE,
        "rate_limited",
    ),
}
_INQUIRY_NOT_FOUND = {404: error(ErrorMessage, "없는 문의다.", "Inquiry not found.")}
ADMIN_INQUIRY_LIST = ADMIN_QUERY
ADMIN_INQUIRY_DETAIL = {**ADMIN_LIST, **_INQUIRY_NOT_FOUND}
ADMIN_INQUIRY_REPLY = {
    **_ADMIN_WRITE,
    **_INQUIRY_NOT_FOUND,
    409: error(CodedError, "종료된 문의에는 답할 수 없다.", "inquiry_closed"),
    422: error(ValidationErrorResponse, _VALIDATION + " 답변 1~4000자."),
}
ADMIN_INQUIRY_PATCH = {
    **_ADMIN_WRITE,
    **_INQUIRY_NOT_FOUND,
    422: error(
        ValidationErrorResponse | CodedError,
        _VALIDATION + " / 바꿀 값(status · priority)이 하나도 없다.",
        "invalid_query",
    ),
}
ADMIN_SETTINGS = ADMIN_LIST
ADMIN_SETTINGS_WRITE = {
    **_ADMIN_WRITE,
    422: error(
        ValidationErrorResponse, _VALIDATION + " on 은 bool · message 는 200자까지."
    ),
}
ADMIN_CONTENT_LIST = ADMIN_LIST
ADMIN_CONTENT_DETAIL = {
    **ADMIN_LIST,
    404: error(
        ErrorMessage, "없는 사건이거나 식별자 모양이 아니다.", "Case not found."
    ),
}


# --- 플레이 API 쿠키 · Origin(11/6 PM: Play Session 소유권 · 게스트 세션) ---
# 남의 Play Session · 소유자 없는(레거시) 세션은 없는 세션과 같은 404(위 각 404 그대로)라 따로 적지 않는다.

_PLAY_COOKIE_REQUIRED = {
    401: error(
        ErrorMessage,
        "유효한 로그인 쿠키도 게스트 쿠키도 없다(없음 · 만료 · 폐기).",
        "Play session cookie required.",
    )
}

for _responses in (PLAY_SESSION_CREATE, INTERACTION, HINT, HINT_ALIAS, NPC_TURN):
    _responses.update({**_PLAY_COOKIE_REQUIRED, **FOREIGN_ORIGIN})
for _responses in (PLAY_SESSION_READ, PLAY_SESSION_CLUES, PLAY_SESSION_BUNDLE):
    _responses.update(_PLAY_COOKIE_REQUIRED)

ANONYMOUS_SESSION_CREATE = {
    **FOREIGN_ORIGIN,
    **_rate_limited(
        "60회 — 유효한 게스트 쿠키로 기존 세션을 돌려받는 요청은 세지 않는다"
    ),
}

# --- 로비 입장권(로비 설계 v0.19 2절) ---

LOBBY_TICKET = {
    **_LOGIN_REQUIRED,
    403: error(
        ErrorMessage,
        "다른 사이트에서 온 요청이거나, 모집 명단에 없는 계정이다(문장 구분). 화면은 혼자 진행하고 이번 방문에 다시 요청하지 않는다.",
        "Origin not allowed.",
        "Not on the lobby beta list.",
    ),
    429: error(
        ErrorMessage,
        "최근 60초 발급 한도(계정당 10회 · IP당 60회)를 넘었다. `Retry-After` 헤더가 다음 발급까지 남은 초다.",
        "Too many lobby ticket requests.",
    ),
    503: error(
        ErrorMessage,
        "로비 입장권 발급이 꺼져 있다(로비 설정 · 시작 검사 실패) 또는 모집 명단을 쓸 수 없다. 본편 API 는 정상이다.",
        "Lobby is unavailable.",
    ),
}


# --- 베타 분석 기록(11/11 미르, `docs/beta_events.md`) ---
# 쿠키가 없어도 받는다(401 없음). 형식 오류는 묶음 전체를 거절한다(보낸 값은 되돌려 주지 않는다).

BETA_EVENTS = {
    **FOREIGN_ORIGIN,
    413: error(
        ErrorMessage,
        "본문이 64KB 를 넘었다." + _NO_STORE,
        "Beta event batch too large.",
    ),
    422: error(
        ValidationErrorResponse,
        _VALIDATION
        + " 본문을 직접 읽어 검사한다 — JSON 이 아니거나, 기록이 0개 · 51개 이상이거나, 필드 형식이 틀리거나,"
        " data 가 2048바이트를 넘으면 묶음 전체를 거절한다. `input` 은 싣지 않는다.",
    ),
    **_rate_limited("1500회"),
}
