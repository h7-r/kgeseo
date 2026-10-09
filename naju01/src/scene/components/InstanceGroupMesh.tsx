import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";

import type { InstanceGroup } from "../../placement/instanceGroups";
import type { GroundShading } from "../useNajuControls";
import GroundMaterial from "./GroundMaterial";

// 무리 이름은 edits.json 의 열쇠라 한글 값 그대로다. 아래 규칙도 그 값을 본다.

/** 초목 무리 — 외곽선을 두르면 잎마다 테가 생겨 숲이 검은 덩어리가 된다. */
const isVegetationGroup = (groupId = "") =>
  /^(언덕수풀|길가수풀|절벽틈덤불|비탈덤불|절벽머리)\./.test(groupId) ||
  /^(절벽틈덤불|비탈덤불|절벽머리)$/.test(groupId) ||
  /^소품\.(나무|덤불|수풀|풀|꽃)$/.test(groupId) ||
  /^원경\.나무$/.test(groupId);

/**
 * 외곽선은 지오메트리를 한 벌 더 그리므로 「사람이 만든 것」(플레이어가 다가가 만지는 물건)에만 두른다.
 * 씬 요소·울타리·마당울·장승·명패·횃불·비석·무덤·나룻배·나루터·징검돌·인물 — 전체 삼각형의 8.2 %.
 */
const isOutlinedGroup = (groupId = "", includeVegetation = false) =>
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

const castsShadow = (groupId = "") =>
  !NO_SHADOW_NAMES.has(groupId.split(".").pop() ?? "") && !NO_SHADOW_NAMES.has(groupId);

interface InstanceGroupMeshProps {
  group: InstanceGroup | null;
  outline: ReactNode;
  shading: GroundShading;
  brightness: number;
  outlineVegetation?: boolean;
  shadows?: boolean;
}

/**
 * 인스턴스 무리 하나. userData 에 무리 id 와 원래 번호를 실어 둔다 —
 * 편집기가 광선으로 집었을 때 「어느 무리의 몇 번인가」를 알아야 지우거나 옮길 수 있다.
 */
export default function InstanceGroupMesh({
  group,
  outline,
  shading,
  brightness,
  outlineVegetation = false,
  shadows = true,
}: InstanceGroupMeshProps) {
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  useEffect(() => {
    if (!group) return;
    group.batches.forEach((batch, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      mesh.instanceMatrix.array.set(batch.matrices);
      mesh.instanceMatrix.needsUpdate = true;
      // three 는 setColorAt 전까지 instanceColor 를 안 만든다 — 있을 때만 채우면 돌이 통째로 검게 나온다.
      if (batch.colors) {
        if (!mesh.instanceColor || mesh.instanceColor.count !== mesh.count)
          mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(batch.colors), 3);
        else mesh.instanceColor.array.set(batch.colors);
        mesh.instanceColor.needsUpdate = true;
      }
      mesh.userData.groupId = group.groupId;
      mesh.userData.ids = batch.ids;
      // 복사·붙여넣기가 같은 모양을 물려받게 남긴다
      mesh.userData.shapeIndex = batch.shapeIndex;
      mesh.computeBoundingSphere();
    });
  }, [group]);
  if (!group) return null;
  const groupOutline = outline && isOutlinedGroup(group.groupId, outlineVegetation) ? outline : null;
  return (
    <>
      {group.batches.map((batch, i) => (
        <instancedMesh
          key={`${group.groupId}-${batch.shapeIndex}-${batch.ids.length}`}
          // 블록으로 감싼다 — React 19 는 ref 콜백의 반환값을 정리 함수로 취급한다.
          ref={(mesh) => {
            meshes.current[i] = mesh;
          }}
          name={group.groupId}
          args={[batch.geometry, undefined, batch.ids.length]}
          castShadow={shadows && castsShadow(group.groupId)}
          receiveShadow
        >
          {/* 모형이 제 재질(텍스처·노멀맵)을 데려왔으면 그것을 쓴다 — 바닥재질은 정점 색 전용이다. */}
          {group.material ? (
            <primitive object={group.material} attach="material" />
          ) : (
            <GroundMaterial shading={shading} brightness={brightness} doubleSided={group.doubleSided} />
          )}
          {groupOutline}
        </instancedMesh>
      ))}
    </>
  );
}
