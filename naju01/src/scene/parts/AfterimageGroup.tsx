import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import type { InstanceGroup } from "../../placement/instanceGroups";
import { distortionMeshName } from "../../plan/meshNames";
import { UNITS_PER_METER } from "../../plan/sitePlan";
import { afterimageColor, afterimageOffsets, swayAfterimage, type DistortionKind } from "../../story/distortion";

interface AfterimageGroupProps {
  group: InstanceGroup;
  kind: DistortionKind;
  strength: number;
  horizonColor: string;
}

const ignoreRaycast = () => {};

/**
 * 왜곡 잔상 — 같은 무리를 조금씩 어긋나게 여러 벌 겹쳐 그린다.
 * 색은 지평선 쪽으로 당긴다(마을 색 그대로 겹치면 진해져 오히려 또렷해진다).
 * 잔상은 그림일 뿐이라 광선에서 뺀다 — 편집기가 집으면 있지도 않은 마을을 고른다.
 */
export default function AfterimageGroup({ group, kind, strength, horizonColor }: AfterimageGroupProps) {
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const layers = useRef<(THREE.Group | null)[]>([]);
  const afterimages = useMemo(() => afterimageOffsets(kind, strength), [kind, strength]);
  const offset = useRef(new THREE.Vector3());

  useEffect(() => {
    meshes.current.forEach((mesh) => {
      if (!mesh) return;
      mesh.raycast = ignoreRaycast;
      mesh.userData.isAfterimage = true;
    });
  }, [group, afterimages]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    layers.current.forEach((layer, i) => {
      if (!layer) return;
      const v = swayAfterimage(afterimages[i], t, offset.current);
      layer.position.set(v.x * UNITS_PER_METER, v.y * UNITS_PER_METER, v.z * UNITS_PER_METER);
    });
  });

  if (!afterimages.length) return null;
  let meshIndex = -1;
  return (
    <>
      {afterimages.map((afterimage, layerIndex) => (
        <group
          key={`afterimage-${group.groupId}-${layerIndex}`}
          ref={(layer) => {
            layers.current[layerIndex] = layer;
          }}
        >
          {group.batches.map((batch, i) => {
            meshIndex += 1;
            const slot = meshIndex;
            return (
              <instancedMesh
                key={`${group.groupId}-afterimage${layerIndex}-${i}`}
                ref={(mesh) => {
                  meshes.current[slot] = mesh;
                }}
                name={distortionMeshName(group.groupId)}
                args={[batch.geometry, undefined, batch.ids.length]}
                frustumCulled={false}
                onUpdate={(mesh) => {
                  mesh.instanceMatrix.array.set(batch.matrices);
                  mesh.instanceMatrix.needsUpdate = true;
                }}
              >
                <meshLambertMaterial
                  color={afterimageColor("#8E8778", horizonColor, strength)}
                  transparent
                  opacity={afterimage.opacity}
                  depthWrite={false}
                  side={THREE.FrontSide}
                />
              </instancedMesh>
            );
          })}
        </group>
      ))}
    </>
  );
}
