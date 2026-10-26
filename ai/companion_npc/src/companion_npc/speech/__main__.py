"""발화 평가 실행 (네트워크 없음).

    $env:PYTHONPATH = "src"
    .\\.venv\\Scripts\\python.exe -m companion_npc.speech --config experiments\\p4\\p4a_speech.json --publish
    ... --mode guard_eval --config experiments\\p4\\p4b1_guard_eval.json --publish   (P4-B1 검증기 평가)
    ... --mode compare --config experiments\\p4\\p4b1_compare.json --publish         (P4-B1 비교 배관 · 오프라인)

출력: runs/p4/<exp_id>/records.jsonl · summary.json (깃 제외) · compare 원문은 runs/restricted/<exp_id>/
--publish : experiments/results/<exp_id>/summary.json 만 복사
"""

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path

from companion_npc.speech.compare import OfflineEchoTransport, aggregate, run_comparison
from companion_npc.speech.evaluate import (
    P4AConfig,
    load_paraphrases,
    load_sources,
    run_suite,
)
from companion_npc.speech.generators import TemplateGenerator
from companion_npc.speech.guard_eval import (
    GuardEvalConfig,
    load_guard_inputs,
    run_guard_eval,
)
from companion_npc.speech.llm import BudgetLedger, LLMConfig, LLMGenerator
from companion_npc.speech.p4b2 import (
    ExternalTransferPolicy,
    P4B2Config,
    denied_forbidden_terms,
    external_transfer_problems,
    load_private_texts,
    public_error,
    reproduction,
    run_p4b2,
    summary_is_clean,
)
from companion_npc.speech.records import RawLog, restricted_dir

