"""나주 FE ID 목록(`content_drafts/naju/naju_fe_ids.dev.json`)을 FE 커밋의 실제 코드와 대조한다(읽기 전용).

    .\\.venv\\Scripts\\python.exe -m scripts.verify_naju_fe_ids [--ref <git ref>]

- `naju01/src/puzzles` 아래 모든 파일의 `registerInteractable({ id })` 값을 모아 목록과 양방향으로 비교한다.
  템플릿(`${...}`)은 `{n}`으로 바꿔 비교한다.
- 개수를 정하는 FE 상수(`count_source`)가 그 파일에 있는지, 배치 키 · 좌표가 `naju01/assets/edits.json`과 같은지 본다.
- FE 브랜치 · 작업 트리를 바꾸지 않는다(`git show` · `git ls-tree`만 쓴다). 기본 ref는 목록의 `fe_commit`.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

INVENTORY = (
    Path(__file__).resolve().parents[1]
    / "content_drafts"
    / "naju"
    / "naju_fe_ids.dev.json"
)
PUZZLE_ROOT = "naju01/src/puzzles"
EDITS = "naju01/assets/edits.json"
REGISTER = re.compile(r"registerInteractable\(")
ID_VALUE = re.compile(r"""\bid:\s*(?:"([^"]+)"|`([^`]+)`)""")
TEMPLATE = re.compile(r"\$\{[^}]+\}")
IDENTIFIER = re.compile(r"^[A-Z][A-Z0-9_]*$")


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], check=True, capture_output=True, text=True, encoding="utf-8"
    ).stdout


def registered_ids(source: str) -> set[str]:
    ids = set()
    for match in REGISTER.finditer(source):
        found = ID_VALUE.search(source, match.end(), match.end() + 400)
        if found is not None:
            ids.add(TEMPLATE.sub("{n}", found.group(1) or found.group(2)))
    return ids


def verify(ref: str) -> list[str]:
    inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))
    problems: list[str] = []
    files = [
        path
        for path in git(
            "ls-tree", "-r", "--full-tree", "--name-only", ref, "--", PUZZLE_ROOT
        ).split()
        if path.endswith((".ts", ".tsx"))
    ]
    sources = {path: git("show", f"{ref}:{path}") for path in files}

    fe: dict[str, set[str]] = {}
    for path, source in sources.items():
        for value in registered_ids(source):
            fe.setdefault(value, set()).add(path.removeprefix(PUZZLE_ROOT + "/"))
    listed = {item["id"]: item for item in inventory["interactables"]}
    if len(listed) != len(inventory["interactables"]):
        problems.append("inventory: duplicate id")

    for value in sorted(fe.keys() - listed.keys()):
        problems.append(f"FE에만 있음: {value} ({', '.join(sorted(fe[value]))})")
    for value in sorted(listed.keys() - fe.keys()):
        problems.append(f"FE에 없음: {value}")
    for value, item in listed.items():
        if value in fe and item["file"] not in fe[value]:
            problems.append(f"파일 다름: {value} → {sorted(fe[value])}")
        constant = (item.get("count_source") or "").split(" ")[0]
        if IDENTIFIER.fullmatch(constant):
            source = sources.get(f"{PUZZLE_ROOT}/{item['file']}", "")
            if constant not in source:
                problems.append(f"개수 상수 없음: {value} {constant}")

    edits = json.loads(git("show", f"{ref}:{EDITS}"))
    for placement in inventory["placements"]:
        group, index = placement["key"].rsplit("#", 1)
        spot = edits.get("고침", {}).get(group, {}).get(index)
        if spot is None:
            problems.append(f"배치 없음: {placement['key']}")
            continue
        actual = [round(spot["x"], 3), round(spot["z"], 3)]
        if actual != placement["at_m"]:
            problems.append(f"배치 좌표 다름: {placement['key']} {actual}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ref")
    args = parser.parse_args()
    inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))
    ref = args.ref or inventory["fe_commit"]
    problems = verify(ref)
    sys.stdout.reconfigure(encoding="utf-8")
    for problem in problems:
        print(problem)
    print(f"{ref}: {'OK' if not problems else f'{len(problems)} problem(s)'}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
