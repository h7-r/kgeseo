#!/bin/bash
# 기준을 만든다: 같은 코드를 두 번 동시에 떠서(일부러 부하를 줘서) 잡음을 재고, 첫 판을 기준으로 삼는다.
#   baseline.sh <묶음 game|naju> <기준 저장소 루트> [포트=묶음 기본 - 1]
# 결과: tools/regression/<묶음>/baseline/{run1,run2,noise.json,leva.json}
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SUITE="${1:?사용: baseline.sh <묶음 game|naju> <기준 저장소 루트> [포트]}"
ROOT="${2:?기준 저장소 루트를 준다 (예: ../kgeseo-base)}"
SUITE_DIR="$HERE/../$SUITE"
PORT="${3:-$(($(node -p "require('$SUITE_DIR/suite.json').defaultPort") - 1))}"
OUT="${BASELINE:-$SUITE_DIR/baseline}"

"$HERE/server.sh" start "$SUITE" "$ROOT" "$PORT" || exit 3
trap '"$HERE/server.sh" stop "$PORT" >/dev/null' EXIT
mkdir -p "$OUT"
"$HERE/capture.sh" "$SUITE" "http://localhost:$PORT" "$OUT/run1" >"$OUT/run1.log" 2>&1 &
FIRST=$!
"$HERE/capture.sh" "$SUITE" "http://localhost:$PORT" "$OUT/run2" >"$OUT/run2.log" 2>&1
RC=$?
wait "$FIRST" || RC=1
tail -n 4 "$OUT/run1.log" "$OUT/run2.log"
node "$HERE/noise.mjs" "$OUT/noise.json" "$OUT/run1" "$OUT/run2" || RC=1
cp "$OUT/run1/leva.json" "$OUT/leva.json"
exit $RC
