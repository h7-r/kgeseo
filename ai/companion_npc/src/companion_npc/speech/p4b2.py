"""P4-B2 실험 실행기 — 공통 사례 · 공개 가능 검사 · 요청 계획 · 실행 · 집계 · 사람 평가 양식 · 재현 정보.

[공통 사례] 사건마다 팩 구조에서 만든다(사건 ID 를 코드에 쓰지 않는다).
  1) P4-A 평가 세트(normal · precondition · player_attack) 중 LLM 까지 가는 사례 — nudge · hint · clarify.
     check_in 은 승인 템플릿 전용이라 LLM 대상이 아니다 → 템플릿 기준선(check_in_baseline)으로 따로 잰다.
  2) 승인 힌트마다 플레이어 요청 2개 + 2단계 힌트는 요청 1개 더.
  3) **공개 가능 검사**를 통과한 것만 쓴다. 모델 입력에 정답 · 별칭 · 내부 ID · 비공개 견본 문구 ·
     개인정보 형식이 하나라도 있으면 뺀다(예: 별칭을 넣은 플레이어 떠보기).
  A군(select) · B군(free)은 같은 사례를 같은 입력으로 받는다(input_sha256).
[계획] 연결 확인(smoke) → A군 전 사례 → B군 전 사례 → 반복(repeat_arm · repeat_cases × repeat_times).
  합계가 예산 요청 수를 넘으면 설정이 거부된다. 실행 중에는 장부가 먼저 닿는 한도($ · 요청)에서 멈춘다.
  quota · auth · unavailable · client 오류가 나면 그 자리에서 멈춘다(재시도해도 풀리지 않는다).
  phases 로 단계를 골라 돌릴 수 있다(예: smoke 만 먼저). 장부는 실행 사이에 이어진다.
[기록] 사례별 기록 · 원문 · 장부 · 캐시 · 사람 평가 양식은 runs/restricted/<exp_id>/ (깃 제외).
  결과 요약에는 집계 · 재현 정보만 둔다. 문장 본문은 넣지 않는다.
"""

import csv
import hashlib
import json
import platform
import re
import statistics
from collections import Counter, defaultdict
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, model_validator

from companion_npc.adapters.case_content import canonical_sha256
from companion_npc.adapters.npc_merge import MergedPack
from companion_npc.contracts.common import ContractModel
from companion_npc.contracts.npc_context import NpcContext
from companion_npc.contracts.spoiler import find_answer_leaks, normalize
from companion_npc.speech.evaluate import CaseSource, _context, build_suite
from companion_npc.speech.generators import TemplateGenerator
from companion_npc.speech.guard import SpeechGuard
from companion_npc.speech.llm import (
    BudgetLedger,
    Cache,
    ChatTransport,
    LLMConfig,
    LLMGenerator,
    build_messages,
)
from companion_npc.speech.pipeline import SpeechPlan, speak
from companion_npc.speech.records import (
    RawLog,
    input_sha256,
    restricted_dir,
    to_record,
)

EXPERIMENT_VERSION = "p4b2/0.2"  # 0.2: 원문 3층 기록(model_reply · 조립 발화 · 최종) · clarify 템플릿 전용
BASE_CATEGORIES = ("normal", "precondition", "player_attack")
HINT_REQUESTS = ("이거 어떻게 해야 해?", "힌트 좀 줄래?")
LEVEL2_EXTRA = "조금만 더 구체적으로 알려 줘."
# client(400 등)도 멈춘다 — 지원하지 않는 인자처럼 모든 요청에 되풀이될 오류에 예산을 쓰지 않으려고
STOP_KINDS = frozenset(
    {"quota", "auth", "unavailable", "client", "blocked"}
)  # blocked: 전송 직전 페이로드 검사
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
_PHONE = re.compile(r"01[016789][-\s]?\d{3,4}[-\s]?\d{4}")
SPOILER_FAILURES = ("answer_leak", "internal_id", "undisclosed_content")
UNSUPPORTED_FAILURES = ("ungrounded", "unsupported_sentence")


class Plan(ContractModel):
    smoke: int = Field(default=4, ge=0)
    arm_cases: int = Field(default=36, ge=1)
    repeat_cases: int = Field(default=8, ge=0)
    repeat_times: int = Field(default=2, ge=0)


class ModelRecord(ContractModel):
    """재현 정보 — 설치 · 실행 때 실제로 확인한 값을 적는다. 모르는 값은 null 로 둔다(추정해 채우지 않는다)."""

    distribution: str
    model_id: str
    snapshot: str | None = None
    file: str | None = None
    file_sha256: str | None = (
        None  # 배포처가 밝힌 값 — 받은 뒤 Get-FileHash 로 맞춰 본다
    )
    revision: str | None = None
    license: str | None = None
    runtime: str | None = None  # 예: llama.cpp 빌드 태그 (설치 때 기록)
    runtime_asset: str | None = None
    runtime_sha256: str | None = None
    sdk: str | None = None  # 예: openai==x.y.z (requirements-llm.txt)
    checked_at: str | None = None
    sources: list[str] = Field(default_factory=list)
    verified_locally: bool = False  # 받은 파일의 해시를 이 PC 에서 맞춰 봤는가


class P4B2Config(ContractModel):
    exp_id: str = Field(pattern=r"^[a-z0-9_]+$")
    cases: list[CaseSource]
    aliases_file: str
    private_files: list[str] = Field(
        default_factory=list
    )  # 공개 가능 검사에 쓸 비공개 견본
    now: str
    generator: LLMConfig
    arms: list[Literal["select", "free"]] = ["select", "free"]
    repeat_arm: Literal["select", "free"] = "free"
    plan: Plan = Plan()
    expected_cases: int = 36
    # LLM 비교 대상 유형. 기본(판 1 · 2)은 clarify 포함 — 판 3 부터 clarify 는 승인 템플릿 공통 기능 평가로 나눈다
    llm_kinds: list[Literal["nudge", "hint", "clarify"]] = ["nudge", "hint", "clarify"]
    expected_llm_cases: int | None = None  # 없으면 expected_cases
    # smoke · 반복 사례 고르기 — first: 앞에서부터(판 1 · 2) · stratified: 사건 × 유형마다 고루
    sampling: Literal["first", "stratified"] = "first"
    # nudge · hint 근거 범위 — 판 1~3: tier_le · 판 4: same_level (retrieval.allowed_chunks)
    evidence_policy: Literal["tier_le", "same_level"] = "tier_le"
    model_record: ModelRecord
    # 평가 세트 판 — 사례 구성이 바뀌면 새 판. 결과 요약에 사례 목록 해시와 함께 남는다
    eval_set: str = Field(min_length=1)
    # 실험 설정 판 — 요청 인자를 바꾸면 새 판으로 나눈다(같은 판에서 인자를 고치지 않는다)
    config_version: str = "1"
    # 예산 장부 이름 — 같은 계정 예산을 쓰는 설정끼리 같은 장부를 쓴다(판을 나눠도 $2 · 100 요청이 이어진다)
    ledger_name: str = Field(pattern=r"^[a-z0-9_.-]+$")
    execution_approved: bool = False  # 사람이 승인한 뒤에만 true
    # 실제 실행을 승인한 단계(예: ["smoke"]). 여기 없는 단계는 --execute 로 돌리지 않는다
    approved_phases: list[Literal["smoke", "arm", "repeat"]] = Field(
        default_factory=list
    )
    # 승인한 평가 세트의 (사례 ID · 입력 해시) 해시. 실행 직전에 다시 계산해 다르면 멈춘다(외부 전송 대상이 바뀜)
    expected_items_inputs_sha256: str | None = None

    @model_validator(mode="after")
    def _within_budget(self) -> "P4B2Config":
        total = planned_requests(self)
        if total > self.generator.budget.max_requests:
            raise ValueError(
                f"plan needs {total} requests > cap {self.generator.budget.max_requests}"
            )
        if self.plan.arm_cases != (self.expected_llm_cases or self.expected_cases):
            raise ValueError("arm_cases must equal the number of LLM cases")
        return self


def planned_requests(config: P4B2Config) -> int:
    p = config.plan
    return p.smoke + p.arm_cases * len(config.arms) + p.repeat_cases * p.repeat_times


@dataclass(frozen=True)
class CommonCase:
    case_id: str
    name: str
    source: int  # sources 안의 순번
    context: NpcContext
    plan: SpeechPlan
    final_kind: str | None = (
        None  # 파이프라인이 정한 최종 유형(사전 조건 반영) — 군 · 유형 분포 · LLM 대상 판단
    )

    @property
    def item_id(self) -> str:
        return f"{self.case_id}/{self.name}"


def _llm_context(context: NpcContext) -> NpcContext:
    return context.model_copy(
        update={"limits": context.limits.model_copy(update={"allow_llm": True})}
    )


