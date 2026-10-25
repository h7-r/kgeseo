"""P4-A 발화 평가 실행 (네트워크 없음).

    $env:PYTHONPATH = "src"
    .\\.venv\\Scripts\\python.exe -m companion_npc.speech --config experiments\\p4\\p4a_speech.json --publish

출력: runs/p4/<exp_id>/records.jsonl · summary.json (깃 제외)
--publish : experiments/results/<exp_id>/summary.json 만 복사
"""

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path

from companion_npc.speech.evaluate import (
    P4AConfig,
    load_paraphrases,
    load_sources,
    run_suite,
)

ROOT = Path(__file__).resolve().parents[3]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run P4-A speech evaluation.")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args(argv)
    raw = json.loads(args.config.read_text(encoding="utf-8"))
    config = P4AConfig.model_validate(
        {k: v for k, v in raw.items() if not k.startswith("_")}
    )
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


if __name__ == "__main__":
    raise SystemExit(main())
