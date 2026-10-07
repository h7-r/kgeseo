import type * as THREE from "three";

/**
 * GLB 안 첫 메시의 지오. <primitive> 는 자식 JSX 를 못 받아 외곽선을 붙일 수 없어,
 * 메시가 하나뿐인 모델은 지오만 꺼내 <mesh> 로 다시 그린다.
 */
export function firstMeshGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  const found: THREE.BufferGeometry[] = [];
  root.traverse((object) => {
    if (!found.length && (object as THREE.Mesh).isMesh) found.push((object as THREE.Mesh).geometry);
  });
  return found[0] ?? null;
}
