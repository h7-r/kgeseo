#!/bin/bash
# 떠 있는 서버를 상대로 한 판을 뜬다(경로 재생 + Leva 덤프).
#   capture.sh <묶음 game|naju> <서버주소> <출력폴더>
# 파일 이름이 바뀐 코드를 뜰 때: ROUTE=다른경로.json  PAGES=다른이름표.json
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SUITE="$1"
URL="$2"
OUT="$3"
EXTRA=()
[ -n "${ROUTE:-}" ] && EXTRA+=(--route "$ROUTE")
[ -n "${PAGES:-}" ] && PAGES_ARG=(--pages "$PAGES") || PAGES_ARG=()
node "$HERE/run.mjs" "$SUITE" "$URL" "$OUT" ${EXTRA[@]+"${EXTRA[@]}"} ${PAGES_ARG[@]+"${PAGES_ARG[@]}"}
RC=$?
node "$HERE/leva-dump.mjs" "$SUITE" "$URL" "$OUT/leva.json" ${PAGES_ARG[@]+"${PAGES_ARG[@]}"} || RC=1
exit $RC