def _model_input_text(merged: MergedPack, terms: list[str], c: CommonCase, now: datetime, policy: str = "tier_le") -> tuple[str | None, str | None]:  # fmt: skip
    """(모델에 갈 입력 문자열, 최종 유형). LLM 까지 가지 않으면 입력은 None."""

    guard = SpeechGuard(merged.pack, terms)
    out = speak(
        c.context,
        c.plan,
        merged,
        TemplateGenerator(),
        guard,
        now=now,
        evidence_policy=policy,
    )
    if out.payload is None or out.final_kind not in ("nudge", "hint", "clarify"):
        return None, out.final_kind
    texts = [
        m["content"]
        for mode in ("select", "free")
        for m in build_messages(out.payload, mode)
    ]
    return "\n".join(texts), out.final_kind


def audit_input(
    text: str, merged: MergedPack, terms: list[str], private_texts: list[str]
) -> list[str]:
    """모델 입력의 공개 가능 검사 — 걸린 이유 목록(비어 있으면 통과). 본문은 돌려주지 않는다."""

    reasons = []
    if find_answer_leaks({"input": text}, terms):
        reasons.append("answer_or_alias")
    pack = merged.pack
    ids = (
        [p.puzzle_id for p in pack.puzzles]
        + [c.clue_id for c in pack.clues]
        + [h.hint_id for h in pack.hints]
    )
    ids += (
        [k.chunk_id for k in pack.knowledge]
        + [o.object_id for o in pack.objects]
        + [z.zone_id for z in pack.zones]
    )
    ids += sorted({f for p in pack.puzzles for f in p.sets_flags})
    if any(i in text for i in ids):
        reasons.append("internal_id")
    norm = normalize(text)
    if any(t and normalize(t) in norm for t in private_texts):
        reasons.append("private_fixture_text")
    if _EMAIL.search(text) or _PHONE.search(text):
        reasons.append("personal_data_pattern")
    return reasons


def build_common_cases(
    sources: list[tuple[MergedPack, list[str]]],
    now: datetime,
    private_texts: list[str],
    policy: str = "tier_le",
) -> tuple[list[CommonCase], dict[str, Any]]:
    cases, audit = [], {"excluded": [], "checked": 0, "kinds": Counter()}
    for index, (merged, terms) in enumerate(sources):
        candidates = [
            CommonCase(
                merged.pack.case_id, s.name, index, _llm_context(s.context), s.plan
            )
            for s in build_suite(merged, terms)
            if s.category in BASE_CATEGORIES
        ]
        zones = {p.puzzle_id: p.zone_id for p in merged.pack.puzzles}
        for h in merged.pack.hints:
            kind = "nudge" if h.npc_hint_level == 1 else "hint"
            messages = HINT_REQUESTS + (
                (LEVEL2_EXTRA,) if h.npc_hint_level == 2 else ()
            )
            zone = zones.get(h.puzzle_id) or merged.pack.entry_zone_id
            for i, message in enumerate(messages, start=1):
                name = f"request_{h.hint_id}_{i}"
                ctx = _context(merged, name, zone, allow_llm=True)
                candidates.append(CommonCase(merged.pack.case_id, name, index, ctx, SpeechPlan(kind, "player", h.puzzle_id, True, message)))  # fmt: skip
        for c in candidates:
            text, kind = _model_input_text(merged, terms, c, now, policy)
            if text is None:
                continue  # 보류 · check_in → LLM 대상 아님
            audit["checked"] += 1
            reasons = audit_input(text, merged, terms, private_texts)
            if reasons:
                audit["excluded"].append({"item_id": c.item_id, "reasons": reasons})
                continue
            audit["kinds"][kind] += 1
            cases.append(replace(c, final_kind=kind))
    audit["kinds"] = dict(audit["kinds"])
    audit["included"] = len(cases)
    return cases, audit


def check_in_cases(sources) -> list[CommonCase]:
    """템플릿 기준선 — 자동 check_in 과 clarify 자동 요청(→ check_in)."""

    out = []
    for index, (merged, terms) in enumerate(sources):
        for s in build_suite(merged, terms):
            if s.name in ("check_in_auto", "clarify_auto_downgraded"):
                out.append(
                    CommonCase(
                        merged.pack.case_id,
                        s.name,
                        index,
                        _llm_context(s.context),
                        s.plan,
                    )
                )
    return out


def request_plan(
    config: P4B2Config, cases: list[CommonCase]
) -> list[tuple[str, str, CommonCase, int]]:
    """(단계, 군, 사례, 반복 번호) 목록 — 결정적이다."""

    p = config.plan
    cases = llm_cases(config, cases)
    if config.sampling == "stratified":
        smoke = stratified(cases, p.smoke)
        # 사건마다 군을 한 칸씩 밀어, 4 칸이면 두 사건 × 두 유형 × 두 군(A nudge · A hint · B nudge · B hint)이 다 들어간다
        order = sorted({c.case_id for c in cases})
        items = [
            (
                "smoke",
                config.arms[(i + order.index(c.case_id)) % len(config.arms)],
                c,
                0,
            )
            for i, c in enumerate(smoke)
        ]
        chosen = stratified(cases, p.repeat_cases)
    else:
        items = [
            ("smoke", config.arms[i % len(config.arms)], cases[i], 0)
            for i in range(min(p.smoke, len(cases)))
        ]
        chosen = sorted(
            cases, key=lambda c: hashlib.sha256(c.item_id.encode()).hexdigest()
        )[: p.repeat_cases]
    for arm in config.arms:
        items += [("arm", arm, c, 0) for c in cases[: p.arm_cases]]
    for r in range(1, p.repeat_times + 1):
        items += [("repeat", config.repeat_arm, c, r) for c in chosen]
    return items


