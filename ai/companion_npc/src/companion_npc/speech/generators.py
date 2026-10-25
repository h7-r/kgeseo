"""생성기 — 모두 같은 PromptPayload 를 받아 Draft 를 돌려준다.

  TemplateGenerator  승인 템플릿 · 승인 힌트 본문을 그대로 쓴다 (모델 없음, 결정적)
  FakeGenerator      테스트용. 정해 둔 문장을 돌려준다 — 공격 문장으로 검증기를 시험한다
  GPTGenerator · QwenGenerator  P4-B (이 단계에서는 만들지 않는다 · 네트워크 없음)

모델별로 달라지는 설정(model_name · prompt_version)은 Draft 에 기록한다. 입력 범위는 같다.
"""

import hashlib
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal, Protocol

from companion_npc.speech.payload import PromptPayload

PROMPT_VERSION = "p4a/0.1"


@dataclass(frozen=True)
class Draft:
    text: str
    used_labels: tuple[str, ...]
    method: Literal["template", "gpt_rag", "qwen_local", "fake"]
    model_name: str | None = None
    prompt_version: str | None = PROMPT_VERSION
    latency_ms: int = 0
    tokens_in: int | None = None
    tokens_out: int | None = None
    notes: dict = field(default_factory=dict)


class Generator(Protocol):
    name: str
    uses_llm: bool

    def generate(self, payload: PromptPayload) -> Draft | None: ...


def _pick(options: list, key: str):
    return options[int(hashlib.sha256(key.encode()).hexdigest(), 16) % len(options)]


@dataclass(frozen=True)
class TemplateGenerator:
    name: str = "template"
    uses_llm: bool = False

    def generate(self, payload: PromptPayload) -> Draft | None:
        started = time.perf_counter()
        t = payload.templates
        if payload.kind == "check_in":
            text, labels = _pick(t.check_in, payload.request_id).text, ()
        elif payload.kind == "clarify":
            if payload.object_name and t.clarify_with_object:
                text = _pick(t.clarify_with_object, payload.request_id).text.format(
                    object=payload.object_name
                )
                labels = tuple(
                    e.label for e in payload.evidence if e.text == payload.object_name
                )[:1]
            else:
                text, labels = _pick(t.clarify_general, payload.request_id).text, ()
        else:
            if payload.approved_hint is None:
                return None  # 승인 힌트가 없으면 만들지 않는다
            text, labels = payload.approved_hint.text, (payload.approved_hint.label,)
        return Draft(
            text=text,
            used_labels=labels,
            method="template",
            latency_ms=int((time.perf_counter() - started) * 1000),
        )


@dataclass(frozen=True)
class FakeGenerator:
    """respond(payload) 가 돌려주는 문장을 그대로 쓴다. LLM 을 흉내 내므로 uses_llm=True."""

    respond: Callable[[PromptPayload], str]
    labels: tuple[str, ...] = ()
    name: str = "fake"
    uses_llm: bool = True

    def generate(self, payload: PromptPayload) -> Draft | None:
        return Draft(
            text=self.respond(payload),
            used_labels=self.labels,
            method="fake",
            model_name="fake",
        )
