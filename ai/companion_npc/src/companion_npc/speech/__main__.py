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
from companion_npc.speech.records import RawLog, restricted_dir

ROOT = Path(__file__).resolve().parents[3]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run P4-A speech evaluation.")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument(
        "--mode", choices=("p4a", "guard_eval", "compare"), default="p4a"
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


if __name__ == "__main__":
    raise SystemExit(main())
