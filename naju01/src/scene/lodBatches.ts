// 원근 나눔(LOD) 묶음 — 인스턴스 무리에 「원경판」 짝을 싣는다. (옛 배치.js `원경모양들` + 공간그레이박스 `원근담기`, 10/13)
//
// [왜]  면수표에서 나무 171그루 × 1.8천 = 30만, 덤불 190개 × 860 = 16만이 상위였다.
//       한 그루는 이미 가볍다 — **개수**가 무겁다.
// [어떻게]  모양마다 원경판(약 420 / 220 삼각형) 짝을 같이 싣고, 그리는 쪽(InstanceGroupMesh)이
//       0.5초마다 **카메라 거리**로 나눠 담는다(가까우면 원본, 멀면 원경판).
//       ※ 처음엔 「코어 밖이면 원경판」으로 고정 분할했는데, 언덕수풀은 전부 코어 **안**
//         비탈에 뿌려져 있어 하나도 안 바뀌었다(10/13 실측 155만 → 153만). 그래서 카메라 거리로.
//       무리 이름·번호·모양 번호는 그대로라 `edits.json` 손 배치·편집기 집기가 안 깨진다.
//
// 원경판 묶음은 `batches` 에 섞지 않고 `farBatches` 로 따로 둔다 — 소품 충돌(movement/propColliders)이
// `batches` 를 돌며 기둥을 세우는데, 같은 자리의 짝이 섞이면 충돌을 두 번 센다(옛 소품충돌.js 의 `if (원경) continue`).

import * as THREE from "three";

import type { InstanceGroup } from "../placement/instanceGroups";

export type InstanceBatch = InstanceGroup["batches"][number];

/** 원근 나눔 거리 — 이보다 먼 나무·덤불·돌·집은 원경판으로 그린다(m). 무대가 80 × 50 m 라 어디 서든 절반 이상이 이 밖이다. */
export const FAR_LOD_DISTANCE_M = 22;

export interface LodInstanceGroup extends InstanceGroup {
  /**
   * `batches[i]` 의 원경판 짝. 같은 자리 목록(matrices · colors · ids)을 **공유**하고 지오만 다르다.
   * 짝이 없는 모양은 null. 필드가 없으면 원근 나눔이 없는 무리다.
   */
  farBatches?: (InstanceBatch | null)[];
}

/** 이 무리에 원경판 짝이 하나라도 있나 */
export const hasFarBatches = (group: InstanceGroup | null | undefined): group is LodInstanceGroup =>
  !!group && !!(group as LodInstanceGroup).farBatches?.some(Boolean);

// vertexColors 재질에 color 속성이 없으면 (0,0,0) 으로 읽혀 통째로 검게 나온다(placement/instanceGroups 의 fillWhite 와 같다)
function fillWhite(geometry: THREE.BufferGeometry) {
  if (!geometry || geometry.attributes.color) return;
  const count = geometry.attributes.position.count;
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
}

/**
 * 무리의 모양 k 마다 원경판 k 를 **같은 자리 목록**으로 하나 더 싣는다.
 * `farShapes.length !== 원본 모양 수` 면(짝이 안 맞으면) 아무것도 하지 않는다 — 번호로 짝짓기 때문에 어긋나면 엉뚱한 모양이 멀리 선다.
 * 모양번호(shapeIndex)는 원본과 같게 둔다 — 편집기가 집어 복사하면 원본 모양으로 붙는다.
 */
export function attachFarShapes(
  group: InstanceGroup | null,
  farShapes: THREE.BufferGeometry[] | null | undefined,
  nearShapeCount: number,
): InstanceGroup | null {
  if (!group || !farShapes?.length || farShapes.length !== nearShapeCount) return group;
  const farBatches: (InstanceBatch | null)[] = group.batches.map((batch) => {
    const geometry = farShapes[batch.shapeIndex];
    if (!geometry) return null;
    if (!group.material) fillWhite(geometry);
    return { geometry, matrices: batch.matrices, colors: batch.colors, ids: batch.ids, shapeIndex: batch.shapeIndex };
  });
  if (!farBatches.some(Boolean)) return group;
  (group as LodInstanceGroup).farBatches = farBatches;
  return group;
}
