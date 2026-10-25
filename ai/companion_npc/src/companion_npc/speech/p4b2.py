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
from dataclasses import dataclass
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
    restricted_dir,
    to_record,
)

EXPERIMENT_VERSION = "p4b2/0.1"
BASE_CATEGORIES = ("normal", "precondition", "player_attack")
HINT_REQUESTS = ("이거 어떻게 해야 해?", "힌트 좀 줄래?")
LEVEL2_EXTRA = "조금만 더 구체적으로 알려 줘."
# client(400 등)도 멈춘다 — 지원하지 않는 인자처럼 모든 요청에 되풀이될 오류에 예산을 쓰지 않으려고
STOP_KINDS = frozenset({"quota", "auth", "unavailable", "client"})
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
    model_record: ModelRecord
    # 평가 세트 판 — 사례 구성이 바뀌면 새 판. 결과 요약에 사례 목록 해시와 함께 남는다
    eval_set: str = Field(min_length=1)
    # 실험 설정 판 — 요청 인자를 바꾸면 새 판으로 나눈다(같은 판에서 인자를 고치지 않는다)
    config_version: str = "1"
    # 예산 장부 이름 — 같은 계정 예산을 쓰는 설정끼리 같은 장부를 쓴다(판을 나눠도 $2 · 100 요청이 이어진다)
    ledger_name: str = Field(pattern=r"^[a-z0-9_.-]+$")
    execution_approved: bool = False  # 사람이 승인한 뒤에만 true

    @model_validator(mode="after")
    def _within_budget(self) -> "P4B2Config":
        total = planned_requests(self)
        if total > self.generator.budget.max_requests:
            raise ValueError(
                f"plan needs {total} requests > cap {self.generator.budget.max_requests}"
            )
        if self.plan.arm_cases != self.expected_cases:
            raise ValueError("arm_cases must equal expected_cases")
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

    @property
    def item_id(self) -> str:
        return f"{self.case_id}/{self.name}"


def _llm_context(context: NpcContext) -> NpcContext:
    return context.model_copy(
        update={"limits": context.limits.model_copy(update={"allow_llm": True})}
    )


def _model_input_text(merged: MergedPack, terms: list[str], c: CommonCase, now: datetime) -> tuple[str | None, str | None]:  # fmt: skip
    """(모델에 갈 입력 문자열, 최종 유형). LLM 까지 가지 않으면 입력은 None."""

    guard = SpeechGuard(merged.pack, terms)
    out = speak(c.context, c.plan, merged, TemplateGenerator(), guard, now=now)
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
    sources: list[tuple[MergedPack, list[str]]], now: datetime, private_texts: list[str]
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
            text, kind = _model_input_text(merged, terms, c, now)
            if text is None:
                continue  # 보류 · check_in → LLM 대상 아님
            audit["checked"] += 1
            reasons = audit_input(text, merged, terms, private_texts)
            if reasons:
                audit["excluded"].append({"item_id": c.item_id, "reasons": reasons})
                continue
            audit["kinds"][kind] += 1
            cases.append(c)
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
    items = [
        ("smoke", config.arms[i % len(config.arms)], cases[i], 0)
        for i in range(min(p.smoke, len(cases)))
    ]
    for arm in config.arms:
        items += [("arm", arm, c, 0) for c in cases[: p.arm_cases]]
    chosen = sorted(
        cases, key=lambda c: hashlib.sha256(c.item_id.encode()).hexdigest()
    )[: p.repeat_cases]
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
) -> dict[str, Any]:
    now = datetime.fromisoformat(config.now)
    cases, audit = build_common_cases(sources, now, private_texts)
    if len(cases) != config.expected_cases:
        raise ValueError(
            f"common cases {len(cases)} != expected {config.expected_cases}"
        )
    exp = config.exp_id + ("_dryrun" if dry_run else "")
    base = restricted_dir(root, exp)
    if dry_run:
        for name in ("raw.jsonl", "records.jsonl"):
            if (base / name).exists():
                (base / name).unlink()
    ledger = BudgetLedger(config.generator.budget) if dry_run else BudgetLedger.load(config.generator.budget, ledger_path(root, config))  # fmt: skip
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
            **({"sleep": sleep} if sleep else {}),
        )
        outcome = speak(
            case.context, case.plan, merged, gen, guards[case.source], now=now
        )
        record = to_record(outcome, eval_item_id=case.item_id, case_id=case.case_id, generator=f"{config.generator.generator}:{arm}", experiment_version=EXPERIMENT_VERSION)  # fmt: skip
        raw_log.write(record, outcome)
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
        elif "generator_error:NotReadyError" in failures:
            stop_reason = "not_ready"
        if stop_reason:
            break
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
    (base / "records.jsonl").parent.mkdir(parents=True, exist_ok=True)
    (base / "records.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in rows), encoding="utf-8", newline="\n")  # fmt: skip
    write_rating_form(base, rows, cases, sources, now)
    summary = summarize(rows, ledger, stop_reason, audit, config, dry_run)
    summary["stop_detail"] = public_error(stop_detail)
    summary["eval_set_manifest"] = manifest(cases, rows)
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
        if r["arm"] == arm and r["phase"] in ("arm", "repeat"):
            groups[r["eval_item_id"]].append(r)
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
    llm_rows = [r for r in rows if r["phase"] != "check_in_baseline"]
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
        "input_mismatch_between_arms": sorted(
            k for k, v in by_case.items() if len(v) > 1
        ),
        "llm_rows": len(llm_rows),
    }


RATING_COLUMNS = (
    "raw_spoiler(none/in_level/over_level/direct)", "raw_unsupported_claim(y/n)", "raw_naturalness(1-5)",
    "raw_tone(1-5)", "raw_helpfulness(1-5)",
    "final_spoiler(none/in_level/over_level/direct)", "final_unsupported_claim(y/n)", "final_naturalness(1-5)",
    "final_tone(1-5)", "final_helpfulness(1-5)", "notes", "rater_id",
)  # fmt: skip


def write_rating_form(
    base: Path, rows: list[dict], cases: list[CommonCase], sources, now
) -> None:
    """사람 평가 양식(가림) — 생성기 · 군을 숨기고 섞는다. 짝 표(key)는 따로 둔다. 둘 다 제한 경로에만."""

    raw = {}
    raw_path = base / "raw.jsonl"
    if raw_path.exists():
        for line in raw_path.read_text(encoding="utf-8").splitlines():
            d = json.loads(line)
            raw[d["raw_sha256"]] = d["raw_text"]
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
            "raw_text": raw.get(r["raw_sha256"], ""), "final_text": r["final_text"] or "",
            "replaced_by_template": "y" if r["status"] == "fallback" else "n",
            **{col: "" for col in RATING_COLUMNS},
        })  # fmt: skip
        key.append({"blind_id": blind, "generator": r["generator"], "item_id": r["eval_item_id"], "phase": r["phase"], "repeat": r["repeat"]})  # fmt: skip
    form.sort(key=lambda x: x["blind_id"])
    base.mkdir(parents=True, exist_ok=True)
    with (base / "rating_form.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(form[0]) if form else ["blind_id"])
        writer.writeheader()
        writer.writerows(form)
    (base / "rating_key.json").write_text(json.dumps(key, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")  # fmt: skip


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
