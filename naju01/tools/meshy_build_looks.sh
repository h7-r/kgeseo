#!/bin/bash
# Meshy 착장 8개를 각각 완성된 캐릭터 GLB 로 만든다.
# 옷을 모델 사이에 옮겨 입히지 않고, 그 옷을 이미 입은 Meshy 모델을 착장마다 쓴다.
# 착장마다: 리깅 → 머리카락 얹기 → T자세 펴기·89본 골격 재바인딩 → 입 지우기 → 브라우저용 축소.
#
#   naju01/tools/meshy_build_looks.sh [output-dir]
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=${1:-public/models}
WORK=$(mktemp -d)
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
D=$HOME/Downloads
P=naju01/character-work/meshy-parts
blend() { "$BLENDER" --background --factory-startup --python "$1" -- "${@:2}"; }

# 성별:착장:원본 glb — 여성 기본 착장이 8개 전부의 체형·자세 기준이라 맨 앞에 둔다(기준 골격을 여기서 뽑는다).
LOOKS=(
  "female:base:$D/Meshy_AI_Bald_Fitness_Avatar_0917063125_texture.glb"
  "female:top:$D/Meshy_AI_Bald_Anime_Avatar_0917232806_texture.glb"
  "female:bottom:$D/Meshy_AI_Neutral_Anime_Charact_0917234029_texture.glb"
  "female:both:$D/Meshy_AI_Mia_0917064547_texture.glb"
  "male:base:$D/Meshy_AI_Bald_Cartoon_Boy_0917063109_texture.glb"
  "male:top:$D/Meshy_AI_Bald_Buddy_0917232757_texture.glb"
  "male:bottom:$D/Meshy_AI_Bald_Cartoon_Fitness__0917234347_texture.glb"
  "male:both:$D/Meshy_AI_Bald_Cartoon_Boy_in_W_0917064538_texture.glb"
)

for entry in "${LOOKS[@]}"; do
  IFS=: read -r gender look source <<< "$entry"
  label=$( [ "$gender" = male ] && echo Male || echo Female )
  hair1=$( [ "$gender" = male ] && echo hair_m1 || echo hair_f1 )
  hair2=$( [ "$gender" = male ] && echo hair_m2 || echo hair_f2 )
  hairsrc1=$( [ "$gender" = male ] && echo "$D/Meshy_AI_Young_Boy_Character_0917063138_texture.glb" || echo "$D/Meshy_AI_Maya_0917063159_texture.glb" )
  hairsrc2=$( [ "$gender" = male ] && echo "$D/Meshy_AI_Barefoot_Gym_Girl_0917063150_texture.glb" || echo "$D/Meshy_AI_Mia_0917063210_texture.glb" )
  echo "== $gender $look"

  # 1) 검수한 머리카락 조각을 이 착장의 머리에 맞춰 얹는다
  for pair in "$hair1:$hairsrc1:0" "$hair2:$hairsrc2:1"; do
    IFS=: read -r name src variant <<< "$pair"
    blend naju01/tools/meshy_extract_hair.py --base "$source" --variant "$src" \
      --selection "$P/$name/select/selection.json" --out-dir "$WORK/${gender}_${look}_${name}" >/dev/null
  done

  # 2) 리깅 3) 머리카락 4) T자세·재바인딩·체형 — 옷 입은 모델은 소매·밑단에 관절 검출이 속으니
  #    기본 착장에서 잡은 관절을 같은 성별의 나머지 착장에 물려준다.
  joints=$P/joints-${gender}.json
  joints_arg=(--joints "$joints")
  [ "$look" = base ] && joints_arg=(--joints-out "$joints")
  blend naju01/tools/meshy_base_rig.py --"$gender" "$source" "${joints_arg[@]}" \
    --blend-output "$WORK/${gender}_${look}.blend" --review-dir "$WORK/review_${gender}_${look}" >/dev/null
  blend naju01/tools/meshy_add_hair.py --blend "$WORK/${gender}_${look}.blend" --label "$label" \
    --hair "$WORK/${gender}_${look}_${hair1}/hair.glb=0" "$WORK/${gender}_${look}_${hair2}/hair.glb=1" \
    --out-blend "$WORK/${gender}_${look}.blend" >/dev/null
  # 착장마다 체형이 조금씩 달라 성별마다 기본 착장 골격을 기준으로 맞춘다
  # (남녀를 한 골격으로 묶으면 남자 어깨가 좁아져 팔이 몸에 파묻힌다).
  canon=$P/canonical-${gender}.json
  canon_arg=(--canonical "$canon")
  [ "$look" = base ] && canon_arg=(--canonical-out "$canon")
  blend naju01/tools/build_chibi_body.py "${canon_arg[@]}" --v4-blend "$WORK/${gender}_${look}.blend" \
    --sidekick-blend "$D/SIDEKICK_customizer_base.blend" --blend-output "$WORK/rigged_${gender}_${look}.blend" \
    --glb-dir "$WORK/full" --report "$WORK/report_${gender}_${look}.json" \
    --height 1.45 --head-scale 1 --leg-length 1 --arm-thickness 1 --leg-thickness 1 \
    --torso-width 1 --neck-thickness 1 --arm-twist-deg 0 --straighten-legs \
    --labels "$label" --glb-prefix "meshy-${look}" --face-budget 80000 --hair-budget 28000 --leg-smooth 6 >/dev/null

  # 5) 텍스처에 그려진 입을 지운다(웃는 표정이 어색하다)
  blend naju01/tools/meshy_erase_mouth.py --blend "$WORK/rigged_${gender}_${look}.blend" \
    --out-blend "$WORK/rigged_${gender}_${look}.blend" --labels "$label" \
    --report "$P/mouth-${gender}-${look}.json" >/dev/null

  # 6) 브라우저용 크기로 내보낸다
  blend naju01/tools/meshy_optimize.py --blend "$WORK/rigged_${gender}_${look}.blend" \
    --glb-dir "$OUT" --prefix "meshy-${look}" --texture 2048 \
    --labels "$label" --report "$P/optimize-${gender}-${look}.json" | grep MESHY_OPTIMIZE_OK
done
echo "WORK=$WORK"
