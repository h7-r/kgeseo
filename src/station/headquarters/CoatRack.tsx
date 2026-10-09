import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

import GltfPartMeshes from "@/engine/GltfPartMeshes";
import { splitGltf } from "@/engine/gltfModel";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

const COAT_RACK_URL = "/models/coat_rack.glb";
useGLTF.preload(COAT_RACK_URL);

interface CoatRackProps {
  standColor?: THREE.ColorRepresentation;
  coatColor?: THREE.ColorRepresentation;
  /** 유닛. 5.8 ≈ 1.74m */
  height?: number;
  /** 좌우를 뒤집어 둘이 똑같아 보이지 않게 */
  mirrored?: boolean;
  outline?: OutlineValues | null;
}

/** 옷걸이 스탠드. GLB 안에서 "rack" / "coat" 메시가 나뉘어 있어 색을 따로 준다. */
export default function CoatRack({
  standColor = "#2A2E34",
  coatColor = "#3E4A5C",
  height = 5.8,
  mirrored = false,
  outline,
}: CoatRackProps) {
  const { scene } = useGLTF(COAT_RACK_URL);

  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const isCoat = object.name === "coat";
      object.material = new THREE.MeshToonMaterial({
        color: isCoat ? coatColor : standColor,
        gradientMap: TOON_GRADIENT,
        // 천은 안쪽도 보인다
        side: isCoat ? THREE.DoubleSide : THREE.FrontSide,
      });
      object.castShadow = true;
      object.receiveShadow = true;
    });
    return clone;
  }, [scene, standColor, coatColor]);
  const parts = useMemo(() => splitGltf(model), [model]);

  // 모델은 높이 1.0 으로 정규화돼 있다.
  return (
    <group scale={[mirrored ? -height : height, height, height]}>
      <GltfPartMeshes parts={parts} outline={outline} />
    </group>
  );
}
