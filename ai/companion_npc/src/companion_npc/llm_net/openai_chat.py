"""Chat Completions 전송 — OpenAI API 와 로컬 llama.cpp 서버(OpenAI 호환)가 같이 쓴다.

[실행 문] 두 가지가 모두 참일 때만 SDK 를 불러오고 요청한다. 하나라도 아니면 TransportError("unavailable").
  1) 실험 설정의 execution_approved = true (사람이 승인한 설정 파일)
  2) 환경변수 COMPANION_NPC_ALLOW_NETWORK = "1" (그 실행에서만 켠다)
  로컬 서버는 localhost 주소만 받는다(LLMConfig 검사).

[SDK] openai (requirements-llm.txt 로 따로 설치). 모듈을 불러올 때가 아니라 첫 요청 때 import 한다.
  · SDK 자체 재시도는 끈다(max_retries=0) — 재시도는 LLMGenerator 가 예산 장부와 함께 센다.
  · 제한 시간은 설정의 timeout_sec.
[오류 분류] SDK 예외 이름 · 상태 코드로 나눈다(공식 오류 안내 기준). 할당량 · 결제 문제(429 insufficient_quota)는
  재시도해도 풀리지 않으므로 quota 로 바로 멈춘다.
[비밀값] 키는 SDK 클라이언트에만 넘긴다. 오류를 바꿔 던질 때 예외 메시지에는 종류만 싣는다.
  원인(상태 · code · type · param · 키를 가리고 300자로 자른 메시지)은 detail 로 넘겨 제한 경로에만 적는다.
[모델 접근 확인] check_model_access — models.retrieve 로 모델을 쓸 수 있는지 본다(생성 요청이 아니다).
  잔액은 API 로 확인하지 않는다 → 실행 전에 사람이 대시보드에서 확인한다.
"""

import importlib
import os
from collections.abc import Callable
from typing import Any

from companion_npc.speech.llm import (
    ChatResponse,
    LLMConfig,
    TransportError,
    build_request,
    mask_secrets,
)

ALLOW_ENV = "COMPANION_NPC_ALLOW_NETWORK"
LOCAL_PLACEHOLDER_KEY = (
    "local-no-key"  # llama.cpp 서버는 키 없이 쓴다(--api-key 를 주지 않음)
)

_BY_NAME = {
    "APITimeoutError": "timeout",
    "APIConnectionError": "connection",
    "RateLimitError": "rate_limit",
    "InternalServerError": "server",
    "AuthenticationError": "auth",
    "PermissionDeniedError": "auth",
    "BadRequestError": "client",
    "NotFoundError": "client",
    "UnprocessableEntityError": "client",  # 예산을 아끼려고 재시도하지 않는다
    "ConflictError": "client",
}


def classify(error: Exception) -> str:
    name = type(error).__name__
    code = getattr(error, "code", None)
    if name == "RateLimitError" and code in (
        "insufficient_quota",
        "billing_hard_limit_reached",
    ):
        return "quota"
    if name in _BY_NAME:
        return _BY_NAME[name]
    status = getattr(error, "status_code", None)
    if status in (500, 502, 503, 504):
        return "server"
    if status == 429:
        return "rate_limit"
    return "client"


def error_detail(error: Exception, secrets: list[str]) -> dict:
    body = getattr(error, "body", None)
    body = body.get("error", body) if isinstance(body, dict) else {}
    message = mask_secrets(str(getattr(error, "message", "") or ""), secrets)[:300]
    return {
        "exception": type(error).__name__,
        "status_code": getattr(error, "status_code", None),
        "code": getattr(error, "code", None) or body.get("code"),
        "type": getattr(error, "type", None) or body.get("type"),
        "param": getattr(error, "param", None) or body.get("param"),
        "message_masked": message,
    }


def network_allowed(approved: bool, env: dict[str, str] | None = None) -> bool:
    env = os.environ if env is None else env
    return bool(approved) and env.get(ALLOW_ENV) == "1"


def _usage(response: Any) -> dict:
    usage = getattr(response, "usage", None)
    prompt_details = getattr(usage, "prompt_tokens_details", None)
    completion_details = getattr(usage, "completion_tokens_details", None)
    return {
        "tokens_in": getattr(usage, "prompt_tokens", None),
        "tokens_out": getattr(usage, "completion_tokens", None),
        "cached_tokens": getattr(prompt_details, "cached_tokens", None),
        "reasoning_tokens": getattr(completion_details, "reasoning_tokens", None),
    }


class OpenAIChatTransport:
    """client_factory 를 주면 그것을 쓴다(테스트). 없으면 승인된 실행에서만 openai SDK 를 불러온다."""

    def __init__(
        self,
        approved: bool,
        client_factory: Callable[..., Any] | None = None,
        env: dict[str, str] | None = None,
    ) -> None:
        self.approved = approved
        self._factory = client_factory
        self._env = env
        self._client = None

    def _get_client(self, config: LLMConfig, api_key: str | None):
        if not network_allowed(self.approved, self._env):
            raise TransportError("unavailable")
        if self._client is None:
            factory = self._factory or importlib.import_module("openai").OpenAI
            kwargs = {
                "api_key": api_key or LOCAL_PLACEHOLDER_KEY,
                "timeout": config.timeout_sec,
                "max_retries": 0,
            }
            if config.base_url:
                kwargs["base_url"] = config.base_url
            self._client = factory(**kwargs)
        return self._client

    def complete(
        self, messages, config: LLMConfig, api_key: str | None
    ) -> ChatResponse:
        client = self._get_client(config, api_key)
        request = build_request(messages, config)
        try:
            response = client.chat.completions.create(**request)
        except Exception as error:  # SDK 예외 → 분류 + 가린 원인
            raise TransportError(
                classify(error), error_detail(error, [api_key or ""])
            ) from None
        choice = response.choices[0]
        message = choice.message
        return ChatResponse(
            text=getattr(message, "content", None) or "",
            finish_reason=getattr(choice, "finish_reason", None),
            refusal=getattr(message, "refusal", None),
            **_usage(response),
        )

    def check_model_access(self, config: LLMConfig, api_key: str | None) -> dict:
        """모델 접근 확인 — 생성 요청이 아니다(토큰을 쓰지 않는다). 실패하면 TransportError."""

        client = self._get_client(config, api_key)
        try:
            model = client.models.retrieve(config.model)
        except Exception as error:
            raise TransportError(
                classify(error), error_detail(error, [api_key or ""])
            ) from None
        return {
            "model": getattr(model, "id", None),
            "owned_by": getattr(model, "owned_by", None),
        }
