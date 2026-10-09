import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

import { TOON_GRADIENT } from "@/engine/toon";

// <primitive> 는 자식 JSX 를 못 받아 외곽선을 붙일 수 없다. 그래서 GLB 를 메시 단위로 풀어 <mesh> 로 다시 그린다.

/** GLB 안의 메시 하나. 변환은 루트 기준으로 풀어 둔 값이다. */
export interface GltfPart {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

/** GLB 를 메시 조각 목록으로 푼다. 루트 기준 변환을 그대로 물려주므로 모양은 GLB 와 같다. */
export function splitGltf(root: THREE.Object3D): GltfPart[] {
  root.updateMatrixWorld(true);
  const parts: GltfPart[] = [];
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.matrixWorld.decompose(position, quaternion, scale);
    parts.push({
      name: object.name,
      geometry: object.geometry,
      material: object.material,
      position: position.toArray(),
      quaternion: quaternion.toArray(),
      scale: scale.toArray(),
    });
  });
  return parts;
}

/** 메시가 하나뿐인 GLB 의 지오. 지오만 꺼내 <mesh> 로 다시 그릴 때 쓴다. */
export function findFirstMeshGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  const found: THREE.BufferGeometry[] = [];
  root.traverse((object) => {
    if (!found.length && object instanceof THREE.Mesh) found.push(object.geometry);
  });
  return found[0] ?? null;
}

/** GLB 를 복제해 한 색 툰 재질로 칠한 뒤 조각으로 푼다. 캐시된 GLB 를 그대로 칠하면 색이 서로 물든다. */
export function useToonGltfParts(path: string, color: THREE.ColorRepresentation): GltfPart[] {
  const { scene } = useGLTF(path);
  const model = useMemo(() => {
    const cloned = scene.clone(true);
    cloned.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.material = new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT });
      object.castShadow = true;
      object.receiveShadow = true;
    });
    return cloned;
  }, [scene, color]);
  return useMemo(() => splitGltf(model), [model]);
}
