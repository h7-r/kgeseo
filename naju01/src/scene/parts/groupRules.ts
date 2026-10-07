import * as THREE from "three";

// 무리 이름은 edits.json 의 열쇠라 한글 값 그대로다. 아래 규칙도 그 값을 본다.

/** 초목 무리 — 외곽선을 두르면 잎마다 테가 생겨 숲이 검은 덩어리가 된다. */
export const isVegetationGroup = (groupId = "") =>
  /^(언덕수풀|길가수풀|절벽틈덤불|비탈덤불|절벽머리)\./.test(groupId) ||
  /^(절벽틈덤불|비탈덤불|절벽머리)$/.test(groupId) ||
  /^소품\.(나무|덤불|수풀|풀|꽃)$/.test(groupId) ||
  /^원경\.나무$/.test(groupId);

/**
 * 외곽선은 지오메트리를 한 벌 더 그리므로 「사람이 만든 것」(플레이어가 다가가 만지는 물건)에만 두른다.
 * 씬 요소·울타리·마당울·장승·명패·횃불·비석·무덤·나룻배·나루터·징검돌·인물 — 전체 삼각형의 8.2 %.
 */
export const isOutlinedGroup = (groupId = "", includeVegetation = false) =>
  (includeVegetation && isVegetationGroup(groupId)) ||
  /^씬[1-5]\./.test(groupId) ||
  /^(울타리|원경\.집울|원경\.택촌울)\./.test(groupId) ||
  /^소품\.(명패|장승|횃불|비석|무덤|울타리|나룻배|나루터|인물)$/.test(groupId) ||
  /^(나룻배|돌다리\.디딤돌|원경\.나루터)$/.test(groupId);

/**
 * 그림자를 안 드리우는 이름 끝마디. 지피식물과 바닥에 깔린 돌은 그림자가 안 보이는데 비용은 크다
 * (바닥 돌 셋이 그림자 부하의 38 %). 경계 구가 커서 그림자 카메라를 좁혀도 늘 걸친다.
 * 부분 문자열로 거르면 `풀` 이 `수풀` 에도 걸려 덤불 그림자가 통째로 빠진다 — 끝마디를 정확히 본다.
 */
const NO_SHADOW_NAMES = new Set(["잡초", "꽃", "잎더미", "자갈", "풀", "풀포기", "발치너덜", "길가돌", "틈바위"]);

export const castsShadow = (groupId = "") =>
  !NO_SHADOW_NAMES.has(groupId.split(".").pop() ?? "") && !NO_SHADOW_NAMES.has(groupId);

/** 돌마다 어둠→밝음 사이를 0.32~0.94 로 섞는다. 다 같은 회색이면 자갈밭이 시멘트 판으로 보인다. */
export function stoneShade(light: THREE.ColorRepresentation, dark: THREE.ColorRepresentation) {
  const lightColor = new THREE.Color(light);
  const darkColor = new THREE.Color(dark);
  const color = new THREE.Color();
  return (t: number) =>
    color
      .copy(darkColor)
      .lerp(lightColor, 0.32 + t * 0.62)
      .getHex();
}
