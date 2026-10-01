#!/bin/bash
# 상의가 있는 모델 넷의 목선·밑단을 고친다. 자리에서(in place) 고치되 임시 파일을 거친다.
#   naju01/도구/상의고치기.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
B=/Applications/Blender.app/Contents/MacOS/Blender
T=$(mktemp -d)
# 착장마다 목선 모양이 달라 고리를 모으는 가로 반경(--ring)을 따로 준다.
#   남성 top 은 목선이 유난히 높고 고르지 않아 어떤 값으로도 구가 안 맞는다. 목선 고치기는
#   건너뛰고(스크립트가 스스로 COLLAR_SKIP 한다) 밑단만 손본다.
목선옵션() {
  case "$1" in
    top-female) echo "--ring 0.060" ;;
    *) echo "" ;;
  esac
}

for f in top-female both-female top-male both-male; do
  G=public/models/meshy-$f.glb
  echo "== $f"
  # 목선을 못 잡으면(COLLAR_SKIP) 아무것도 안 내놓는다 — 그때는 원본을 그대로 다음 단계로 넘긴다.
  rm -f "$T/a.glb"
  "$B" --background --factory-startup --python naju01/도구/meshy_round_collar.py -- \
    --glb "$G" --out "$T/a.glb" $(목선옵션 "$f") | grep -E "^COLLAR"
  [ -f "$T/a.glb" ] || cp "$G" "$T/a.glb"
  "$B" --background --factory-startup --python naju01/도구/meshy_soften_hem.py -- \
    --glb "$T/a.glb" --out "$T/b.glb" | grep -E "^HEM"
  mv "$T/b.glb" "$G"
done
echo "끝"
