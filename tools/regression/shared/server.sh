#!/bin/bash
# 검사용 vite 개발 서버를 켜고 끈다.
#   server.sh start <묶음 game|naju> <저장소 루트> <포트>
#   server.sh stop  <포트>
# 포트는 5301~5330 만 쓴다. 5173·5174·5175 는 각자 띄운 개발 서버 자리라 건드리지 않는다.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="$HERE/../.cache"
mkdir -p "$STATE"

check_port() {
  if ! [[ "$1" =~ ^[0-9]+$ ]] || [ "$1" -lt 5301 ] || [ "$1" -gt 5330 ]; then
    echo "포트는 5301~5330 만 쓴다 (받은 값: $1)" >&2
    exit 2
  fi
}

case "${1:-}" in
  start)
    SUITE="$2"
    ROOT="$(cd "$3" && pwd)"
    PORT="$4"
    check_port "$PORT"
    APP_DIR="${APP_DIR:-$(node -p "require('$HERE/../$SUITE/suite.json').appDir ?? '.'")}"
    if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "포트 $PORT 이미 사용 중" >&2
      exit 3
    fi
    cd "$ROOT"
    HARNESS_APP_DIR="$APP_DIR" nohup npx vite --config "$HERE/vite.harness.config.mjs" --port "$PORT" --strictPort \
      >"$STATE/server-$PORT.log" 2>&1 &
    echo $! >"$STATE/server-$PORT.pid"
    for _ in $(seq 1 90); do
      if curl -s -o /dev/null "http://localhost:$PORT/"; then
        echo "ready http://localhost:$PORT/ (root=$ROOT/$APP_DIR)"
        exit 0
      fi
      sleep 1
    done
    echo "서버가 90초 안에 안 떴다 — $STATE/server-$PORT.log 를 보라" >&2
    exit 1
    ;;
  stop)
    PORT="$2"
    check_port "$PORT"
    PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
    [ -f "$STATE/server-$PORT.pid" ] && PIDS="$PIDS $(cat "$STATE/server-$PORT.pid")"
    # npx 아래에 vite 가 자식으로 떠 있어 부모만 죽이면 포트가 남는다
    for pid in $PIDS; do
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
    done
    rm -f "$STATE/server-$PORT.pid"
    echo "stopped $PORT"
    ;;
  *)
    echo "사용: $0 start <묶음> <저장소 루트> <포트> | stop <포트>" >&2
    exit 2
    ;;
esac
