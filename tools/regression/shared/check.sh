#!/bin/bash
# 한 줄 회귀 검사: 대상 저장소의 서버를 띄우고 → 한 판 뜨고 → 서버를 끄고 → 기준과 견준다.
#   check.sh <묶음 game|naju> [저장소 루트=이 저장소] [포트=묶음 기본] [출력폴더]
# 기준은 tools/regression/<묶음>/baseline (baseline.sh 로 만든다). 다른 기준과 견주려면 BASELINE=폴더.
# Leva 키 매핑이 생기면 LEVA_MAP=map.json, 경로·이름표를 바꿔 끼우려면 ROUTE= PAGES=.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SUITE="${1:?사용: check.sh <묶음 game|naju> [저장소 루트] [포트] [출력폴더]}"
SUITE_DIR="$HERE/../$SUITE"
ROOT="${2:-$HERE/../../..}"
PORT="${3:-$(node -p "require('$SUITE_DIR/suite.json').defaultPort")}"
ROOT_NAME="$(basename "$(cd "$ROOT" && pwd)")"
OUT="${4:-$SUITE_DIR/runs/$ROOT_NAME-$(date +%Y%m%d-%H%M%S)}"
BASELINE="${BASELINE:-$SUITE_DIR/baseline}"
if [ ! -d "$BASELINE" ]; then
  echo "기준이 없다: $BASELINE — README 「기준 만들기」를 먼저 하라" >&2
  exit 2
fi

"$HERE/server.sh" start "$SUITE" "$ROOT" "$PORT" || exit 3
trap '"$HERE/server.sh" stop "$PORT" >/dev/null' EXIT
"$HERE/capture.sh" "$SUITE" "http://localhost:$PORT" "$OUT"
MAP_ARG=()
[ -n "${LEVA_MAP:-}" ] && MAP_ARG=(--leva-map "$LEVA_MAP")
node "$HERE/compare.mjs" "$BASELINE" "$OUT" ${MAP_ARG[@]+"${MAP_ARG[@]}"}
