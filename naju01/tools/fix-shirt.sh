#!/bin/bash
# 캐릭터 모델의 표식·목선·밑단을 바로잡는다. 자리에서 고치되 임시 파일을 거친다.
#   naju01/tools/fix-shirt.sh
#
# 순서: 1) 표식 섬 지우기(목선 맞추기가 표식을 기준으로 삼으므로 먼저)
#       2) 목선 둥글리기, 3) 밑단 접힘 눕히기 — 둘 다 상의가 있는 착장만.
set -euo pipefail
cd "$(dirname "$0")/../.."
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
WORK=$(mktemp -d)

# 단계마다 텍스처를 JPEG 로 다시 굽기 때문에 중간 단계는 100 으로 지나
#   재압축으로 뭉개지지 않게 하고, 마지막 단계에서만 평소 품질(85)로 굽는다.
MID=(--jpeg 100)

for f in base-female top-female bottom-female both-female base-male top-male bottom-male both-male; do
  G=public/models/meshy-$f.glb
  echo "== $f"
  rm -f "$WORK/a.glb"
  "$BLENDER" --background --factory-startup --python naju01/tools/meshy_fix_tint_islands.py -- \
    --glb "$G" --out "$WORK/a.glb" "${MID[@]}" | grep -E "^ISLE_(WELD|FIX|OK|NOCHANGE)"
  # 바뀐 게 없으면 내보내지 않으므로 입력 파일을 그대로 다음 단계로 넘긴다.
  [ -f "$WORK/a.glb" ] || cp "$G" "$WORK/a.glb"
  case "$f" in
    top-*|both-*)
      rm -f "$WORK/b.glb"
      "$BLENDER" --background --factory-startup --python naju01/tools/meshy_round_collar.py -- \
        --glb "$WORK/a.glb" --out "$WORK/b.glb" "${MID[@]}" | grep -E "^COLLAR"
      # 목선을 못 잡으면 출력이 없으니 앞 단계 결과를 그대로 넘긴다.
      [ -f "$WORK/b.glb" ] || cp "$WORK/a.glb" "$WORK/b.glb"
      "$BLENDER" --background --factory-startup --python naju01/tools/meshy_soften_hem.py -- \
        --glb "$WORK/b.glb" --out "$WORK/c.glb" | grep -E "^HEM_(PICK|SOFT|OK)"
      mv "$WORK/c.glb" "$G"
      ;;
    *)
      # 상의가 없는 착장은 표식만 손본다. 바뀐 게 없으면 파일을 건드리지 않는다.
      cmp -s "$WORK/a.glb" "$G" || mv "$WORK/a.glb" "$G"
      ;;
  esac
done
echo "끝"
