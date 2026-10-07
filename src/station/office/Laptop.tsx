import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { GltfParts, splitGltf } from "./gltfParts";

// 5,819면으로 줄여 부위 5개로 자른 모델. 바닥이 y=0, 가로·세로 중앙이 원점.
useGLTF.preload("/models/laptop.glb");

/** GLB 안의 메시 이름 그대로 */
const LAPTOP_PARTS = ["screen", "bezel", "keys", "trackpad", "body"] as const;
type LaptopPart = (typeof LAPTOP_PARTS)[number];

interface LaptopProps {
  /** [x, z] */
  pos?: [number, number];
  rot?: number;
  /** 책상 윗면 */
  y?: number;
  /** 공통 × 개별 */
  scale?: number;
  /** 꺼진 화면 유리 */
  cScreen?: string;
  /** 화면 테두리·뒷판 */
  cBezel?: string;
  cKeys?: string;
  cTrackpad?: string;
  cBody?: string;
  /** 켜면 화면이 스스로 빛난다 */
  screenOn?: boolean;
  screenColor?: string;
  outline?: OutlineValues | null;
}

export default function Laptop({
  pos = [0, 0],
  rot = 0,
  y = 2.43,
  scale = 0.68,
  cScreen = "#10131a",
  cBezel = "#3a3f47",
  cKeys = "#24262c",
  cTrackpad = "#5a606a",
  cBody = "#787e8a",
  screenOn = true,
  screenColor = "#4f8fd6",
  outline,
}: LaptopProps) {
  const [x, z] = pos;
  const { scene } = useGLTF("/models/laptop.glb");

  const model = useMemo(() => {
    // 원본을 고치면 useGLTF 캐시가 오염돼 노트북이 다 같이 바뀐다.
    const cloned = scene.clone(true);
    const colors: Record<LaptopPart, string> = {
      screen: cScreen,
      bezel: cBezel,
      keys: cKeys,
      trackpad: cTrackpad,
      body: cBody,
    };
    cloned.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // 이름으로 부위를 찾고 못 찾으면 본체로 본다.
      const name = (object.name || "").toLowerCase();
      const part = LAPTOP_PARTS.find((key) => name.includes(key)) ?? "body";
      if (part === "screen" && screenOn) {
        // 조명을 안 받아 어둠 속에서도 밝다. toneMapped=false 라 밝기가 안 눌려 Bloom 이 확실히 걸린다.
        object.material = new THREE.MeshBasicMaterial({ color: screenColor, toneMapped: false });
      } else {
        object.material = new THREE.MeshToonMaterial({ color: colors[part], gradientMap: TOON_GRADIENT });
      }
      object.castShadow = true;
      object.receiveShadow = true;
    });
    return cloned;
  }, [scene, cScreen, cBezel, cKeys, cTrackpad, cBody, screenOn, screenColor]);
  const parts = useMemo(() => splitGltf(model), [model]);

  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={scale}>
      <GltfParts parts={parts} outline={outline} />
    </group>
  );
}
