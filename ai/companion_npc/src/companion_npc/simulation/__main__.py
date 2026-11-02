"""합성 데이터를 만들고 P2-B 파이프라인에 통과시켜 요약을 낸다.

    $env:PYTHONPATH = "src"
    .\\.venv\\Scripts\\python.exe -m companion_npc.simulation --config experiments\\p2c_default.json --out-dir data\\synthetic\\p2c_default

--out-dir 은 깃에서 빠지는 data/ 아래를 쓴다. --sessions 로 사건·유형별 세션 수를 줄일 수 있다.
--analyze 를 주면 summary.json 도 같은 폴더에 쓴다(모든 판단 시점을 계산하므로 오래 걸린다).
"""

import argparse
import json
from pathlib import Path

from companion_npc.simulation.analysis import analyze_session, summarize
from companion_npc.simulation.writer import (
    generate,
    load_config,
    load_scenarios,
    write_dataset,
)

ROOT = Path(__file__).resolve().parents[3]  # ai/companion_npc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate synthetic interaction_events."
    )
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument(
        "--sessions", type=int, help="사건·유형별 세션 수 (설정값 덮어쓰기)"
    )
    parser.add_argument("--analyze", action="store_true")
    args = parser.parse_args(argv)

    config = load_config(args.config)
    if args.sessions:
        config = config.model_copy(
            update={"sessions_per_case_archetype": args.sessions}
        )
    scenarios = load_scenarios(config, ROOT)
    dataset = generate(config, scenarios)
    meta = write_dataset(dataset, args.out_dir)
    print(
        json.dumps(
            {"sessions": meta["sessions"], "files": meta["files"]},
            ensure_ascii=False,
            indent=2,
        )
    )
    if args.analyze:
        records = [
            r
            for o in dataset.outputs
            for r in analyze_session(o, scenarios[o.truth.case_id].pack)
        ]
        summary = summarize(dataset.outputs, records)
        (args.out_dir / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
