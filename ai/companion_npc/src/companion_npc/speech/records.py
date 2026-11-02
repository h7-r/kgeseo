"""생성기 비교 기록 (P4-B1) — 같은 입력 · 같은 검증 · 분리된 기록.

[분리]
  GenerationRecord  사례 하나 × 생성기 하나의 기록. 원문은 **넣지 않는다**(해시 · 글자 수만).
                    최종 UI 문장은 넣지만, 검증기를 빠져나간 공격 문장일 수 있으므로 runs/ 아래(깃 제외)에만 쓴다.
  RawLog            생성기 원문. runs/restricted/<실험>/ 아래에만 쓴다(경로를 검사한다). 비밀값은 가린다.
  보고서            집계 · 민감정보를 뺀 예시만 (experiments/results/).

[같은 입력] input_sha256 = 생성기에 준 PromptPayload.to_model_input() 의 해시.
  같은 사례면 생성기와 관계없이 같아야 한다 — 비교 실행이 이를 확인한다.
"""

import hashlib
import json
from pathlib import Path
from typing import Literal

from pydantic import Field

from companion_npc.contracts.common import ContractModel
from companion_npc.speech.llm import mask_secrets
from companion_npc.speech.pipeline import SpeechOutcome

EXPERIMENT_VERSION = "p4b1/0.1"
RESTRICTED = ("runs", "restricted")


def input_sha256(outcome: SpeechOutcome) -> str | None:
    if outcome.payload is None:
        return None
    material = json.dumps(
        outcome.payload.to_model_input(), ensure_ascii=False, sort_keys=True
    )
    return hashlib.sha256(material.encode()).hexdigest()


class GenerationRecord(ContractModel):
    experiment_version: str
    eval_item_id: str
    case_id: str
    generator: str
    method: str | None  # 실제로 쓰인 생성 방식 (대체되면 template)
    model_name: str | None
    prompt_version: str | None
    input_sha256: str | None
    requested_kind: str
    final_kind: str | None
    status: Literal["spoke", "fallback", "held"]
    # 1) 원문 — 해시와 길이만. 본문은 RawLog 에. 세 층을 나눈다:
    #    model_reply  모델이 실제로 돌려준 답(JSON) — LLM 일 때만
    #    raw          생성기가 만든 발화 문장(select 면 고른 말 + 승인 본문을 조립한 것) = 검증 대상
    #    final_text   검증 · 대체를 거쳐 UI 에 보일 문장
    model_reply_sha256: str | None = None
    model_reply_chars: int | None = None
    cache_key: str | None = None  # 캐시 파일 · 장부 항목과 잇는 키
    raw_sha256: str | None
    raw_chars: int | None
    # 2) 안전 검증 결과 (원문에 대해)
    guard_passed: bool | None  # 원문이 없으면 None
    guard_failures: list[str]
    # 3) 차단 · 대체 사유
    fallback_reason: str | None  # 대체 · 보류의 사유 (실패 코드 · 보류 사유)
    downgrade_reason: str | None
    # 4) 게임 UI 에 보일 최종 문장
    final_text: str | None
    # 5) 지연
    generation_ms: float = Field(ge=0)
    validation_ms: float = Field(ge=0)
    # 6) 토큰 · 비용
    tokens_in: int | None
    tokens_out: int | None
    estimated_cost_usd: float | None
    actual_cost_usd: float | None
    cache_hit: bool


