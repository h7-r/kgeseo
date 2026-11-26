"""운영용 읽기 전용 SQL 에서 Q0~Q5 테스트 실행본을 만든다(DB 에 접속하지 않는다).

운영 파일은 고치지 않는다. 파라미터 SET 다섯 줄만 테스트값(expected.json 의 meta)으로 바꾸고,
쿼리마다 따로 실행할 수 있게 q0.sql ~ q5.sql 로 나눠 OUT_DIR 에 쓴다(한 파일 = 결과 집합 하나 → 비교가 쉽다).
쿼리 본문은 운영 파일의 글자 그대로다(바꾼 줄은 파라미터 다섯 줄뿐임을 검사한다).

사용: python -I make_test_queries.py <OUT_DIR>
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OPS_SQL = HERE.parent / "베타_퍼즐통계_P01_P03_P07_P09_읽기전용.sql"


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("사용: python -I make_test_queries.py <OUT_DIR>")
    out = Path(sys.argv[1]).resolve()
    # 저장소(.git 이 있는 가장 가까운 상위 폴더) 안이면 어디든 거부한다 — 실행본이 저장소에 섞이거나 파일을 덮지 않게
    repo = next((d for d in (HERE, *HERE.parents) if (d / ".git").exists()), None)
    if repo is None:
        raise SystemExit("저장소 루트(.git)를 찾지 못했다 — 저장소 안에서 이 스크립트를 실행한다")
    if out == repo or repo in out.parents or out in repo.parents:
        raise SystemExit("OUT_DIR 은 저장소 밖 임시 폴더로 준다")
    if out.exists() and any(out.glob("q[0-5].sql")):
        raise SystemExit("OUT_DIR 에 이미 q*.sql 이 있다 — 빈 폴더를 준다")
    meta = json.loads((HERE / "expected.json").read_text(encoding="utf-8"))["meta"]
    p = meta["params"]
    params = {
        "@beta_start_utc": f"'{p['beta_start_utc']}'",
        "@beta_end_utc": f"'{p['beta_end_utc']}'",
        "@asof_utc": f"'{p['asof_utc']}'",   # 운영은 UTC_TIMESTAMP(6). 테스트는 고정 시각
        "@exclude_user_ids": "'" + json.dumps(meta["exclude_user_ids"]) + "'",
        "@exclude_anon_ids": "'" + json.dumps(meta["exclude_anon_ids"]) + "'",
    }
    src = OPS_SQL.read_text(encoding="utf-8")
    lines = src.split("\n")
    replaced = 0
    for i, line in enumerate(lines):
        m = re.match(r"^SET (@[a-z_]+)\s*=\s*.*?;(.*)$", line)
        if m and m.group(1) in params:
            lines[i] = f"SET {m.group(1)} = {params[m.group(1)]};  -- 테스트값"
            replaced += 1
    if replaced != len(params):
        raise SystemExit(f"파라미터 줄을 {replaced}개 찾음(5개여야 함) — 운영 파일 형식이 바뀌었다")
    body = "\n".join(lines)
    head, _, rest = body.partition("START TRANSACTION READ ONLY;")
    if not rest:
        raise SystemExit("START TRANSACTION READ ONLY; 를 찾지 못했다")
    queries = [q.strip() for q in re.split(r"\n(?=-- =+\n-- Q\d)", rest) if q.strip().startswith("-- =")]
    if len(queries) != 6:
        raise SystemExit(f"쿼리 {len(queries)}개(6개여야 함)")
    # 본문이 운영 파일 글자 그대로인지(마지막 ROLLBACK 앞까지)
    for qtext in queries:
        core = qtext.replace("ROLLBACK;", "").strip()
        if core not in src:
            raise SystemExit("쿼리 본문이 운영 파일과 다르다")
    out.mkdir(parents=True, exist_ok=True)
    for i, qtext in enumerate(queries):
        core = qtext.replace("ROLLBACK;", "").strip()
        (out / f"q{i}.sql").write_text(
            f"-- 테스트 실행본(자동 생성) — 격리 테스트 DB 전용\n{head.strip()}\nSTART TRANSACTION READ ONLY;\n\n{core}\n\nROLLBACK;\n",
            encoding="utf-8", newline="\n")
    print(f"ok: {out} 에 q0.sql ~ q5.sql")


if __name__ == "__main__":
    main()
