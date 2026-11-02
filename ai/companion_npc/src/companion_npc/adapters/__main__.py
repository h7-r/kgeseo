"""Case 파일 한 쌍을 ScenarioPack 으로 바꿔 본다.

    .\\.venv\\Scripts\\python.exe -m companion_npc.adapters case_001
    .\\.venv\\Scripts\\python.exe -m companion_npc.adapters case_001 --out-dir runs\\packs

(src 를 PYTHONPATH 에 둔다: $env:PYTHONPATH = "src")

기본은 보고서만 화면에 찍는다. --out-dir 을 주면 팩과 보고서를 파일로 쓴다.
종료 코드: 0 성공 · 1 입력/계약 오류 · 2 정답 누설
"""

import argparse
import sys
from pathlib import Path

from companion_npc.adapters.case_content import canonical_json, convert_case
from companion_npc.adapters.errors import AdapterError, AnswerLeakError
from companion_npc.adapters.loader import load_case_sources

# src/companion_npc/adapters/__main__.py → 저장소 루트는 다섯 단계 위
REPO_ROOT = Path(__file__).resolve().parents[5]
DEFAULT_CASES_DIR = REPO_ROOT / "backend" / "app" / "content" / "cases"


def _ref(path: Path) -> str:
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.name


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Convert a Case pair to ScenarioPack.")
    parser.add_argument("case_id")
    parser.add_argument("--cases-dir", type=Path, default=DEFAULT_CASES_DIR)
    parser.add_argument("--out-dir", type=Path)
    parser.add_argument(
        "--alias",
        action="append",
        default=[],
        help="정답과 같은 뜻의 말. 누설 검사에만 쓰고 출력에 남기지 않는다.",
    )
    parser.add_argument(
        "--producer", default="unknown", choices=["human", "agent", "mixed", "unknown"]
    )
    args = parser.parse_args(argv)

    try:
        sources = load_case_sources(args.cases_dir, args.case_id)
        result = convert_case(
            sources.client,
            sources.server,
            client_ref=_ref(sources.client_path),
            producer=args.producer,
            forbidden_aliases=tuple(args.alias),
        )
    except AnswerLeakError as error:
        print(canonical_json(error.report), end="")
        print(f"[FAIL] {error}", file=sys.stderr)
        return 2
    except AdapterError as error:
        print(f"[FAIL] {type(error).__name__}: {error}", file=sys.stderr)
        return 1

    print(canonical_json(result.report), end="")
    if args.out_dir:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        (args.out_dir / f"{args.case_id}.scenario_pack.json").write_text(
            canonical_json(result.pack), encoding="utf-8", newline="\n"
        )
        (args.out_dir / f"{args.case_id}.conversion_report.json").write_text(
            canonical_json(result.report), encoding="utf-8", newline="\n"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
