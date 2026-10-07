import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";

import type { InstanceGroup } from "../../placement/instanceGroups";
import type { GroundShading } from "../useNajuControls";
import GroundMaterial from "./GroundMaterial";
import { castsShadow, isOutlinedGroup } from "./groupRules";

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
