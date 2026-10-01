#!/usr/bin/env bash
# 적용.sh — 나주맵(naju01) 첫 진입 최적화 + 발표 프리셋을 ~/kgeseo/naju01 에 넣는다
#   쓰는 법:  bash 적용.sh            (적용 · 원본은 자동 백업)
#             bash 적용.sh --되돌리기  (가장 최근 백업으로 복구)
# ※ 셸 **변수 이름은 ASCII** 다 — bash 는 한글 변수를 명령으로 오해한다.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DST="$HOME/kgeseo/naju01"
FILES=(src/main.jsx src/App.jsx src/새지형.js src/구운모형.js src/배치.js vite.config.js)
NEW_FILES=(src/미리읽기.js src/발표.js)
SCENE=src/scenes/공간그레이박스.jsx

if [[ ! -d "$DST/src" ]]; then
  echo "naju01 을 못 찾았다: $DST"; exit 1
fi

if [[ "${1:-}" == "--되돌리기" ]]; then
  LAST=$(ls -d "$DST"/원본보관-최적화-* 2>/dev/null | sort | tail -1 || true)
  [[ -n "$LAST" ]] || { echo "백업이 없다"; exit 1; }
  for f in "${FILES[@]}" "$SCENE"; do cp "$LAST/$f" "$DST/$f"; done
  for f in "${NEW_FILES[@]}"; do rm -f "$DST/$f"; done
  echo "되돌렸다 ← $LAST"
  exit 0
fi

BK="$DST/원본보관-최적화-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK/src/scenes"
for f in "${FILES[@]}" "$SCENE"; do cp "$DST/$f" "$BK/$f"; done
echo "원본 백업: $BK"

for f in "${FILES[@]}" "${NEW_FILES[@]}"; do cp "$SRC/naju01/$f" "$DST/$f"; done
node "$SRC/씬고치기.mjs" "$DST/$SCENE"
node "$SRC/씬고치기2.mjs" "$DST/$SCENE"

echo
echo "적용 완료."
echo "  개발 서버:   cd ~/kgeseo && rm -rf node_modules/.vite && npx vite naju01"
echo "  발표용 빌드: cd ~/kgeseo && npx vite build naju01 && npx vite preview naju01"
echo
echo "  주소 스위치 (붙이면 켜지고, 떼면 원래 화면):"
echo "    http://localhost:5174/?발표                 라벨·격자·표식 끔"
echo "    http://localhost:5174/?발표=가볍게          + 원경 밀도·해상도·MSAA 낮춤, 물 그림자 끔"
echo "    http://localhost:5174/?발표=최소            + 바닥결·물잔결까지 끔 (비상용)"
echo "    http://localhost:5174/?발표=가볍게&분위기=저녁   + 로비처럼 어두운 바탕·낮은 해"
echo "    http://localhost:5174/?발표=가볍게&분위기=밤"
