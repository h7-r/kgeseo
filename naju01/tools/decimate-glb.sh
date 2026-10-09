#!/usr/bin/env bash
# decimate-glb.sh — 런타임에 읽는 GLB(사람 · 구렁이)의 면수·텍스처를 줄인다.
#   쓰는 법:  bash naju01/tools/decimate-glb.sh            (아래 표 그대로 전부)
#             bash naju01/tools/decimate-glb.sh --restore  (archive/ 보관본으로 복구)
#
# gltf-transform: weld(안 하면 simplify 가 면을 찢는다) → simplify → resize → prune.
# Draco/Meshopt 압축은 로더에 디코더를 물려야 해서 걸지 않는다.
# 처음 한 번 archive/ 에 보관본을 두고 언제나 거기서 줄인다.
set -euo pipefail
cd "$(dirname "$0")/.."
GLTF=../node_modules/.bin/gltf-transform
MODEL_DIR=assets/models
BACKUP_DIR=$MODEL_DIR/archive
mkdir -p "$BACKUP_DIR"

if [[ "${1:-}" == "--restore" ]]; then
  n=0
  for f in "$BACKUP_DIR"/*.glb; do [[ -f "$f" ]] || continue; cp "$f" "$MODEL_DIR/$(basename "$f")"; n=$((n+1)); done
  echo "되돌렸다 — $n 개."
  exit 0
fi

# 이름  감면비율  텍스처한변 — 구렁이는 눈앞에서 보는 주인공이라 넉넉히 남긴다.
TABLE=(
  "fisher          0.075 1024"
  "fisher2         0.075 1024"
  "fisher3         0.075 1024"
  "abisa           0.075 1024"
  "serpent-colored 0.15  1024"
)

tri_count() { "$GLTF" inspect "$1" 2>/dev/null | grep -E '^│ 0 │ .*TRIANGLES' | head -1 | awk -F'│' '{gsub(/[ ,]/,"",$6); print $6}'; }

printf "\n  %-10s %10s → %8s   %8s → %7s\n" "모형" "삼각형" "" "파일" ""
for row in "${TABLE[@]}"; do
  read -r name ratio side <<<"$row"
  src="$BACKUP_DIR/$name.glb"; dst="$MODEL_DIR/$name.glb"
  [[ -f "$dst" ]] || { echo "  $name.glb 가 없다 — 건너뛴다"; continue; }
  [[ -f "$src" ]] || cp "$dst" "$src"
  before_kb=$(( $(stat -f%z "$src") / 1024 ))
  before_tri=$(tri_count "$src")
  tmp=$(mktemp -t glb).glb
  "$GLTF" weld "$src" "$tmp" >/dev/null 2>&1
  "$GLTF" simplify "$tmp" "$tmp" --ratio "$ratio" --error 0.01 >/dev/null 2>&1
  "$GLTF" resize "$tmp" "$tmp" --width "$side" --height "$side" >/dev/null 2>&1
  "$GLTF" prune "$tmp" "$dst" >/dev/null 2>&1
  rm -f "$tmp"
  after_kb=$(( $(stat -f%z "$dst") / 1024 ))
  after_tri=$(tri_count "$dst")
  printf "  %-10s %10s → %8s   %6s KB → %4s KB\n" "$name" "$before_tri" "$after_tri" "$before_kb" "$after_kb"
done
echo
echo "  텍스처는 ${side}² · 원본은 $BACKUP_DIR/ 에 있다."