def to_record(
    outcome: SpeechOutcome,
    *,
    eval_item_id: str,
    case_id: str,
    generator: str,
    experiment_version: str = EXPERIMENT_VERSION,
) -> GenerationRecord:
    raw = outcome.raw
    utterance = outcome.utterance
    notes = raw.notes if raw else {}
    free = raw is not None and raw.method in ("template", "fake")
    reply = notes.get("model_reply")
    guard_failures = [
        f
        for f in outcome.failures
        if not f.startswith(("generator_error:", "no_draft"))
    ]
    reason = None
    if outcome.status == "fallback":
        reason = ",".join(outcome.failures)
    elif outcome.status == "held":
        reason = outcome.downgrade_reason
    return GenerationRecord(
        experiment_version=experiment_version,
        eval_item_id=eval_item_id,
        case_id=case_id,
        generator=generator,
        method=utterance.generation.method if utterance.generation else None,
        model_name=raw.model_name if raw else None,
        prompt_version=raw.prompt_version if raw else None,
        input_sha256=input_sha256(outcome),
        requested_kind=outcome.requested_kind,
        final_kind=outcome.final_kind,
        status=outcome.status,
        model_reply_sha256=hashlib.sha256(reply.encode()).hexdigest()
        if reply is not None
        else None,
        model_reply_chars=len(reply) if reply is not None else None,
        cache_key=notes.get("cache_key"),
        raw_sha256=hashlib.sha256(raw.text.encode()).hexdigest() if raw else None,
        raw_chars=len(raw.text) if raw else None,
        guard_passed=(not guard_failures) if raw else None,
        guard_failures=guard_failures,
        fallback_reason=reason,
        downgrade_reason=outcome.downgrade_reason,
        final_text=utterance.speech.text if utterance.speech else None,
        generation_ms=outcome.generation_ms,
        validation_ms=outcome.validation_ms,
        tokens_in=raw.tokens_in if raw else None,
        tokens_out=raw.tokens_out if raw else None,
        # 템플릿 · 가짜 생성기는 비용이 없다(0). LLM 은 생성기가 남긴 값 — 없으면 None(모름)
        estimated_cost_usd=notes.get("estimated_cost_usd", 0.0 if free else None),
        actual_cost_usd=notes.get("actual_cost_usd", 0.0 if free else None),
        cache_hit=bool(notes.get("cache_hit", False)),
    )


def restricted_dir(root: Path, experiment: str) -> Path:
    """root/runs/restricted/<experiment> — 다른 곳으로 빠져나가는 이름은 거부한다."""

    base = root.joinpath(*RESTRICTED).resolve()
    target = (base / experiment).resolve()
    if base not in target.parents:
        raise ValueError("raw logs must stay under runs/restricted/")
    return target


class RawLog:
    """생성기 원문 기록. 이 파일은 깃에 넣지 않고, 보고서에 옮기지 않는다."""

    def __init__(self, root: Path, experiment: str, secrets: list[str] | None = None):
        self.path = restricted_dir(root, experiment) / "raw.jsonl"
        self._secrets = secrets or []

    def write(self, record: GenerationRecord, outcome: SpeechOutcome) -> None:
        if outcome.raw is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        reply = outcome.raw.notes.get("model_reply")
        line = {
            "eval_item_id": record.eval_item_id,
            "generator": record.generator,
            "cache_key": record.cache_key,
            "model_reply_sha256": record.model_reply_sha256,
            "model_reply": mask_secrets(reply, self._secrets)
            if reply is not None
            else None,
            "raw_sha256": record.raw_sha256,
            "raw_text": mask_secrets(
                outcome.raw.text, self._secrets
            ),  # 조립된 발화(검증 대상)
        }
        with self.path.open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(line, ensure_ascii=False, sort_keys=True) + "\n")

    def write_failed(
        self, eval_item_id: str, generator: str, cache_key: str | None, reply: str
    ) -> None:
        """해석에 실패한 모델 답(형식 오류 · 잘림 · 거절). 발화는 템플릿으로 대체됐다."""

        self.path.parent.mkdir(parents=True, exist_ok=True)
        line = {
            "eval_item_id": eval_item_id,
            "generator": generator,
            "cache_key": cache_key,
            "model_reply_sha256": hashlib.sha256(reply.encode()).hexdigest(),
            "model_reply": mask_secrets(reply, self._secrets),
            "parse_failed": True,
        }
        with self.path.open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(line, ensure_ascii=False, sort_keys=True) + "\n")
