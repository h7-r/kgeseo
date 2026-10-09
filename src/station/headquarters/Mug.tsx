import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

import GltfPartMeshes from "@/engine/GltfPartMeshes";
import { splitGltf } from "@/engine/gltfModel";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

// 부위 body / handle / coffee. 폭 1.90(손잡이 포함) · 높이 1.54 · 깊이 1.38, 밑면이 이미 y=0.
useGLTF.preload("/models/mug.glb");

/** 1유닛 ≈ 0.36m 에서 1.54 × 0.18 ≈ 10cm. 9cm 보다 조금 크게 잡아 눈에 잘 띄게 했다. */
const MUG_SCALE = 0.18;

interface MugProps {
  /** [x, z] */
  pos?: [number, number];
  rot?: number;
  /** 책상 윗면 */
  y?: number;
  scale?: number;
  sizeMul?: number;
  /** 몸통+손잡이 */
  cCup?: string;
  /** 담긴 커피 */
  cCoffee?: string;
  outline?: OutlineValues | null;
}

export default function Mug({
  pos = [0, 0],
  rot = 0,
  y = 2.0,
  scale = 1,
  sizeMul = 1,
  cCup = "#e8e6e2",
  cCoffee = "#3b2417",
  outline,
}: MugProps) {
  const [x, z] = pos;
  const { scene } = useGLTF("/models/mug.glb");
  const model = useMemo(() => {
    // 캐시된 GLB 를 그대로 고치면 머그가 다 같이 바뀐다.
    const cloned = scene.clone(true);
    cloned.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const isCoffee = (object.name || "").toLowerCase().includes("coffee");
      object.material = new THREE.MeshToonMaterial({
        color: isCoffee ? cCoffee : cCup,
        gradientMap: TOON_GRADIENT,
      });
      object.castShadow = true;
      object.receiveShadow = true;
    });
    return cloned;
  }, [scene, cCup, cCoffee]);
  const parts = useMemo(() => splitGltf(model), [model]);
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={MUG_SCALE * scale * sizeMul}>
      <GltfPartMeshes parts={parts} outline={outline} />
    </group>
  );
}
