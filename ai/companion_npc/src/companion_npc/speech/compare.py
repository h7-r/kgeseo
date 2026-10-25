"""생성기 비교 실행 (P4-B1) — 같은 사례를 모든 생성기에 같은 입력으로 돌린다.

· 사례: P4-A 평가 세트의 normal · precondition · player_attack (생성기가 정상 입력을 받는 사례).
  비교를 위해 모든 사례에서 allow_llm 을 켠다 — 템플릿 대체가 생성기 차이를 가리지 않게.
· 같은 입력: 사례마다 input_sha256 이 생성기와 관계없이 같아야 한다(check_same_inputs).
· 기록: GenerationRecord → runs/p4/<실험>/records.jsonl, 원문 → runs/restricted/<실험>/raw.jsonl.
  보고서에는 aggregate() 의 집계만 둔다.
P4-B1 에서는 템플릿과 오프라인 전송(네트워크 없음)만 돌린다. 실제 GPT · Qwen 은 P4-B2 승인 뒤.
"""

import json
import statistics
from collections import Counter, defaultdict
from collections.abc import Callable
from datetime import datetime
from typing import Any

from companion_npc.adapters.npc_merge import MergedPack
from companion_npc.speech.evaluate import build_suite
from companion_npc.speech.generators import Generator
from companion_npc.speech.guard import SpeechGuard
from companion_npc.speech.llm import ChatResponse, LLMConfig
from companion_npc.speech.pipeline import speak
from companion_npc.speech.records import (
    EXPERIMENT_VERSION,
    GenerationRecord,
    RawLog,
    to_record,
)

COMPARED = ("normal", "precondition", "player_attack")


class OfflineEchoTransport:
    """네트워크 없는 전송 — 승인 힌트(없으면 일반 문장)를 JSON 형식으로 돌려준다. 배관 확인용."""

    def complete(self, messages, config: LLMConfig, api_key) -> ChatResponse:
        data = json.loads(messages[-1]["content"])
        if config.prompt_mode == "select":
            reply = json.dumps({"opener": "좋아요.", "closer": ""}, ensure_ascii=False)
            return ChatResponse(
                reply, tokens_in=len(messages[-1]["content"]), tokens_out=len(reply)
            )
        hint = data.get("approved_hint")
        if hint:
            text, used = hint["text"], [hint["label"]]
        elif data["kind"] == "clarify" and data["object_name"]:
            text, used = f"{data['object_name']} 이야기인가요?", []
        elif data["kind"] == "clarify":
            text, used = "어느 쪽이 궁금한지 조금 더 알려 줄래요?", []
        else:
            text, used = "도움이 필요하면 언제든 말해 주세요.", []
        reply = json.dumps({"text": text, "used": used}, ensure_ascii=False)
        return ChatResponse(
            reply, tokens_in=len(messages[-1]["content"]), tokens_out=len(text)
        )


def run_comparison(
    sources: list[tuple[MergedPack, list[str]]],
    generators: dict[str, Callable[[], Generator]],
    now: datetime,
    *,
    raw_log: RawLog | None = None,
    experiment_version: str = EXPERIMENT_VERSION,
) -> list[GenerationRecord]:
    records = []
    for merged, terms in sources:
        guard = SpeechGuard(merged.pack, terms)
        for case in build_suite(merged, terms):
            if case.category not in COMPARED:
                continue
            limits = case.context.limits.model_copy(update={"allow_llm": True})
            context = case.context.model_copy(update={"limits": limits})
            for name, factory in generators.items():
                outcome = speak(context, case.plan, merged, factory(), guard, now=now)
                record = to_record(
                    outcome,
                    eval_item_id=f"{case.case_id}/{case.name}",
                    case_id=case.case_id,
                    generator=name,
                    experiment_version=experiment_version,
                )
                if raw_log is not None:
                    raw_log.write(record, outcome)
                records.append(record)
    return records


def check_same_inputs(records: list[GenerationRecord]) -> list[str]:
    """생성기마다 입력이 달랐던 사례 ID. 비어 있어야 한다."""

    by_case: dict[str, set] = defaultdict(set)
    for r in records:
        by_case[r.eval_item_id].add(r.input_sha256)
    return sorted(k for k, v in by_case.items() if len(v) > 1)


def aggregate(records: list[GenerationRecord]) -> dict[str, Any]:
    """보고서용 집계 — 문장 본문은 넣지 않는다."""

    out = {}
    for name in dict.fromkeys(r.generator for r in records):
        rows = [r for r in records if r.generator == name]
        raw = [r for r in rows if r.guard_passed is not None]
        cost = [
            r.actual_cost_usd if r.actual_cost_usd is not None else r.estimated_cost_usd
            for r in rows
        ]
        out[name] = {
            "n": len(rows),
            "status_counts": dict(Counter(r.status for r in rows)),
            "guard_pass_rate": round(sum(r.guard_passed for r in raw) / len(raw), 3)
            if raw
            else None,
            "guard_failure_counts": dict(
                Counter(f for r in rows for f in r.guard_failures)
            ),
            "generation_ms_median": round(
                statistics.median(r.generation_ms for r in rows), 3
            )
            if rows
            else None,
            "validation_ms_median": round(
                statistics.median(r.validation_ms for r in rows), 3
            )
            if rows
            else None,
            "tokens_in": sum(r.tokens_in or 0 for r in rows),
            "tokens_out": sum(r.tokens_out or 0 for r in rows),
            "cost_usd": round(sum(c or 0 for c in cost), 6),
            "cost_unknown": sum(
                r.raw_sha256 is not None and c is None for r, c in zip(rows, cost)
            ),
            "cache_hits": sum(r.cache_hit for r in rows),
        }
    return {
        "note": "생성기 비교 배관 확인(오프라인). 품질 비교가 아니다. 네트워크 · 실제 LLM 을 쓰지 않았다.",
        "experiment_version": records[0].experiment_version if records else None,
        "cases": len({r.eval_item_id for r in records}),
        "input_mismatch": check_same_inputs(records),
        "generators": out,
    }
