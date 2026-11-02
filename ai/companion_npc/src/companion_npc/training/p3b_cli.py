"""P3-B 실행.

    $env:PYTHONPATH = "src"
    .\\.venv\\Scripts\\python.exe -m companion_npc.training.p3b_cli --config experiments\\p3\\p3b_models.json --publish

출력 (깃 제외): runs/p3/<exp_id>/results.json · metrics.json · report.md · partial_seed<n>.json
--publish : experiments/results/<exp_id>/ 에 report.md · metrics.json 만 복사
"""

import argparse
import json
import shutil
import time
from pathlib import Path

from companion_npc.training.p3b import P3BConfig, run_experiment
from companion_npc.training.provenance import dumps
from companion_npc.training.report_b import metrics_summary, render

ROOT = Path(__file__).resolve().parents[3]  # ai/companion_npc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run P3-B model comparison.")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args(argv)
    raw = json.loads(args.config.read_text(encoding="utf-8"))
    config = P3BConfig.model_validate(
        {k: v for k, v in raw.items() if not k.startswith("_")}
    )
    out = ROOT / "runs" / "p3" / config.exp_id
    started = time.time()

    def log(message: str) -> None:
        print(f"[{time.time() - started:7.1f}s] {message}", flush=True)

    results = run_experiment(config, ROOT, out_dir=out, log=log)
    results["elapsed_sec"] = round(time.time() - started, 1)
    raw_path = out / "results.json"
    raw_path.write_text(dumps(results), encoding="utf-8", newline="\n")
    # 커밋용 요약은 들여쓰기 없이 (원본은 사람이 읽기 쉽게 들여쓴다)
    (out / "metrics.json").write_text(
        json.dumps(
            metrics_summary(results, raw_path),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    (out / "report.md").write_text(render(results), encoding="utf-8", newline="\n")
    if args.publish:
        target = ROOT / "experiments" / "results" / config.exp_id
        target.mkdir(parents=True, exist_ok=True)
        for name in ("report.md", "metrics.json"):
            shutil.copyfile(out / name, target / name)
    log(f"done → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
