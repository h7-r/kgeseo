import { useGLTF } from "@react-three/drei";

import type { OutlineValues } from "@/engine/toon";

import { GltfParts, useToonParts } from "./gltfParts";

// 가로폭 1.0 · 밑면 y 0 · 중앙 정렬 · 낮은 앞턱이 +Z 로 정규화한 모델.
useGLTF.preload("/models/keyboard.glb");

interface KeyboardProps {
  /** [x, z] */
  pos?: [number, number];
  y?: number;
  rot?: number;
  /** 월드 유닛 가로폭(모델 폭이 1.0) */
  size?: number;
  /** 가로폭 대비 두께 배수 */
  thickness?: number;
  /** 가로폭 대비 깊이 배수 */
  depth?: number;
  color?: string;
  outline?: OutlineValues | null;
}

/** 들 수 있는 키보드. 스스로 월드 좌표를 가져야 내려놓은 뒤에도 자리가 남는다. */
export default function Keyboard({
  pos = [0, 0],
  y = 0,
  rot = 0,
  size = 1.55,
  thickness = 0.5,
  depth = 0.83,
  color = "#2c2f34",
  outline,
}: KeyboardProps) {
  const [x, z] = pos;
  const parts = useToonParts("/models/keyboard.glb", color);
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={[size, size * thickness, size * depth]}>
      <GltfParts parts={parts} outline={outline} />
    </group>
  );
}
