"""P3-A 기준선 실험 실행.

    $env:PYTHONPATH = "src"
    .\\.venv\\Scripts\\python.exe -m companion_npc.training --config experiments\\p3\\p3a_baselines.json --publish

출력 (원본, 깃 제외): runs/p3/<exp_id>/results.json · report.md · metrics.json
--publish            : experiments/results/<exp_id>/ 에 report.md · metrics.json 만 복사 (커밋용 요약)
                       원본 results.json 은 복사하지 않는다 — metrics.json 이 그 sha256 을 가리킨다.
"""

import argparse
import json
import shutil
from pathlib import Path

from companion_npc.training.experiment import P3AConfig, run_experiment
from companion_npc.training.provenance import dumps, metrics_summary
from companion_npc.training.report import render

ROOT = Path(__file__).resolve().parents[3]  # ai/companion_npc
PUBLISHED = ("report.md", "metrics.json")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run P3-A baseline experiment.")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--sessions", type=int, help="사건·유형별 세션 수 덮어쓰기")
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args(argv)

    raw = json.loads(args.config.read_text(encoding="utf-8"))
    config = P3AConfig.model_validate(
        {k: v for k, v in raw.items() if not k.startswith("_")}
    )
    if args.sessions:
        config = config.model_copy(
            update={"sessions_per_case_archetype": args.sessions}
        )
    results = run_experiment(config, ROOT)
    out = ROOT / "runs" / "p3" / config.exp_id
    out.mkdir(parents=True, exist_ok=True)
    raw_path = out / "results.json"
    raw_path.write_text(dumps(results), encoding="utf-8", newline="\n")
    (out / "metrics.json").write_text(
        dumps(metrics_summary(results, raw_path)), encoding="utf-8", newline="\n"
    )
    (out / "report.md").write_text(
        render(results, config.primary_cooldown_sec), encoding="utf-8", newline="\n"
    )
    if args.publish:
        target = ROOT / "experiments" / "results" / config.exp_id
        target.mkdir(parents=True, exist_ok=True)
        for name in PUBLISHED:
            shutil.copyfile(out / name, target / name)
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
