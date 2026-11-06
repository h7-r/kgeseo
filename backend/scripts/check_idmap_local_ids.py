"""idmap의 로컬 ID를 FE에서 뽑은 목록과 대조한다(읽기 전용, 팀 검토 대기).

    .\\.venv\\Scripts\\python.exe -m scripts.check_idmap_local_ids \\
        --idmap <idmap.json> --local-ids <local-ids.json> [--show-unused]

- `--local-ids`는 FE 도구 `naju01/tools/export-local-ids.mjs --out`이 만든 파일이다(나주 화면에서 실제로 읽은 값).
- 판정은 게시 게이트가 쓰는 `idmap_validation.validate_idmap(local_ids=...)` 그대로다 — idmap의 `local` 값이 FE 목록에
  없으면 `LOCAL_ID_NOT_IN_GAME`(게이트 `LOCAL_IDS: FAIL`). 이 명령은 그 결과를 종류별로 보여 줄 뿐 바꾸지 않는다.
- `--show-unused`: FE 장면 무리(`씬N.*`)에 있지만 idmap이 쓰지 않는 배치 키(참고 — 게이트는 보지 않는다).
- 파일을 쓰지 않는다. DB에 접속하지 않는다.

종료 코드: 0 모두 있음, 1 입력 오류(파일 · 모양 · idmap 스키마), 2 FE에 없는 로컬 ID 있음.
"""

import argparse
import json
import re
import sys
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

from app.services.idmap_validation import validate_idmap

LOCAL_ID_KINDS = ("zones", "navigation", "blockers", "objects", "scenes")
SCENE_GROUP = re.compile(r"^씬\d+\.")
EXIT_OK, EXIT_INPUT, EXIT_MISSING = 0, 1, 2


class CliInputError(ValueError):
    pass


def load_json(path: str, label: str):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise CliInputError(f"{label} not readable: {type(error).__name__}") from error


def parse_local_ids(raw) -> dict[str, tuple[str, ...]]:
    """다섯 종류가 모두 있고, 문자열 목록이고, 중복 · 빈 값이 없어야 한다(FE 도구와 같은 규칙)."""

    if not isinstance(raw, dict) or set(raw) != set(LOCAL_ID_KINDS):
        raise CliInputError(f"local ids must have exactly the keys {LOCAL_ID_KINDS}")
    result = {}
    for kind in LOCAL_ID_KINDS:
        values = raw[kind]
        if not isinstance(values, list) or not all(
            isinstance(v, str) and v.strip() for v in values
        ):
            raise CliInputError(f"local ids.{kind} must be a list of non-empty strings")
        if len(set(values)) != len(values):
            raise CliInputError(f"local ids.{kind} has duplicates")
        if not values:
            raise CliInputError(f"local ids.{kind} is empty")
        result[kind] = tuple(values)
    return result


def idmap_locals(raw: Mapping) -> dict[str, list[str]]:
    def locals_of(key: str) -> list[str]:
        return [
            str(item.get("local"))
            for item in raw.get(key, [])
            if isinstance(item, dict)
        ]

    return {
        "zones": locals_of("zones"),
        "navigation": locals_of("navigation"),
        "blockers": locals_of("blockers"),
        "objects": locals_of("objects"),
        "scenes": locals_of("scenes"),
    }


def run(args: argparse.Namespace, out: Callable[[str], None] = print) -> int:
    raw_idmap = load_json(args.idmap, "idmap")
    local_ids = parse_local_ids(load_json(args.local_ids, "local ids"))
    report = validate_idmap(raw_idmap, local_ids=local_ids)
    if not report.schema_valid:
        raise CliInputError("idmap schema is invalid")
    missing: dict[str, list[str]] = {kind: [] for kind in LOCAL_ID_KINDS}
    for issue in report.issues:
        if issue.code == "LOCAL_ID_NOT_IN_GAME":
            missing[issue.location.removeprefix("$.")].append(str(issue.reference))
    used = idmap_locals(raw_idmap)
    out(f"idmap={args.idmap} local_ids={args.local_ids}")
    out("scope=LOCAL_IDS (게시 승인 판정 아님)")
    for kind in LOCAL_ID_KINDS:
        found = len(used[kind]) - len(missing[kind])
        out(
            f"  {kind:<10} idmap {len(used[kind]):>3} · FE에 있음 {found:>3} · 없음 {len(missing[kind])}"
        )
        for value in missing[kind]:
            out(f"    - LOCAL_ID_NOT_IN_GAME {value}")
    if args.show_unused:
        referenced = set(used["objects"])
        unused = [
            key
            for key in local_ids["objects"]
            if SCENE_GROUP.match(key) and key not in referenced
        ]
        out(f"  (참고) FE 장면 무리 배치 키 중 idmap 이 쓰지 않는 것: {len(unused)}")
        for key in unused:
            out(f"    · {key}")
    total = sum(len(values) for values in missing.values())
    out("result=" + ("OK" if total == 0 else f"MISSING {total}"))
    return EXIT_OK if total == 0 else EXIT_MISSING


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--idmap", required=True)
    parser.add_argument("--local-ids", required=True)
    parser.add_argument("--show-unused", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    try:
        return run(parse_args(argv))
    except CliInputError as error:
        print(f"[ERROR] {error}")
        return EXIT_INPUT


if __name__ == "__main__":
    sys.exit(main())
