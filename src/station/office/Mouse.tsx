import { useGLTF } from "@react-three/drei";

import type { OutlineValues } from "@/engine/toon";

import { GltfParts, useToonParts } from "./gltfParts";

// 길이 1.0 · 밑면 y 0 · 중앙 정렬 · 휠·케이블 쪽이 +Z 로 정규화한 모델.
useGLTF.preload("/models/mouse.glb");

interface MouseProps {
  /** [x, z] */
  pos?: [number, number];
  y?: number;
  rot?: number;
  /** 월드 유닛 길이(모델 길이가 1.0) */
  size?: number;
  color?: string;
  outline?: OutlineValues | null;
}

/** 들 수 있는 마우스. */
export default function Mouse({ pos = [0, 0], y = 0, rot = 0, size = 0.37, color = "#2c2f34", outline }: MouseProps) {
  const [x, z] = pos;
  const parts = useToonParts("/models/mouse.glb", color);
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={size}>
      <GltfParts parts={parts} outline={outline} />
    </group>
  );
}