def run_p4b2(
    config: P4B2Config,
    sources: list[tuple[MergedPack, list[str]]],
    transport: ChatTransport,
    root: Path,
    *,
    private_texts: list[str],
    env: dict[str, str] | None = None,
    dry_run: bool = True,
    phases: tuple[str, ...] | None = None,
    sleep: Callable[[float], None] | None = None,
    extra_forbidden: list[str] | None = None,
    session_max_requests: int | None = None,
    model_access: dict | None = None,
) -> dict[str, Any]:
    """extra_forbidden: 전송 직전 검사에 더할 금지어(예: 외부 전송이 금지된 사건의 정답 · 별칭).
    session_max_requests: 이번 실행의 요청 상한(재시도 포함). 실제 실행에서 smoke 만 돌리면 plan.smoke."""

    now = datetime.fromisoformat(config.now)
    policy = config.evidence_policy
    cases, audit = build_common_cases(sources, now, private_texts, policy)
    if len(cases) != config.expected_cases:
        raise ValueError(
            f"common cases {len(cases)} != expected {config.expected_cases}"
        )
    if len(llm_cases(config, cases)) != config.plan.arm_cases:
        raise ValueError("LLM case count != plan.arm_cases")
    pre = pre_manifest(sources, cases, now, policy)
    if (
        not dry_run
        and config.expected_items_inputs_sha256 != pre["items_inputs_sha256"]
    ):
        raise ValueError("eval set changed since approval — refusing to send")
    all_terms = [t for _, terms in sources for t in terms] + list(extra_forbidden or [])
    exp = config.exp_id + ("_dryrun" if dry_run else "")
    base = restricted_dir(root, exp)
    tag = (
        "" if phases is None else "_" + "-".join(phases)
    )  # 단계별로 기록을 나눠 앞 실행을 덮어쓰지 않는다
    if dry_run:
        for name in ("raw.jsonl", f"records{tag}.jsonl"):
            if (base / name).exists():
                (base / name).unlink()
    ledger = BudgetLedger(config.generator.budget) if dry_run else BudgetLedger.load(config.generator.budget, ledger_path(root, config))  # fmt: skip
    ledger.session_max_requests = session_max_requests
    errors_path = base / "errors.jsonl"
    cache = Cache(None if dry_run else base / "cache")
    raw_log = RawLog(root, exp)
    guards = [SpeechGuard(m.pack, t) for m, t in sources]
    rows, stop_reason, stop_detail = [], None, None
    for phase, arm, case, rep in request_plan(config, cases):
        if phases is not None and phase not in phases:
            continue
        merged = sources[case.source][0]
        gen = LLMGenerator(
            config.generator.model_copy(update={"prompt_mode": arm}),
            ledger,
            transport,
            cache,
            env=env,
            cache_salt=f"{phase}:{rep}",
            pre_send=_pre_send(merged, all_terms, private_texts),
            **({"sleep": sleep} if sleep else {}),
        )
        outcome = speak(
            case.context,
            case.plan,
            merged,
            gen,
            guards[case.source],
            now=now,
            evidence_policy=policy,
        )
        record = to_record(outcome, eval_item_id=case.item_id, case_id=case.case_id, generator=f"{config.generator.generator}:{arm}", experiment_version=EXPERIMENT_VERSION)  # fmt: skip
        raw_log.write(record, outcome)
        if (
            gen.last_failed_reply is not None
        ):  # 해석 실패한 모델 답도 원문 로그에(제한 경로)
            raw_log.write_failed(
                case.item_id,
                record.generator,
                gen.last_cache_key,
                gen.last_failed_reply,
            )
        if gen.last_error_detail:  # 오류 원인(가린 메시지 포함)은 제한 경로에만
            errors_path.parent.mkdir(parents=True, exist_ok=True)
            with errors_path.open("a", encoding="utf-8", newline="\n") as f:
                f.write(json.dumps({"item_id": case.item_id, "phase": phase, "arm": arm, **gen.last_error_detail}, ensure_ascii=False) + "\n")  # fmt: skip
        rows.append(
            {
                "phase": phase,
                "arm": arm,
                "repeat": rep,
                **record.model_dump(mode="json"),
                "usage_detail": _usage_detail(outcome),
                "paraphrase": paraphrase_metrics(outcome, merged),
            }
        )
        failures = outcome.failures
        if any(
            f in failures
            for f in ("generator_error:BudgetExceeded", "generator_error:CostUnknown")
        ):
            stop_reason = failures[0].split(":", 1)[1]
        elif (
            gen.last_error_kind in STOP_KINDS
            and "generator_error:TransportError" in failures
        ):
            stop_reason = f"transport:{gen.last_error_kind}"
            stop_detail = gen.last_error_detail
        elif phase == "smoke" and "generator_error:TransportError" in failures:
            # 연결 확인 단계는 어떤 전송 오류에서도 멈춘다(원인을 보고 사람이 판단한다)
            stop_reason = f"smoke_error:{gen.last_error_kind}"
            stop_detail = gen.last_error_detail
        elif "generator_error:NotReadyError" in failures:
            stop_reason = "not_ready"
        if stop_reason:
            break
    # 승인 템플릿 공통 기능 평가 — LLM 대상이 아닌 공통 사례(판 3: clarify)는 템플릿 경로로만
    for case in [c for c in cases if c.final_kind not in config.llm_kinds]:
        merged = sources[case.source][0]
        outcome = speak(case.context, case.plan, merged, TemplateGenerator(), guards[case.source], now=now, evidence_policy=policy)  # fmt: skip
        record = to_record(outcome, eval_item_id=case.item_id, case_id=case.case_id, generator="template", experiment_version=EXPERIMENT_VERSION)  # fmt: skip
        rows.append({"phase": "template_feature", "arm": "template", "repeat": 0, **record.model_dump(mode="json")})  # fmt: skip
    for case in check_in_cases(sources):
        merged = sources[case.source][0]
        outcome = speak(
            case.context,
            case.plan,
            merged,
            TemplateGenerator(),
            guards[case.source],
            now=now,
        )
        record = to_record(outcome, eval_item_id=case.item_id, case_id=case.case_id, generator="template", experiment_version=EXPERIMENT_VERSION)  # fmt: skip
        rows.append(
            {
                "phase": "check_in_baseline",
                "arm": "template",
                "repeat": 0,
                **record.model_dump(mode="json"),
            }
        )
    (base / f"records{tag}.jsonl").parent.mkdir(parents=True, exist_ok=True)
    (base / f"records{tag}.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in rows), encoding="utf-8", newline="\n")  # fmt: skip
    write_rating_form(base, rows, cases, sources, now, tag)
    summary = summarize(rows, ledger, stop_reason, audit, config, dry_run)
    summary["stop_detail"] = public_error(stop_detail)
    summary["eval_set_manifest"] = manifest(cases, rows)
    summary["eval_set_pre_manifest"] = pre
    summary["request_params"] = request_params(config)
    summary["model_access"] = model_access
    summary["phases_run"] = list(phases) if phases else None
    summary["session_max_requests"] = session_max_requests
    summary["usage_fields"] = usage_fields(rows)
    summary["paraphrase"] = {arm: paraphrase_block([r for r in rows if r["phase"] == "arm" and r["arm"] == arm]) for arm in config.arms}  # fmt: skip
    summary["paraphrase_by_case"] = {
        f"{arm}|{case}": paraphrase_block([r for r in rows if r["phase"] == "arm" and r["arm"] == arm and r["case_id"] == case])
        for arm in config.arms
        for case in sorted({r["case_id"] for r in rows if r["phase"] == "arm"})
    }  # fmt: skip
    summary["status_by_cell"] = status_by_cell(rows)
    summary["duplicates"] = duplicate_report(rows, config)
    summary["paraphrase_smoke"] = paraphrase_block(
        [r for r in rows if r["phase"] == "smoke"]
    )
    summary["evidence_policy"] = policy
    summary["evidence_policy_comparison"] = evidence_comparison(
        sources, llm_cases(config, cases), now
    )
    summary["smoke_rows"] = [
        {k: r[k] for k in ("eval_item_id", "arm", "status", "final_kind", "guard_passed", "guard_failures", "fallback_reason", "tokens_in", "tokens_out", "estimated_cost_usd", "actual_cost_usd", "usage_detail")}
        for r in rows
        if r["phase"] == "smoke"
    ]  # fmt: skip
    return {"summary": summary, "rows": rows, "cases": cases}


def _median(values):
    values = [v for v in values if v is not None]
    return round(statistics.median(values), 3) if values else None


def _p90(values):
    values = sorted(v for v in values if v is not None)
    return (
        round(values[min(len(values) - 1, int(0.9 * len(values)))], 3)
        if values
        else None
    )


def _arm_block(rows: list[dict]) -> dict[str, Any]:
    raw = [r for r in rows if r["guard_passed"] is not None]
    failures = Counter(f for r in rows for f in r["guard_failures"])
    return {
        "n": len(rows),
        "status_counts": dict(Counter(r["status"] for r in rows)),
        "guard_pass_rate": round(sum(r["guard_passed"] for r in raw) / len(raw), 3) if raw else None,
        "fallback_rate": round(sum(r["status"] == "fallback" for r in rows) / len(rows), 3) if rows else None,
        "spoiler_flags": {k: failures[k] for k in SPOILER_FAILURES},
        "unsupported_flags": {k: failures[k] for k in UNSUPPORTED_FAILURES},
        "generator_errors": dict(Counter(r["fallback_reason"] for r in rows if (r["fallback_reason"] or "").startswith("generator_error"))),  # fmt: skip
        "generation_ms": {"median": _median(r["generation_ms"] for r in rows), "p90": _p90([r["generation_ms"] for r in rows])},
        "validation_ms": {"median": _median(r["validation_ms"] for r in rows), "p90": _p90([r["validation_ms"] for r in rows])},
        "tokens_in": sum(r["tokens_in"] or 0 for r in rows),
        "tokens_out": sum(r["tokens_out"] or 0 for r in rows),
        "estimated_cost_usd": round(sum(r["estimated_cost_usd"] or 0 for r in rows), 6),
        "actual_cost_usd": round(sum(r["actual_cost_usd"] or 0 for r in rows), 6),
        "actual_cost_unknown": sum(r["raw_sha256"] is not None and r["actual_cost_usd"] is None for r in rows),
        "cache_hits": sum(r["cache_hit"] for r in rows),
    }  # fmt: skip


def consistency(rows: list[dict], arm: str) -> dict[str, Any]:
    """같은 사례 반복(arm 단계 1회 + repeat) — 최종 문장 일치율 · 원문 종류 수 · 검증 판단 일치율."""

    groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["arm"] == arm and r["phase"] in ("arm", "repeat") and not r["cache_hit"]:
            groups[r["eval_item_id"]].append(r)  # 캐시 적중은 독립 생성이 아니다
    groups = {k: v for k, v in groups.items() if len(v) > 1}
    if not groups:
        return {"cases": 0}
    return {
        "cases": len(groups),
        "runs_per_case": round(statistics.mean(len(v) for v in groups.values()), 2),
        "final_text_identical_rate": round(sum(len({r["final_text"] for r in v}) == 1 for v in groups.values()) / len(groups), 3),
        "distinct_raw_mean": round(statistics.mean(len({r["raw_sha256"] for r in v}) for v in groups.values()), 2),
        "guard_decision_agreement_rate": round(sum(len({r["guard_passed"] for r in v}) == 1 for v in groups.values()) / len(groups), 3),
    }  # fmt: skip


def summarize(
    rows, ledger: BudgetLedger, stop_reason, audit, config: P4B2Config, dry_run: bool
) -> dict[str, Any]:
    arms = {
        arm: _arm_block([r for r in rows if r["phase"] == "arm" and r["arm"] == arm])
        for arm in config.arms
    }
    baseline = [r for r in rows if r["phase"] == "check_in_baseline"]
    llm_rows = [
        r for r in rows if r["phase"] not in ("check_in_baseline", "template_feature")
    ]
    by_case: dict[str, set] = defaultdict(set)
    for r in rows:
        if r["phase"] == "arm":
            by_case[r["eval_item_id"]].add(r["input_sha256"])
    return {
        "note": "문장 본문 없음 · 구조 지표와 비용만. 품질(원문 · 최종)은 사람 평가 양식으로 따로 잰다. "
        + ("오프라인 전송 — 실제 모델 결과가 아니다." if dry_run else "실제 실행."),
        "experiment_version": EXPERIMENT_VERSION,
        "eval_set": config.eval_set,
        "config_version": config.config_version,
        "dry_run": dry_run,
        "stop_reason": stop_reason,
        "planned_requests": planned_requests(config),
        "sent_requests": ledger.requests,
        "ledger": ledger.totals(),
        "audit": audit,
        "phase_counts": dict(Counter(r["phase"] for r in rows)),
        "arms": arms,
        "smoke": _arm_block([r for r in rows if r["phase"] == "smoke"]),
        "consistency": {arm: consistency(rows, arm) for arm in config.arms},
        "check_in_baseline": {
            "n": len(baseline),
            "all_template": all(r["method"] == "template" for r in baseline),
            "status_counts": dict(Counter(r["status"] for r in baseline)),
        },
        "template_feature": {
            "n": len(feature := [r for r in rows if r["phase"] == "template_feature"]),
            "kinds": dict(Counter(r["final_kind"] for r in feature)),
            "all_template": all(r["method"] == "template" for r in feature),
            "guard_pass_rate": round(
                sum(bool(r["guard_passed"]) for r in feature) / len(feature), 3
            )
            if feature
            else None,
            "status_counts": dict(Counter(r["status"] for r in feature)),
        },
        "llm_kinds": list(config.llm_kinds),
        "distribution": distribution(rows),
        "input_mismatch_between_arms": sorted(
            k for k, v in by_case.items() if len(v) > 1
        ),
        "llm_rows": len(llm_rows),
    }


RATING_COLUMNS = (
    "raw_spoiler(none/in_level/over_level/direct)", "raw_unsupported_claim(y/n)", "raw_naturalness(1-5)",
    "raw_tone(1-5)", "raw_helpfulness(1-5)", "raw_grounding(1-5)", "raw_inference_room(1-5)",
    "final_spoiler(none/in_level/over_level/direct)", "final_unsupported_claim(y/n)", "final_naturalness(1-5)",
    "final_tone(1-5)", "final_helpfulness(1-5)", "final_grounding(1-5)", "final_inference_room(1-5)", "notes", "rater_id",
)  # fmt: skip
# grounding: 승인 힌트 · 근거에 충실한 정도 (1 = 근거 밖 내용이 많음 · 5 = 근거에만 기댐)
# inference_room: 플레이어에게 남겨 둔 추론의 여지 (1 = 풀이를 다 말함 · 5 = 방향만 줌)
RATERS = ("A", "B")  # 두 평가자가 서로 보지 않고 매기도록 파일을 나눈다


def write_rating_form(
    base: Path, rows: list[dict], cases: list[CommonCase], sources, now, tag: str = ""
) -> None:
    """사람 평가 양식(가림) — 생성기 · 군을 숨기고 섞는다. 짝 표(key)는 따로 둔다. 둘 다 제한 경로에만."""

    raw = {}
    raw_path = base / "raw.jsonl"
    replies: dict[str, str] = {}
    if raw_path.exists():
        for line in raw_path.read_text(encoding="utf-8").splitlines():
            d = json.loads(line)
            if d.get("raw_sha256"):  # 해석 실패 줄(parse_failed)에는 조립 발화가 없다
                raw[d["raw_sha256"]] = d["raw_text"]
            if d.get("model_reply_sha256"):
                replies[d["model_reply_sha256"]] = d.get("model_reply") or ""
    by_id = {c.item_id: c for c in cases}
    form, key = [], []
    for r in rows:
        if r["phase"] not in ("arm", "repeat") or r["eval_item_id"] not in by_id:
            continue
        c = by_id[r["eval_item_id"]]
        blind = hashlib.sha256(
            f"{r['generator']}|{r['eval_item_id']}|{r['phase']}|{r['repeat']}".encode()
        ).hexdigest()[:12]
        form.append({
            "blind_id": blind, "kind": r["final_kind"], "player_message": c.plan.player_message or "",
            "raw_text": raw.get(r["raw_sha256"], ""), "final_text": r["final_text"] or "",  # 2) 조립 발화 · 3) 최종
            "replaced_by_template": "y" if r["status"] == "fallback" else "n",
            **{col: "" for col in RATING_COLUMNS},
        })  # fmt: skip
        # 짝 표 — 평가가 끝날 때까지 열지 않는다. 군 · 모델 · 모델 답(JSON 모양이 군을 드러낸다) · 자동 단계 초과 표시
        key.append({"blind_id": blind, "generator": r["generator"], "item_id": r["eval_item_id"], "phase": r["phase"], "repeat": r["repeat"],
                    "cache_hit": r["cache_hit"], "model_reply": replies.get(r.get("model_reply_sha256") or "", ""),
                    "auto_level_suspect": bool((r.get("paraphrase") or {}).get("level_suspect"))})  # fmt: skip
    form.sort(key=lambda x: x["blind_id"])
    base.mkdir(parents=True, exist_ok=True)
    fields = list(form[0]) if form else ["blind_id"]
    for name in [f"rating_form{tag}.csv"] + [
        f"rating_form{tag}_rater_{r}.csv" for r in RATERS
    ]:
        rater = name.rsplit("_rater_", 1)[1][0] if "_rater_" in name else ""
        with (base / name).open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            writer.writerows(
                [row | {"rater_id": rater} for row in form] if form else []
            )
    (base / f"rating_key{tag}.json").write_text(json.dumps(key, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")  # fmt: skip


def reproduction(config: P4B2Config, raw_config: dict, root: Path) -> dict[str, Any]:
    from companion_npc.training.provenance import _git, source_sha256

    def ver(name):
        try:
            return version(name)
        except PackageNotFoundError:
            return None

    status = _git(root, "status", "--porcelain", "--", ".")
    return {
        "experiment_config_sha256": canonical_sha256(raw_config),
        "generator_config": config.generator.model_dump(mode="json"),
        "model_record": config.model_record.model_dump(mode="json"),
        "prompt_version": config.generator.prompt_version,
        "source_sha256": source_sha256(root),
        "git_commit": _git(root, "rev-parse", "HEAD"),
        "git_dirty": bool(status) if status is not None else None,
        "python": platform.python_version(),
        "packages": {name: ver(name) for name in ("pydantic", "openai")},
    }


def summary_is_clean(summary: dict, forbidden: list[str]) -> bool:
    text = json.dumps(summary, ensure_ascii=False)
    return not find_answer_leaks({"summary": text}, forbidden)


def load_private_texts(root: Path, files: list[str]) -> list[str]:
    texts = []
    for f in files:
        data = json.loads((root / f).read_text(encoding="utf-8"))
        for k, v in data.items():
            if k.startswith("_"):
                continue
            for values in v.values() if isinstance(v, dict) else [v]:
                texts += [t for t in values if isinstance(t, str)]
    return texts


def verify_file_sha256(path: Path, expected: str) -> bool:
    """받은 모델 파일 해시 확인 (설치 때 쓴다. 이번 단계에서는 실행하지 않는다)."""

    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest() == expected.lower()


def local_preflight(config: LLMConfig) -> list[str]:
    """로컬 서버 설정 검사 — 연결하지 않는다. 비어 있으면 통과."""

    problems = []
    if config.provider != "openai_compatible_local":
        return ["not a local provider"]
    if not (config.base_url or "").startswith("http://127.0.0.1:"):
        problems.append("base_url must be http://127.0.0.1:<port>/v1")
    if not (config.base_url or "").rstrip("/").endswith("/v1"):
        problems.append("base_url must end with /v1")
    if not config.disable_thinking:
        problems.append("disable_thinking must be true for Qwen3")
    if not config.structured_output:
        problems.append("structured_output should be true")
    if config.reasoning_effort is not None:
        problems.append("reasoning_effort is an OpenAI option")
    if config.budget.max_usd != 0:
        problems.append("local runs should have max_usd 0")
    return problems


def ledger_path(root: Path, config: P4B2Config) -> Path:
    """설정 판과 관계없이 이어지는 예산 장부 — runs/restricted/_budget/<이름>.json"""

    return restricted_dir(root, "_budget") / f"{config.ledger_name}.json"


def public_error(detail: dict | None) -> dict | None:
    """요약에 남길 오류 원인 — 상태 · 코드 · 종류 · 인자 이름만. 메시지 본문은 제한 경로(errors.jsonl)에만."""

    if not detail:
        return None
    return {k: detail.get(k) for k in ("kind", "status_code", "code", "type", "param")}


def manifest(cases: list[CommonCase], rows: list[dict]) -> dict[str, Any]:
    """평가 세트를 특정하는 값 — 사례 ID 목록과 (사례 ID · 입력 해시)의 해시. 본문은 없다."""

    inputs = {r["eval_item_id"]: r["input_sha256"] for r in rows if r["phase"] == "arm"}
    ids = sorted(c.item_id for c in cases)
    material = "\n".join(f"{i}\t{inputs.get(i)}" for i in ids)
    return {
        "n": len(ids),
        "by_case": dict(Counter(c.case_id for c in cases)),
        "item_ids_sha256": hashlib.sha256("\n".join(ids).encode()).hexdigest(),
        "items_inputs_sha256": hashlib.sha256(material.encode()).hexdigest(),
    }


class ExternalTransferPolicy(ContractModel):
    """외부 API 로 보내도 되는 사건 — 사람이 정한 목록(experiments/p4/external_transfer.json)."""

    decided_at: str
    allowed_cases: list[str]
    allowed_cases_dir_prefix: str  # 이 경로 아래의 테스트용 사건만
    denied_cases: list[str] = Field(default_factory=list)
    denied_cases_dir: str | None = (
        None  # 금지 사건의 정답을 읽어 전송 직전 검사에 넣는다(서버 쪽에서만)
    )


def external_transfer_problems(
    config: P4B2Config, policy: ExternalTransferPolicy
) -> list[str]:
    """외부 제공자(OpenAI)로 보내기 전 확인 — 비어 있어야 실행한다. 로컬 제공자는 해당 없음."""

    if config.generator.provider != "openai":
        return []
    problems = []
    for c in config.cases:
        if c.case_id in policy.denied_cases or c.case_id not in policy.allowed_cases:
            problems.append(f"case not allowed for external transfer: {c.case_id}")
        if not Path(c.cases_dir).as_posix().startswith(policy.allowed_cases_dir_prefix):
            problems.append(f"cases_dir is not a test fixture path: {c.case_id}")
    return problems


def pre_manifest(
    sources, cases: list[CommonCase], now: datetime, policy: str = "tier_le"
) -> dict[str, Any]:
    """실행 전에 계산하는 평가 세트 해시 — 사례 ID 와 모델 입력 해시(템플릿 경로로 만든 같은 입력)."""

    pairs = []
    for c in sorted(cases, key=lambda x: x.item_id):
        merged, terms = sources[c.source]
        out = speak(
            c.context,
            c.plan,
            merged,
            TemplateGenerator(),
            SpeechGuard(merged.pack, terms),
            now=now,
            evidence_policy=policy,
        )
        pairs.append(f"{c.item_id}\t{input_sha256(out)}")
    return {
        "n": len(pairs),
        "items_inputs_sha256": hashlib.sha256("\n".join(pairs).encode()).hexdigest(),
    }


def llm_cases(config: P4B2Config, cases: list[CommonCase]) -> list[CommonCase]:
    return [c for c in cases if c.final_kind in config.llm_kinds]


def stratified(cases: list[CommonCase], n: int) -> list[CommonCase]:
    """사건 × 유형 묶음을 돌아가며 하나씩 — 결정적. n 이 묶음 수보다 크면 다시 돈다."""

    groups: dict[tuple, list[CommonCase]] = defaultdict(list)
    for c in cases:
        groups[(c.case_id, c.final_kind)].append(c)
    keys = sorted(groups)
    picked, round_ = [], 0
    while len(picked) < n and any(len(groups[k]) > round_ for k in keys):
        for k in keys:
            if len(picked) < n and len(groups[k]) > round_:
                picked.append(groups[k][round_])
        round_ += 1
    return picked


def distribution(rows: list[dict]) -> dict[str, Any]:
    """단계 · 군 · 사건 · 유형별 사례 수 — 본 실험 전에 부족한 칸을 본다."""

    out: dict[str, Counter] = defaultdict(Counter)
    for r in rows:
        out[r["phase"]][f"{r['arm']}|{r['case_id']}|{r['final_kind']}"] += 1
    return {k: dict(sorted(v.items())) for k, v in out.items()}


def _pre_send(merged: MergedPack, terms: list[str], private_texts: list[str]):
    def check(messages: list[dict[str, str]]) -> list[str]:
        return audit_input(
            "\n".join(m["content"] for m in messages), merged, terms, private_texts
        )

    return check


def _usage_detail(outcome) -> dict | None:
    if outcome.raw is None or outcome.raw.method == "template":
        return None
    n = outcome.raw.notes
    return {
        k: n.get(k)
        for k in (
            "cached_tokens",
            "cache_write_tokens",
            "reasoning_tokens",
            "finish_reason",
            "cache_hit",
        )
    }


def usage_fields(rows: list[dict]) -> dict[str, Any]:
    """실제 응답에서 사용량 필드가 왔는지 — 필드별로 값이 있던 요청 수."""

    llm = [r for r in rows if r.get("usage_detail")]
    out = {"responses": len(llm)}
    out["prompt_tokens"] = sum(r["tokens_in"] is not None for r in llm)
    out["completion_tokens"] = sum(r["tokens_out"] is not None for r in llm)
    for k in (
        "cached_tokens",
        "cache_write_tokens",
        "reasoning_tokens",
        "finish_reason",
    ):
        out[k] = sum(r["usage_detail"].get(k) is not None for r in llm)
    return out


def request_params(config: P4B2Config) -> dict[str, Any]:
    """보낸 요청 인자(메시지 본문 제외) — 군별."""

    from companion_npc.speech.llm import build_request

    out = {}
    for arm in config.arms:
        cfg = config.generator.model_copy(update={"prompt_mode": arm})
        req = build_request([{"role": "user", "content": ""}], cfg)
        req.pop("messages")
        if "response_format" in req:
            req["response_format"] = {"type": req["response_format"]["type"], "name": req["response_format"]["json_schema"]["name"], "strict": req["response_format"]["json_schema"]["strict"]}  # fmt: skip
        out[arm] = req
    return out


def denied_forbidden_terms(
    policy: ExternalTransferPolicy, config: P4B2Config, root: Path
) -> list[str]:
    """외부 전송이 금지된 사건의 정답 · 별칭 — 전송 직전 검사용. 이 목록은 요청 · 기록 · 요약에 넣지 않는다."""

    from companion_npc.adapters.npc_merge import forbidden_terms_for

    if not policy.denied_cases_dir:
        return []
    aliases = json.loads((root / config.aliases_file).read_text(encoding="utf-8"))
    terms = []
    for case_id in policy.denied_cases:
        terms += forbidden_terms_for(
            root / policy.denied_cases_dir, case_id, tuple(aliases.get(case_id, []))
        )
    return terms


# ── 바꿔 말하기 · 근거 지표 (판 4) ───────────────────────────
def edit_distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def paraphrase_metrics(outcome, merged: MergedPack) -> dict | None:
    """nudge · hint 의 조립 발화를 승인 힌트와 비교 — 숫자만 남긴다(본문 없음).

    level_suspect 는 사람 검토용 표시다. 다른 단계 힌트 문구(8자)가 보이거나, 다른 단계 힌트 조각을 근거로
    썼다고 답했으면 켠다. 근거 개수만으로는 켜지 않는다 — 단계 초과를 자동으로 확정하지 않는다.
    """

    payload, raw = outcome.payload, outcome.raw
    if (
        payload is None
        or raw is None
        or payload.approved_hint is None
        or payload.kind not in ("nudge", "hint")
    ):
        return None
    hint_norm, raw_norm = normalize(payload.approved_hint.text), normalize(raw.text)
    level = payload.npc_hint_level
    approved_id = payload.label_map.get(payload.approved_hint.label)
    target = next(
        (h.puzzle_id for h in merged.pack.hints if h.hint_id == approved_id), None
    )
    other = [
        normalize(h.text)
        for h in merged.pack.hints
        if h.puzzle_id == target and h.npc_hint_level != level
    ]
    other_windows = {t[i : i + 8] for t in other for i in range(max(len(t) - 7, 1))}
    chunks = {k.chunk_id: k for k in merged.pack.knowledge}
    used = [payload.label_map.get(label) for label in raw.used_labels]
    used_chunks = [chunks[c] for c in used if c in chunks]
    other_level_used = any(
        c.kind == "hint" and c.spoiler_tier != level for c in used_chunks
    )
    distance = edit_distance(raw_norm, hint_norm)
    return {
        "exact_match": raw_norm == hint_norm,
        "contains_verbatim": hint_norm in raw_norm,
        "edit_distance_norm": round(
            distance / max(len(raw_norm), len(hint_norm), 1), 3
        ),
        "evidence_count": len([u for u in used if u and u != approved_id]),
        "multi_evidence": len(raw.used_labels) > 1,
        "level_suspect": bool(
            other_windows and any(w in raw_norm for w in other_windows)
        )
        or other_level_used,
    }


def paraphrase_block(rows: list[dict]) -> dict[str, Any]:
    out = {}
    for kind in ("nudge", "hint"):
        ms = [
            r["paraphrase"]
            for r in rows
            if r.get("paraphrase") and r["final_kind"] == kind
        ]
        mine = [
            r
            for r in rows
            if r["final_kind"] == kind and r.get("guard_passed") is not None
        ]
        if not ms and not mine:
            continue
        out[kind] = {
            "n": len(ms),
            "exact_match_rate": round(sum(m["exact_match"] for m in ms) / len(ms), 3)
            if ms
            else None,
            "contains_verbatim_rate": round(
                sum(m["contains_verbatim"] for m in ms) / len(ms), 3
            )
            if ms
            else None,
            "edit_distance_norm_mean": round(
                statistics.mean(m["edit_distance_norm"] for m in ms), 3
            )
            if ms
            else None,
            "evidence_count_mean": round(
                statistics.mean(m["evidence_count"] for m in ms), 2
            )
            if ms
            else None,
            "multi_evidence_rate": round(
                sum(m["multi_evidence"] for m in ms) / len(ms), 3
            )
            if ms
            else None,
            "guard_block_rate": round(
                sum(not r["guard_passed"] for r in mine) / len(mine), 3
            )
            if mine
            else None,
            "fallback_rate": round(
                sum(r["status"] == "fallback" for r in mine) / len(mine), 3
            )
            if mine
            else None,
            "level_suspect_items": sorted(
                r["eval_item_id"]
                for r in rows
                if (r.get("paraphrase") or {}).get("level_suspect")
                and r["final_kind"] == kind
            ),  # fmt: skip
        }
    return out


def evidence_comparison(
    sources, cases: list[CommonCase], now: datetime
) -> dict[str, Any]:
    """같은 LLM 사례에서 근거 정책별로 모델에 가는 근거 조각을 센다(본문 · ID 없음, 종류 · 등급 집계만)."""

    out = {}
    for policy in ("tier_le", "same_level"):
        per_kind: dict[str, dict] = {}
        for c in cases:
            merged, terms = sources[c.source]
            o = speak(c.context, c.plan, merged, TemplateGenerator(), SpeechGuard(merged.pack, terms), now=now, evidence_policy=policy)  # fmt: skip
            if o.payload is None:
                continue
            chunks = {k.chunk_id: k for k in merged.pack.knowledge}
            ev = [
                chunks.get(o.payload.label_map.get(e.label)) for e in o.payload.evidence
            ]
            ev = [e for e in ev if e is not None]
            level = o.payload.npc_hint_level
            k = per_kind.setdefault(o.final_kind, {"cases": 0, "evidence_total": 0, "by_kind_tier": Counter(), "cases_with_other_level_hint": 0, "cases_with_lower_tier_target": 0})  # fmt: skip
            k["cases"] += 1
            k["evidence_total"] += len(ev)
            k["by_kind_tier"].update(f"{e.kind}:{e.spoiler_tier}" for e in ev)
            k["cases_with_other_level_hint"] += any(
                e.kind == "hint" and e.spoiler_tier != level for e in ev
            )
            k["cases_with_lower_tier_target"] += any(
                e.puzzle_id is not None and 0 < e.spoiler_tier < level for e in ev
            )
        for k in per_kind.values():
            k["by_kind_tier"] = dict(sorted(k["by_kind_tier"].items()))
            k["evidence_mean"] = (
                round(k["evidence_total"] / k["cases"], 2) if k["cases"] else None
            )
        out[policy] = per_kind
    return out


def phase_request_budget(config: P4B2Config, phases: tuple[str, ...]) -> int:
    """고른 단계의 계획 요청 수 — 이번 실행의 요청 상한(재시도 포함). 재시도가 나면 뒤 사례가 남는다(넘지 않는다)."""

    p = config.plan
    per = {
        "smoke": p.smoke,
        "arm": p.arm_cases * len(config.arms),
        "repeat": p.repeat_cases * p.repeat_times,
    }
    return sum(per[ph] for ph in phases)


def status_by_cell(rows: list[dict]) -> dict[str, Any]:
    """단계 · 군 · 사건 · 유형별 상태(통과 · 대체 · 보류) · 검증 통과율 · 지연 중앙값 — 본문 없음."""

    cells: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["phase"] in ("smoke", "arm", "repeat"):
            cells[f"{r['phase']}|{r['arm']}|{r['case_id']}|{r['final_kind']}"].append(r)
    out = {}
    for key, rs in sorted(cells.items()):
        raw = [r for r in rs if r["guard_passed"] is not None]
        out[key] = {
            "n": len(rs),
            "status_counts": dict(Counter(r["status"] for r in rs)),
            "guard_pass_rate": round(sum(r["guard_passed"] for r in raw) / len(raw), 3)
            if raw
            else None,
            "generation_ms_median": _median(r["generation_ms"] for r in rs),
            "tokens_out": sum(r["tokens_out"] or 0 for r in rs),
        }
    return out


AGREEMENT_COLUMNS = ("raw_spoiler(none/in_level/over_level/direct)", "final_spoiler(none/in_level/over_level/direct)", "raw_unsupported_claim(y/n)", "final_unsupported_claim(y/n)")  # fmt: skip
ORDINAL_COLUMNS = tuple(c for c in RATING_COLUMNS if c.endswith("(1-5)"))
SPOILER_ORDER = {"none": 0, "in_level": 1, "over_level": 2, "direct": 3}


def weighted_kappa(pairs: list[tuple[int, int]], k: int) -> float | None:
    """이차 가중 카파 (순서가 있는 1~k 점 · 0 부터 k-1 로 바꿔 넣는다)."""

    n = len(pairs)
    if n == 0:
        return None
    obs = [[0.0] * k for _ in range(k)]
    for x, y in pairs:
        obs[x][y] += 1
    ra = [sum(row) for row in obs]
    rb = [sum(obs[i][j] for i in range(k)) for j in range(k)]
    w = [[((i - j) ** 2) / ((k - 1) ** 2) for j in range(k)] for i in range(k)]
    num = sum(w[i][j] * obs[i][j] for i in range(k) for j in range(k))
    den = sum(w[i][j] * ra[i] * rb[j] / n for i in range(k) for j in range(k))
    return round(1 - num / den, 3) if den else None


def _read_form(path: Path) -> dict[str, dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return {row["blind_id"]: row for row in csv.DictReader(f)}


def _agreement_stats(a: dict, b: dict, ids: list[str]) -> dict[str, Any]:
    """주어진 항목(ids)에 대한 칸별 일치도."""

    out: dict[str, Any] = {"n": len(ids)}
    for col in AGREEMENT_COLUMNS:
        pairs = [(a[i].get(col, "").strip(), b[i].get(col, "").strip()) for i in ids]
        pairs = [(x, y) for x, y in pairs if x and y]
        if not pairs:
            out[col] = {"rated_by_both": 0}
            continue
        po = sum(x == y for x, y in pairs) / len(pairs)
        labels = {x for p in pairs for x in p}
        pe = sum((sum(x == lab for x, _ in pairs) / len(pairs)) * (sum(y == lab for _, y in pairs) / len(pairs)) for lab in labels)  # fmt: skip
        block = {"rated_by_both": len(pairs), "agreement": round(po, 3), "kappa": round((po - pe) / (1 - pe), 3) if pe < 1 else None}  # fmt: skip
        if "spoiler" in col and all(
            x in SPOILER_ORDER and y in SPOILER_ORDER for x, y in pairs
        ):
            block["weighted_kappa"] = weighted_kappa(
                [(SPOILER_ORDER[x], SPOILER_ORDER[y]) for x, y in pairs], 4
            )
        out[col] = block
    for col in ORDINAL_COLUMNS:
        pairs = []
        for i in ids:
            x, y = a[i].get(col, "").strip(), b[i].get(col, "").strip()
            if x.isdigit() and y.isdigit() and 1 <= int(x) <= 5 and 1 <= int(y) <= 5:
                pairs.append((int(x) - 1, int(y) - 1))
        out[col] = {
            "rated_by_both": len(pairs),
            "weighted_kappa": weighted_kappa(pairs, 5),
            "exact": round(sum(x == y for x, y in pairs) / len(pairs), 3)
            if pairs
            else None,
            "within_1": round(sum(abs(x - y) <= 1 for x, y in pairs) / len(pairs), 3)
            if pairs
            else None,
        }
    return out


def _cache_duplicate_pairs(
    key_rows: list[dict], records: Path | None
) -> list[tuple[str, str]] | None:
    """(원래 생성 blind_id, 캐시 중복 blind_id) 쌍 — 실행 기록의 cache_key 로만 잇는다(문장이 같다고 잇지 않는다).

    records 가 없으면 쌍을 알 수 없다 → None.
    """

    if records is None:
        return None
    rows = [
        json.loads(line)
        for line in records.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    by_item = {
        (r["eval_item_id"], r["generator"], r["phase"], r["repeat"]): r for r in rows
    }
    original = {
        (r["generator"], r["cache_key"]): (r["eval_item_id"], r["phase"], r["repeat"])
        for r in rows
        if r.get("cache_key") and not r["cache_hit"]
    }
    blind = {
        (k["item_id"], k["generator"], k["phase"], k["repeat"]): k["blind_id"]
        for k in key_rows
    }
    pairs = []
    for k in key_rows:
        if not k.get("cache_hit"):
            continue
        rec = by_item.get((k["item_id"], k["generator"], k["phase"], k["repeat"]))
        src = original.get((k["generator"], rec["cache_key"])) if rec else None
        if src and (src[0], k["generator"], src[1], src[2]) in blind:
            pairs.append(
                (blind[(src[0], k["generator"], src[1], src[2])], k["blind_id"])
            )
    return pairs


def _intra_rater(form: dict, pairs: list[tuple[str, str]]) -> dict[str, Any]:
    """같은 문장(캐시 중복)을 같은 평가자가 같게 매겼는가 — 칸 단위 일치율."""

    cols = AGREEMENT_COLUMNS + ORDINAL_COLUMNS
    same = total = 0
    for x, y in pairs:
        for c in cols:
            u, v = form[x].get(c, "").strip(), form[y].get(c, "").strip()
            if u and v:
                total += 1
                same += u == v
    return {
        "pairs": len(pairs),
        "cells_compared": total,
        "identical_rate": round(same / total, 3) if total else None,
    }


def rating_agreement(
    form_a: Path, form_b: Path, key: Path | None = None, records: Path | None = None
) -> dict[str, Any]:
    """두 평가자 양식의 일치도와 안전 검토 대상.

    · 범주 칸(스포일러 · 근거 없는 주장): 일치율 · 코헨 카파. 스포일러는 순서가 있어 이차 가중 카파도 낸다.
    · 1~5 점 칸: 이차 가중 카파 · 정확 일치율 · ±1 일치율.
    · 안전 검토 대상: 한 명이라도 over_level · direct 로 매기거나 근거 없는 주장(y)으로 매긴 항목 — 최종 검토에 남긴다.
      메모의 META: · LOCATION: 항목은 따로 모은다(meta_note_ids · location_note_ids).
    · key(짝 표)는 **두 독립 평가가 끝난 뒤에만** 준다. 주면:
        - 자동 단계 초과 표시와 대조한다(auto_vs_human).
        - 짝 표의 cache_hit 로 캐시 중복을 가려, 전체 기준과 캐시 중복을 뺀 기준의 일치도를 함께 낸다.
          문장이 같다는 이유로는 빼지 않는다(우연히 같은 문장은 남는다).
        - records(실행 기록)도 주면 캐시 중복과 원래 생성을 cache_key 로 이어 평가자 내 일관성을 낸다.
      key 가 없으면 중복 제외를 하지 않는다(전체 기준만).
    결과에는 blind_id 와 숫자만 남긴다.
    """

    a, b = _read_form(form_a), _read_form(form_b)
    ids = sorted(set(a) & set(b))
    out: dict[str, Any] = {"items": len(ids), "missing": sorted(set(a) ^ set(b))}
    out.update(
        {k: v for k, v in _agreement_stats(a, b, ids).items() if k != "n"}
    )  # 전체 기준(기존 모양 유지)
    spoil, unsup = AGREEMENT_COLUMNS[:2], AGREEMENT_COLUMNS[2:]
    review = [i for i in ids if any(r[i].get(c, "").strip() in ("over_level", "direct") for r in (a, b) for c in spoil)
              or any(r[i].get(c, "").strip() == "y" for r in (a, b) for c in unsup)]  # fmt: skip
    out["conservative_leak_ids"] = [i for i in ids if any(r[i].get(c, "").strip() in ("over_level", "direct") for r in (a, b) for c in spoil)]  # fmt: skip
    out["safety_review_ids"] = (
        review  # 한 명이라도 누설 · 단계 초과 · 근거 없는 주장을 의심한 항목
    )
    out["meta_note_ids"] = [
        i for i in ids if any("META:" in r[i].get("notes", "") for r in (a, b))
    ]
    out["location_note_ids"] = [
        i for i in ids if any("LOCATION:" in r[i].get("notes", "") for r in (a, b))
    ]
    if key is not None:
        key_rows = json.loads(key.read_text(encoding="utf-8"))
        flags = {k["blind_id"]: bool(k.get("auto_level_suspect")) for k in key_rows}
        human = set(out["conservative_leak_ids"])
        auto = {i for i in ids if flags.get(i)}
        out["auto_vs_human"] = {
            "auto_flagged": len(auto),
            "human_flagged": len(human),
            "both": len(auto & human),
            "human_only": sorted(human - auto),  # 자동 지표가 놓친 것 — 사각지대
            "auto_only": sorted(auto - human),
        }
        dup = sorted(
            k["blind_id"]
            for k in key_rows
            if k.get("cache_hit") and k["blind_id"] in set(ids)
        )
        kept = [i for i in ids if i not in set(dup)]
        out["by_sample"] = {
            "all_rows": _agreement_stats(a, b, ids),  # 전체 (캐시 중복 포함)
            "excluding_cache_duplicates": _agreement_stats(
                a, b, kept
            ),  # 독립 생성 표본
        }
        pairs = _cache_duplicate_pairs(key_rows, records)
        out["cache_duplicates"] = {
            "n": len(dup),
            "ids": dup,
            "rows_all": len(ids),
            "rows_independent": len(kept),
            "pairs_linked": None if pairs is None else len(pairs),
            "intra_rater": None
            if pairs is None
            else {"A": _intra_rater(a, pairs), "B": _intra_rater(b, pairs)},
        }
    return out


def phase_gate(config: P4B2Config, wanted: tuple[str, ...]) -> str | None:
    """--execute 로 돌릴 단계가 승인됐는지. 문제가 있으면 이유 문자열."""

    if not wanted:
        return "--phases 를 지정해야 합니다"
    unknown = set(wanted) - {"smoke", "arm", "repeat"}
    if unknown:
        return f"알 수 없는 단계 {sorted(unknown)}"
    if not set(wanted) <= set(config.approved_phases):
        return f"--phases 는 승인된 단계 {config.approved_phases} 안에서만 지정할 수 있습니다"
    return None


def duplicate_report(rows: list[dict], config: P4B2Config) -> dict[str, Any]:
    """사례 수 · 고유 입력 수 · 캐시 적중 · 실제 신규 요청을 나눠 센다. 원본 사례 기준과 고유 입력 기준 지표를 함께 낸다.

    캐시 적중은 재생성이 아니다 — 같은 답을 다시 쓴 것이다. 반복 실험(repeat)으로도 세지 않는다.
    """

    out = {}
    for arm in config.arms:
        rs = [r for r in rows if r["phase"] == "arm" and r["arm"] == arm]
        if not rs:
            continue
        uniq: dict[str, dict] = {}
        for r in rs:
            uniq.setdefault(r["input_sha256"], r)  # 같은 입력의 첫 행(실제 생성)만
        unique_rows = list(uniq.values())
        out[arm] = {
            "cases": len(rs),
            "unique_inputs": len(unique_rows),
            "cache_hits": sum(r["cache_hit"] for r in rs),
            "new_generations": sum(
                1 for r in rs if r["model_reply_sha256"] and not r["cache_hit"]
            ),
            "duplicate_case_ids": sorted(
                {r["eval_item_id"] for r in rs if r["cache_hit"]}
            ),
            "by_cases": _dup_metrics(rs),  # 원본 사례 기준(같은 답이 두 번 들어간다)
            "by_unique_inputs": _dup_metrics(unique_rows),  # 고유 입력 기준
        }
    return out


def _dup_metrics(rs: list[dict]) -> dict[str, Any]:
    ps = [r["paraphrase"] for r in rs if r.get("paraphrase")]
    raw = [r for r in rs if r["guard_passed"] is not None]
    return {
        "n": len(rs),
        "guard_pass_rate": round(sum(r["guard_passed"] for r in raw) / len(raw), 3)
        if raw
        else None,
        "fallback_rate": round(sum(r["status"] == "fallback" for r in rs) / len(rs), 3)
        if rs
        else None,
        "exact_match_rate": round(sum(p["exact_match"] for p in ps) / len(ps), 3)
        if ps
        else None,
        "edit_distance_norm_mean": round(
            statistics.mean(p["edit_distance_norm"] for p in ps), 3
        )
        if ps
        else None,
        "multi_evidence_rate": round(sum(p["multi_evidence"] for p in ps) / len(ps), 3)
        if ps
        else None,
        "level_suspect": sum(p["level_suspect"] for p in ps),
    }


# ── 평가자 참고 자료 (판 4 arm · 모든 평가자에게 같은 자료) ─────────────────
REFERENCE_INTRO = """# 평가자 참고 자료 — P4-B2 판 4 arm

> 모든 평가자에게 같은 자료다. 테스트용 가상 사건의 **공개 정보**와 **NPC 단계별 승인 힌트**만 적었다.
> 정답 · 정답 별칭 · 숨은 오브젝트 · 공개 전 반전 · 실험 군 / 모델 정보 · 자동 위험 표시는 없다. 평가 행과의 대응표도 없다.
> 평가 양식(CSV)의 구조는 그대로다. 아래 표시는 `notes` 칸에 적는다.

## 이 자료를 쓰는 법

- 평가 행이 어느 사건 · 퍼즐 이야기인지는 발화 내용을 아래 공개 정보 · 승인 힌트와 맞춰 보고 판단한다.
- **발화만으로 퍼즐을 확정할 수 없으면** 추측하지 않는다. 그 행의 spoiler 칸은 비워 두고 `notes` 에 `CHECK:` 와 이유를 적는다(판정 보류).
- 아래에 퍼즐의 1 · 2단계 힌트를 **모두** 적은 것은 판정을 위한 참고용이다. 한 발화가 그 단계 힌트를 모두 써도 된다는 뜻이 아니다.
  - nudge 는 1단계까지, hint 는 2단계까지만 허용된다(아래 단계 기준).
- 원문(`raw_text`)은 모델이 낸 데이터 형식이 아니라 **조립된 발화 문장**이다. 원문과 최종 표시 발화(`final_text`)는 서로 독립적으로 평가한다.

## 단계 기준 (모든 사건 공통)

| 유형 | 허용 범위 |
|---|---|
| nudge (NPC 1단계) | 어디를 볼지 · 무엇에 주목할지. 그 퍼즐의 **1단계 승인 힌트**가 최대치다 |
| hint (NPC 2단계) | 무엇을 어떻게 할지. 그 퍼즐의 **2단계 승인 힌트**가 최대치다. 정답(값)은 말하지 않는다 |

- **단계 초과(over_level)**
  - 발화가 그 단계 승인 힌트보다 구체적인 풀이 절차를 준다.
  - 또는 이전 단계가 플레이어에게 맡겨 둔 **발견 과정(어디를 볼지 · 무엇을 고를지)** 을 함께 대신해 준다.
- **공개 배경 정보도 이전 단계의 발견을 대신할 수 있다.** 사건 소개 · 현재 위치 설명 · 보이는 오브젝트처럼 플레이어가 이미 볼 수 있는 정보라도, 발화가 그것을 풀이의 다음 행동과 묶어 가리키면 이전 단계의 발견을 대신하게 될 수 있다. 공개 정보라는 사실만으로 「단계 안」이라고 보지 않고, 발화가 플레이어에게 남겨 둔 일을 기준으로 판단한다.
- **콘텐츠 자체의 구체성과 모델이 더한 구체성은 구분한다.**
  - 승인 힌트 문장 자체가 지나치게 구체적이라고 보이면 `notes` 에 `CONTENT:` 로 적는다.
  - spoiler 칸은 발화가 승인 힌트보다 **더한 것**을 기준으로 매긴다.
- **직접 누설(direct)**: 정답 값이나 정답을 바로 알 수 있는 말.
- **근거 없는 주장(unsupported_claim = y)**: 아래 공개 정보 · 승인 힌트에 없는 사실 · 사건 · 해결 지시.
- **메타 정보 암시**: 비밀 · 반전 · 숨은 내용이 「있다」는 것을 긍정하거나 암시하면 spoiler 와 따로 `notes` 에 `META:` 로 적는다.
- **장소 · 대상 지시**: 발화가 승인 힌트에 없는 장소 · 대상을 새로 가리키면 `notes` 에 `LOCATION:` 으로 적는다(판정은 spoiler 칸에서 따로 한다).
- **추론 여지(inference_room)**: 1 = 풀이를 다 말해 플레이어가 할 일이 거의 없음 · 3 = 방향과 방법 일부를 줌 · 5 = 방향만 줌.
- 맥락이 부족해 단계를 판단할 수 없으면 임의로 추측하지 않고 `CHECK:` 로 보류한다.
"""


def build_rater_reference(
    sources: list[tuple[MergedPack, list[str]]],
    cases: list[CommonCase],
    forbidden: list[str],
    private_texts: list[str],
    denied_case_ids: list[str],
) -> str:
    """사건 단위 공개 정보 + 단계별 승인 힌트. 평가 행과 잇지 않는다. 누설 검사를 통과하지 못하면 만들지 않는다."""

    if any(m.pack.case_id in denied_case_ids for m, _ in sources):
        raise ValueError(
            "reference must not include cases denied for external transfer"
        )
    parts = [REFERENCE_INTRO]
    for n, (merged, _) in enumerate(sources, start=1):
        pack = merged.pack
        mine = [
            c for c in cases if c.source == n - 1 and c.final_kind in ("nudge", "hint")
        ]
        if not mine:
            continue
        premise = next((k.text for k in pack.knowledge if k.kind == "premise"), "")
        parts.append(f"## 사건 {n} — 공개 소개\n\n{premise}\n")
        zone_ids = sorted({c.context.state.current_zone_id for c in mine})
        state = mine[0].context.state
        for z in pack.zones:
            if z.zone_id not in zone_ids:
                continue
            visible = [
                o.object_name
                for o in pack.objects
                if o.zone_id == z.zone_id and o.initially_visible
            ]
            parts.append(
                f"- 현재 위치(평가 사례에서 플레이어가 있는 곳): {z.zone_name} — {z.description or ''}"
            )
            parts.append(f"  - 플레이어에게 보이는 오브젝트: {', '.join(visible)}")
        clues = (
            f"{len(state.acquired_clue_ids)}개" if state.acquired_clue_ids else "없음"
        )
        solved = (
            f"{len(state.completed_puzzle_ids)}개"
            if state.completed_puzzle_ids
            else "없음"
        )
        parts.append(f"- 획득한 단서: {clues} · 푼 퍼즐: {solved} (평가 사례 공통)\n")
        targets = sorted(
            {c.plan.target_puzzle_id for c in mine if c.plan.target_puzzle_id}
        )
        for t in targets:
            obj = next(
                (
                    o.object_name
                    for o in pack.objects
                    if o.puzzle_id == t and o.initially_visible
                ),
                "이름 없는 장치",
            )
            hints = sorted(
                (h for h in pack.hints if h.puzzle_id == t),
                key=lambda h: h.npc_hint_level,
            )
            parts.append(f"### 퍼즐: {obj}\n")
            for h in hints:
                parts.append(f"- NPC {h.npc_hint_level}단계 승인 힌트: {h.text}")
            if all(h.npc_hint_level != 2 for h in hints):
                parts.append(
                    "- NPC 2단계 승인 힌트: 없음 (이 퍼즐은 nudge 만 평가한다)"
                )
            parts.append("")
    text = "\n".join(parts).rstrip() + "\n"
    problems = []
    if find_answer_leaks({"reference": text}, forbidden):
        problems.append("answer_or_alias")
    if any(t and t in text for t in private_texts):
        problems.append("private_fixture_text")
    hidden = [
        o.object_name
        for m, _ in sources
        for o in m.pack.objects
        if not o.initially_visible
    ]
    if any(h in text for h in hidden):
        problems.append("hidden_object")
    lore = [k.text for m, _ in sources for k in m.pack.knowledge if k.kind == "lore"]
    norm = normalize(text)
    if any(
        normalize(w)[i : i + 8] in norm
        for w in lore
        for i in range(max(len(normalize(w)) - 7, 1))
    ):
        problems.append("undisclosed_twist")
    ids = [p.puzzle_id for m, _ in sources for p in m.pack.puzzles] + [
        h.hint_id for m, _ in sources for h in m.pack.hints
    ]
    if any(i in text for i in ids):
        problems.append("internal_id")
    if any(
        w in text
        for w in (
            "select",
            "free",
            "gpt",
            "luna",
            "A군",
            "B군",
            "opener",
            "closer",
            "level_suspect",
        )
    ):
        problems.append("arm_or_model_or_auto_flag")
    if problems:
        raise ValueError(f"rater reference failed checks: {problems}")
    return text


def write_rater_reference(config: P4B2Config, sources, root: Path, private_texts: list[str], forbidden: list[str], denied: list[str]) -> Path:  # fmt: skip
    """제한 경로(runs/restricted/<exp_id>/rater_reference_arm.md)에 쓴다. 평가 양식 · 대응표는 건드리지 않는다."""

    now = datetime.fromisoformat(config.now)
    cases, _ = build_common_cases(sources, now, private_texts, config.evidence_policy)
    text = build_rater_reference(
        sources, llm_cases(config, cases), forbidden, private_texts, denied
    )
    path = restricted_dir(root, config.exp_id) / "rater_reference_arm.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    return path
