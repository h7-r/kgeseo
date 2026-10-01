#!/bin/bash
# 캐릭터 모델의 표식·목선·밑단을 바로잡는다. 자리에서(in place) 고치되 임시 파일을 거친다.
#   naju01/도구/상의고치기.sh
#
# 순서가 중요하다.
#   ① 표식 섬 지우기 — 목선 맞추기가 **표식을 기준**으로 삼으므로 먼저 깨끗하게 만든다.
#      (여성 기본 착장은 이걸 먼저 돌리자 목선 맞춤 오차가 2.6mm → 1.3mm 로 줄었다)
#   ② 목선 둥글리기 — 상의가 있는 착장만. 못 맞추면 스스로 건너뛴다.
#   ③ 밑단 접힘 눕히기 — 상의가 있는 착장만.
set -euo pipefail
cd "$(dirname "$0")/../.."
B=/Applications/Blender.app/Contents/MacOS/Blender
T=$(mktemp -d)

# 단계마다 Blender 가 텍스처를 **다시 JPEG 로 굽는다.** 세 단계를 기본 품질로 지나면
#   같은 그림을 세 번 재압축해 눈에 띄게 뭉개진다. 중간 단계는 100 으로 지나가고
#   마지막 단계에서만 평소 품질(85)로 굽는다.
MID=(--jpeg 100)  # 중간 단계 품질

for f in base-female top-female bottom-female both-female base-male top-male bottom-male both-male; do
  G=public/models/meshy-$f.glb
  echo "== $f"
  rm -f "$T/a.glb"
  "$B" --background --factory-startup --python naju01/도구/meshy_fix_tint_islands.py -- \
    --glb "$G" --out "$T/a.glb" "${MID[@]}" | grep -E "^ISLE_(WELD|FIX|OK|NOCHANGE)"
  # 바뀐 게 없으면 내보내지 않는다 — 원본을 그대로 다음 단계로 넘긴다.
  [ -f "$T/a.glb" ] || cp "$G" "$T/a.glb"
  case "$f" in
    top-*|both-*)
      rm -f "$T/b.glb"
      "$B" --background --factory-startup --python naju01/도구/meshy_round_collar.py -- \
        --glb "$T/a.glb" --out "$T/b.glb" "${MID[@]}" | grep -E "^COLLAR"
      # 목선을 못 잡으면 아무것도 안 내놓는다 — 그때는 앞 단계 결과를 그대로 넘긴다.
      [ -f "$T/b.glb" ] || cp "$T/a.glb" "$T/b.glb"
      "$B" --background --factory-startup --python naju01/도구/meshy_soften_hem.py -- \
        --glb "$T/b.glb" --out "$T/c.glb" | grep -E "^HEM_(PICK|SOFT|OK)"
      mv "$T/c.glb" "$G"
      ;;
    *)
      # 상의가 없는 착장은 표식만 손본다. 바뀐 게 없으면 파일을 건드리지 않는다.
      cmp -s "$T/a.glb" "$G" || mv "$T/a.glb" "$G"
      ;;
  esac
done
echo "끝"
