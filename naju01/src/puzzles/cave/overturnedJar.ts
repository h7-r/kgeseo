/** 엎어진 독 — 라이브러리 옹기 모형(CC BY 4.0)을 뒤집어 세우고, 못 읽으면 코드로 깎은 독으로 간다. 미터 */
import { useEffect, useState } from "react";
import * as THREE from "three";

import { createCompressedGltfLoader } from "../../loaders/compressedGlb";

/** 독이 엎어져 있는 자리(미터) */
export const JAR_SPOT = { x: 39.6, z: 62.6 };
const JAR_MODEL = `${import.meta.env.BASE_URL}_sf_local/lib/ast-prop-jar-onggi-01.glb`;
const JAR_HEIGHT = 0.95;

/** 코드로 깎은 독 — 아가리가 바닥에 닿아 있다 */
export function buildJarGeometry() {
  const profile: [number, number][] = [
    [0, 0],
    [0.3, 0],
    [0.4, 0.2],
    [0.42, 0.5],
    [0.36, 0.78],
    [0.26, 0.92],
    [0, 0.95],
  ];
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    18,
  );
}

/** 옹기 모형 — 아가리가 바닥에 닿게 뒤집어 세운다. 라이브러리 경량본은 meshopt·KTX2 압축이라 전용 로더로 읽는다 */
export function useOverturnedJarModel() {
  const [model, setModel] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let isAlive = true;
    createCompressedGltfLoader().load(
      JAR_MODEL,
      (gltf) => {
        if (!isAlive) return;
        const jar = gltf.scene;
        const box = new THREE.Box3().setFromObject(jar);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const scale = JAR_HEIGHT / (size.y || 1);
        jar.scale.setScalar(scale);
        jar.rotation.x = Math.PI; // (x, y, z) → (x, −y, −z)
        jar.position.set(-center.x * scale, box.max.y * scale, center.z * scale);
        jar.traverse((node) => {
          node.castShadow = true;
        });
        setModel(jar);
      },
      undefined,
      (error) => console.warn("[물굴] 옹기 모형을 못 읽었다 — 코드 독으로 간다:", error),
    );
    return () => {
      isAlive = false;
    };
  }, []);
  return model;
}
