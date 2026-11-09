/**
 * 소지품 물건의 실물 모형(GLB) — 한 번만 읽어 두고, 쓰는 자리마다 복제한다.
 * 가장 긴 변을 size(미터)에 맞추고 밑면 가운데를 원점에 둔다. 읽는 중이거나 못 읽으면 null.
 */
import { useEffect, useState } from "react";
import * as THREE from "three";

import { createCompressedGltfLoader } from "../loaders/compressedGlb";

const cache = new Map<string, Promise<THREE.Object3D | null>>();

export function loadModel(url: string, size: number) {
  const key = `${url}@${size}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = new Promise((resolve) => {
      // 라이브러리 경량본은 meshopt·KTX2 압축 — 기본 로더로는 조용히 실패한다
      createCompressedGltfLoader().load(
        url,
        (gltf) => {
          const model = gltf.scene;
          model.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(model);
          const extent = box.getSize(new THREE.Vector3());
          const scale = size / (Math.max(extent.x, extent.y, extent.z) || 1);
          const center = box.getCenter(new THREE.Vector3());
          const holder = new THREE.Group();
          model.position.set(-center.x, -box.min.y, -center.z);
          holder.add(model);
          holder.scale.setScalar(scale);
          resolve(holder);
        },
        undefined,
        (error) => {
          console.warn("[itemModel] 모형을 못 읽었다:", url, error);
          resolve(null);
        },
      );
    });
    cache.set(key, pending);
  }
  return pending;
}

/** 모형 하나를 복제해 돌려준다. renderOrder 를 주면 조각마다 매긴다(손에 든 것은 맨 나중에 그린다) */
export function useItemModel(model: { url: string; size: number } | undefined, renderOrder = 0) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  useEffect(() => {
    if (!model) return undefined;
    let isAlive = true;
    void loadModel(model.url, model.size).then((source) => {
      if (!isAlive || !source) return;
      const copy = source.clone(true);
      copy.traverse((o) => {
        o.renderOrder = renderOrder;
        o.castShadow = true;
      });
      setObject(copy);
    });
    return () => {
      isAlive = false;
    };
  }, [model, renderOrder]);
  return object;
}
