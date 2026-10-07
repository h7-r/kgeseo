import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

/** GLB 안의 메시 하나. 변환은 루트 기준으로 풀어 둔 값이다. */
export interface GltfPart {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

/**
 * GLB 를 메시 조각 목록으로 푼다. <primitive> 는 자식 JSX 를 못 받아 외곽선을 붙일 수 없어서
 * 조각마다 <mesh> 로 다시 그린다. 루트 기준 변환을 그대로 물려주므로 모양은 원본과 같다.
 */
// eslint-disable-next-line react-refresh/only-export-components -- 조각 풀기·그리기·훅은 한 짝이라 같은 파일에 둔다
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

interface GltfPartsProps {
  parts: GltfPart[];
  outline?: OutlineValues | null;
  /** 선을 두르지 않을 메시 이름(전구처럼 스스로 빛나는 부품) */
  outlineExclude?: string[];
  /** 작고 굴곡진 물건은 그림자맵 해상도가 모자라 제 표면에 섀도 아크네가 생긴다 — 그럴 땐 끈다. */
  receiveShadow?: boolean;
}

/** splitGltf 조각을 메시로 그리고 조각마다 외곽선·주름선을 붙인다. */
export function GltfParts({ parts, outline, outlineExclude, receiveShadow = true }: GltfPartsProps) {
  return parts.map((part, i) => (
    <mesh
      key={i}
      geometry={part.geometry}
      material={part.material}
      position={part.position}
      quaternion={part.quaternion}
      scale={part.scale}
      castShadow
      receiveShadow={receiveShadow}
    >
      <ToonOutline geometry={part.geometry} outline={outlineExclude?.includes(part.name) ? null : outline} />
    </mesh>
  ));
}

/** GLB 를 복제해 한 색 툰 재질로 칠한 뒤 조각으로 푼다. 원본을 공유하면 색이 서로 물든다. */
// eslint-disable-next-line react-refresh/only-export-components -- 위와 같은 이유
export function useToonParts(path: string, color: THREE.ColorRepresentation): GltfPart[] {
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
