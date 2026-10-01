#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  GLB감면.sh — 런타임에 읽는 GLB(사람 · 구렁이)의 면수·텍스처를 줄인다
# ═══════════════════════════════════════════════════════════════
#  쓰는 법:  bash 도구/GLB감면.sh            (아래 표 그대로 전부)
#            bash 도구/GLB감면.sh --되돌리기  (원본 보관본으로 복구)
#
# [왜 필요한가 — 실측]
#   `구운모형.js` 가 읽는 어부 · 어부2 · 어부3 · 아비사가 **각각 20 만 삼각형**
#   이었다(Meshy 원본 그대로). 넷이면 80 만 — 수풀·나무를 다 줄인 뒤에는
#   한 화면 220 만 중 80 만이 이 넷이었다. 게다가 저마다 2048² 텍스처 석 장
#   (VRAM 67 MB)을 물고 있어 넷이면 268 MB 다. 1.7 m 사람을 몇 m 밖에서 보는데
#   그 해상도는 화면 픽셀보다 촘촘하다.
#
# [무엇을 하나 — gltf-transform (MIT · 무료)]
#   weld     같은 자리 꼭짓점 합치기(안 하면 simplify 가 면을 찢는다)
#   simplify meshoptimizer 로 목표 비율까지 감면 (형태 오차 0.01 이내)
#   resize   텍스처를 1024² 로 (VRAM 1/4 · JPEG 해독도 1/4)
#   prune    안 쓰는 것 걷어내기
#   ※ Draco/Meshopt **압축은 안 건다.** 로더 쪽(`구운모형.js`·`새지형.js`)에
#     디코더를 물려야 하는데, 발표 전에 그 갈래까지 건드리지 않는다.
#     파일 크기는 텍스처 축소만으로도 1/3 이 된다.
#
# [보관본]  처음 한 번 `에셋/모형/원본보관/` 에 복사해 두고 언제나 거기서 줄인다.
# ※ 셸 **변수 이름은 ASCII** 다 — bash 는 한글 변수를 명령으로 오해한다
#   (`모형방=…: No such file or directory` 로 실제로 죽었다). 값·주석은 한글이어도 된다.
set -euo pipefail
cd "$(dirname "$0")/.."
GT=../node_modules/.bin/gltf-transform
MODEL_DIR=에셋/모형
BACKUP_DIR=$MODEL_DIR/원본보관
mkdir -p "$BACKUP_DIR"

if [[ "${1:-}" == "--되돌리기" ]]; then
  n=0
  for f in "$BACKUP_DIR"/*.glb; do [[ -f "$f" ]] || continue; cp "$f" "$MODEL_DIR/$(basename "$f")"; n=$((n+1)); done
  echo "되돌렸다 — $n 개."
  exit 0
fi

# 이름  감면비율  텍스처한변
#   사람 넷은 20 만 → 1.5 만(비율 0.075). 구렁이-색은 8 만 → 1.2 만.
#   구렁이는 사건의 주인공이라 눈앞에서 보므로 조금 넉넉히 둔다.
TABLE=(
  "어부      0.075 1024"
  "어부2     0.075 1024"
  "어부3     0.075 1024"
  "아비사    0.075 1024"
  "구렁이-색 0.15  1024"
)

tri_count() { "$GT" inspect "$1" 2>/dev/null | grep -E '^│ 0 │ .*TRIANGLES' | head -1 | awk -F'│' '{gsub(/[ ,]/,"",$6); print $6}'; }

printf "\n  %-10s %10s → %8s   %8s → %7s\n" "모형" "삼각형" "" "파일" ""
for row in "${TABLE[@]}"; do
  read -r name ratio side <<<"$row"
  src="$BACKUP_DIR/$name.glb"; dst="$MODEL_DIR/$name.glb"
  [[ -f "$dst" ]] || { echo "  $name.glb 가 없다 — 건너뛴다"; continue; }
  [[ -f "$src" ]] || cp "$dst" "$src"
  before_kb=$(( $(stat -f%z "$src") / 1024 ))
  before_tri=$(tri_count "$src")
  tmp=$(mktemp -t glb).glb
  "$GT" weld "$src" "$tmp" >/dev/null 2>&1
  "$GT" simplify "$tmp" "$tmp" --ratio "$ratio" --error 0.01 >/dev/null 2>&1
  "$GT" resize "$tmp" "$tmp" --width "$side" --height "$side" >/dev/null 2>&1
  "$GT" prune "$tmp" "$dst" >/dev/null 2>&1
  rm -f "$tmp"
  after_kb=$(( $(stat -f%z "$dst") / 1024 ))
  after_tri=$(tri_count "$dst")
  printf "  %-10s %10s → %8s   %6s KB → %4s KB\n" "$name" "$before_tri" "$after_tri" "$before_kb" "$after_kb"
done
echo
echo "  ※ 텍스처는 ${side}² · 원본은 $BACKUP_DIR/ 에 있다."