ROOT = Path(__file__).resolve().parents[3]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run P4-A speech evaluation.")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument(
        "--mode", choices=("p4a", "guard_eval", "compare", "p4b2"), default="p4a"
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="p4b2: 실제 요청. 설정 승인 + COMPANION_NPC_ALLOW_NETWORK=1 이 모두 필요",
    )
    parser.add_argument(
        "--phases",
        default=None,
        help="p4b2: 돌릴 단계 (쉼표로 구분: smoke,arm,repeat). 없으면 전부",
    )
    args = parser.parse_args(argv)
    raw = json.loads(args.config.read_text(encoding="utf-8"))
    raw = {k: v for k, v in raw.items() if not k.startswith("_")}
    if args.mode == "guard_eval":
        g = GuardEvalConfig.model_validate(raw)
        paraphrases, private = load_guard_inputs(g, ROOT)
        result = run_guard_eval(
            load_sources(g, ROOT), datetime.fromisoformat(g.now), paraphrases, private
        )
        _write(g.exp_id, result["records"], result["summary"], args.publish)
        print(json.dumps(result["summary"]["overall"], ensure_ascii=False))
        return 0 if not result["summary"]["invalid"] else 1
    if args.mode == "p4b2":
        return _p4b2(raw, args.publish, args.execute, args.phases)
    config = P4AConfig.model_validate(raw)
    if args.mode == "compare":
        return _compare(config, args.publish)
    result = run_suite(
        load_sources(config, ROOT),
        datetime.fromisoformat(config.now),
        load_paraphrases(config, ROOT),
    )
    out = ROOT / "runs" / "p4" / config.exp_id
    out.mkdir(parents=True, exist_ok=True)
    (out / "records.jsonl").write_text(
        "".join(
            json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n"
            for r in result["records"]
        ),
        encoding="utf-8",
        newline="\n",
    )
    (out / "summary.json").write_text(
        json.dumps(result["summary"], ensure_ascii=False, sort_keys=True, indent=2)
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    if args.publish:
        target = ROOT / "experiments" / "results" / config.exp_id
        target.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(out / "summary.json", target / "summary.json")
    print(json.dumps(result["summary"], ensure_ascii=False, indent=2))
    return (
        0
        if not result["summary"]["unexpected"] and not result["summary"]["final_leaks"]
        else 1
    )


def _write(exp_id: str, records: list, summary: dict, publish: bool) -> None:
    out = ROOT / "runs" / "p4" / exp_id
    out.mkdir(parents=True, exist_ok=True)
    (out / "records.jsonl").write_text(
        "".join(
            json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in records
        ),
        encoding="utf-8",
        newline="\n",
    )
    text = json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    (out / "summary.json").write_text(text, encoding="utf-8", newline="\n")
    if publish:
        target = ROOT / "experiments" / "results" / exp_id
        target.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(out / "summary.json", target / "summary.json")


def _compare(config: P4AConfig, publish: bool) -> int:
    """템플릿 vs 오프라인 전송 LLM 생성기 — 계약 · 기록 배관 확인. 네트워크를 쓰지 않는다."""

    echo = LLMConfig(
        generator="qwen_local",
        provider="openai_compatible_local",
        model="offline-echo",
        base_url="offline://echo",
        budget={"max_usd": 0.0, "max_requests": 1000},
    )
    ledger = BudgetLedger(echo.budget)
    restricted = restricted_dir(ROOT, config.exp_id)
    if (restricted / "raw.jsonl").exists():
        (restricted / "raw.jsonl").unlink()
    records = run_comparison(
        load_sources(config, ROOT),
        {
            "template": TemplateGenerator,
            "offline_echo": lambda: LLMGenerator(echo, ledger, OfflineEchoTransport()),
        },
        datetime.fromisoformat(config.now),
        raw_log=RawLog(ROOT, config.exp_id),
    )
    summary = aggregate(records)
    _write(
        config.exp_id, [r.model_dump(mode="json") for r in records], summary, publish
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not summary["input_mismatch"] else 1


def _p4b2(raw: dict, publish: bool, execute: bool, phases: str | None = None) -> int:
    """기본은 모의 실행(오프라인 전송 · 장부는 메모리). --execute 는 승인된 설정 + 환경변수가 있어야 한다."""

    config = P4B2Config.model_validate(raw)
    old = (
        ROOT
        / "experiments"
        / "results"
        / (config.exp_id + ("" if execute else "_dryrun"))
        / "summary.json"
    )
    if publish and old.exists() and json.loads(old.read_text(encoding="utf-8")).get("eval_set") != config.eval_set:  # fmt: skip
        print(
            "refused: 다른 평가 세트의 기존 결과를 덮어쓰지 않습니다 — exp_id 를 바꾸세요"
        )
        return 2
    sources = load_sources(config, ROOT)
    private = load_private_texts(ROOT, config.private_files)
    if execute:
        from companion_npc.llm_net.openai_chat import (
            ALLOW_ENV,
            OpenAIChatTransport,
            network_allowed,
        )

        if not network_allowed(config.execution_approved):
            print(
                f"refused: execution_approved=true 와 {ALLOW_ENV}=1 이 모두 필요합니다"
            )
            return 2
        wanted = tuple(phases.split(",")) if phases else ()
        if not wanted or not set(wanted) <= set(config.approved_phases):
            print(
                f"refused: --phases 는 승인된 단계 {config.approved_phases} 안에서만 지정할 수 있습니다"
            )
            return 2
        policy = ExternalTransferPolicy.model_validate(_strip(json.loads((ROOT / "experiments" / "p4" / "external_transfer.json").read_text(encoding="utf-8"))))  # fmt: skip
        problems = external_transfer_problems(config, policy)
        if problems:
            print("refused: " + "; ".join(problems))
            return 2
        extra = denied_forbidden_terms(
            policy, config, ROOT
        )  # 외부 전송이 금지된 사건의 정답 · 별칭도 전송 직전 검사에 넣는다
        session_cap = config.plan.smoke if wanted == ("smoke",) else None
        transport, env = OpenAIChatTransport(approved=True), None
        if (
            config.generator.provider == "openai"
        ):  # 생성 요청 전에 모델 접근만 확인(토큰을 쓰지 않는다)
            import os

            from companion_npc.speech.llm import TransportError

            try:
                access = transport.check_model_access(config.generator, os.environ.get(config.generator.api_key_env or ""))  # fmt: skip
            except TransportError as error:
                print(json.dumps({"refused": "model_access", **public_error({"kind": error.kind, **error.detail})}, ensure_ascii=False))  # fmt: skip
                return 2
            print(json.dumps({"model_access": access}, ensure_ascii=False))
        else:
            access = None
    else:
        extra, session_cap, access = None, None, None
        transport = OfflineEchoTransport()
        env = {config.generator.api_key_env: "dry-run-placeholder"} if config.generator.api_key_env else {}  # fmt: skip
    result = run_p4b2(config, sources, transport, ROOT, private_texts=private, env=env, dry_run=not execute, phases=tuple(phases.split(",")) if phases else None, extra_forbidden=extra, session_max_requests=session_cap, model_access=access)  # fmt: skip
    summary = result["summary"] | {"reproduction": reproduction(config, raw, ROOT)}
    forbidden = [t for _, terms in sources for t in terms] + private + list(extra or [])
    if not summary_is_clean(summary, forbidden):
        print("refused: summary contains forbidden text")
        return 1
    exp_id = config.exp_id + ("" if execute else "_dryrun")
    out = ROOT / "runs" / "p4" / exp_id
    out.mkdir(parents=True, exist_ok=True)
    # 단계를 골라 돌리면 단계별 요약 파일 — 앞 실행(예: smoke)을 덮어쓰지 않는다
    name = "summary.json" if not phases else f"summary_{phases.replace(',', '-')}.json"
    text = json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    (out / name).write_text(text, encoding="utf-8", newline="\n")
    if publish:
        target = ROOT / "experiments" / "results" / exp_id
        target.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(out / name, target / name)
    print(json.dumps({k: summary[k] for k in ("eval_set", "dry_run", "stop_reason", "sent_requests", "ledger")}, ensure_ascii=False))  # fmt: skip
    return 0 if summary["stop_reason"] is None else 1


def _strip(raw: dict) -> dict:
    return {k: v for k, v in raw.items() if not k.startswith("_")}


if __name__ == "__main__":
    raise SystemExit(main())
