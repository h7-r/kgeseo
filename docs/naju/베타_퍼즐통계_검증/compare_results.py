"""mysql --batch 결과(q0.tsv ~ q5.tsv)를 expected.json 과 비교한다(DB 에 접속하지 않는다).

결과 파일 형식: `mysql --batch` 기본 출력 — 첫 줄 컬럼 이름, 탭 구분, NULL 은 문자열 NULL.
숫자는 값으로 비교한다('2.6' == '2.6000'), 그 밖에는 글자 그대로.
Q0 · Q5 는 metric 집합 비교(UNION ALL 순서 무관), Q1 · Q3 · Q4 는 puzzle_id, Q2 는 (puzzle_id, scope) 기준.

사용: python -I compare_results.py <RESULT_DIR>    → 불일치가 있으면 종료 코드 1
"""

from __future__ import annotations

import json
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

HERE = Path(__file__).resolve().parent
KEYS = {"Q1": ("puzzle_id",), "Q2": ("puzzle_id", "scope"), "Q3": ("puzzle_id",), "Q4": ("puzzle_id",)}


def load_tsv(path: Path) -> list[dict]:
    lines = [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln != ""]
    if not lines:
        return []
    cols = lines[0].split("\t")
    rows = []
    for ln in lines[1:]:
        vals = ln.split("\t")
        if len(vals) != len(cols):
            raise SystemExit(f"{path.name}: 열 수가 다르다: {ln!r}")
        rows.append({c: (None if v == "NULL" else v) for c, v in zip(cols, vals)})
    return rows


def same(a, b) -> bool:
    if a is None or b is None:
        return a is None and b is None
    try:
        return Decimal(a) == Decimal(b)
    except InvalidOperation:
        return a == b


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("사용: python -I compare_results.py <RESULT_DIR>")
    rdir = Path(sys.argv[1])
    exp = json.loads((HERE / "expected.json").read_text(encoding="utf-8"))
    problems: list[str] = []
    for i in range(6):
        q = f"Q{i}"
        got = load_tsv(rdir / f"q{i}.tsv")
        want = exp[q]
        if q in ("Q0", "Q5"):
            g = {r["metric"]: r["value"] for r in got}
            w = {r["metric"]: r["value"] for r in want}
            for k in sorted(set(g) | set(w)):
                if k not in g:
                    problems.append(f"{q} {k}: 결과에 없음(예상 {w[k]!r})")
                elif k not in w:
                    problems.append(f"{q} {k}: 예상에 없는 행(결과 {g[k]!r})")
                elif not same(g[k], w[k]):
                    problems.append(f"{q} {k}: 결과 {g[k]!r} ≠ 예상 {w[k]!r}")
            continue
        key = KEYS[q]
        g = {tuple(r[k] for k in key): r for r in got}
        w = {tuple(r[k] for k in key): r for r in want}
        if [tuple(r[k] for k in key) for r in got] != [tuple(r[k] for k in key) for r in want]:
            problems.append(f"{q}: 행 순서 · 구성 다름 — 결과 {list(g)} / 예상 {list(w)}")
        for k in w:
            if k not in g:
                continue
            for col, wv in w[k].items():
                if col not in g[k]:
                    problems.append(f"{q} {k} {col}: 결과에 컬럼 없음")
                elif not same(g[k][col], wv):
                    problems.append(f"{q} {k} {col}: 결과 {g[k][col]!r} ≠ 예상 {wv!r}")
        extra = set(got[0]) - set(want[0]) if got and want else set()
        if extra:
            problems.append(f"{q}: 예상에 없는 컬럼 {sorted(extra)}")
    if problems:
        print("불일치 " + str(len(problems)) + "건")
        print("\n".join(problems))
        raise SystemExit(1)
    print("ok: Q0~Q5 모두 예상과 같다")


if __name__ == "__main__":
    main()
