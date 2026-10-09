import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";

import GltfPartMeshes from "@/engine/GltfPartMeshes";
import { useToonGltfParts } from "@/engine/gltfModel";
import type { OutlineValues } from "@/engine/toon";
import { computeSquareBox, useColliderBox } from "@/station/layout/collision";

// 모델 폭 1.27 · 높이 1.90 · 깊이 1.30, 밑면이 이미 y=0.
useGLTF.preload("/models/chair.glb");

/** 등받이(1.90 × 1.6 ≈ 3.05)가 책상 윗면(≈2.0)보다 조금 높게 오는 배율. 의자 끌기도 같은 값을 쓴다. */
export const CHAIR_SCALE = 1.6;

interface ChairProps {
  /** [x, z] */
  pos?: [number, number];
  rot?: number;
  y?: number;
  scale?: number;
  sizeMul?: number;
  color?: string;
  outline?: OutlineValues | null;
  /** 충돌 박스 이름 */
  name?: string;
  /** 끌고 가는 동안은 끈다 — 안 끄면 끌고 가는 의자에 내가 막힌다. */
  collidable?: boolean;
}

export default function Chair({
  pos = [0, 0],
  rot = 0,
  y = 0,
  scale = 1,
  sizeMul = 1,
  color = "#43474e",
  outline,
  name = "chair",
  collidable = true,
}: ChairProps) {
  const [x, z] = pos;

  // 긴 쪽 절반 0.65 × 실제 배율. 0.85 를 더 곱한 건 딱 맞추면 옆을 지날 때 걸리는 느낌이 나서다.
  // 플레이어 반지름은 isBlockedForPlayer() 안에서 따로 더해진다.
  const radius = 0.65 * CHAIR_SCALE * scale * sizeMul * 0.85;
  // 등받이 꼭대기까지
  const height = 1.9 * CHAIR_SCALE * scale * sizeMul;
  const box = useMemo(() => computeSquareBox(x, z, radius, height), [x, z, radius, height]);
  useColliderBox(name, box, collidable);

  const parts = useToonGltfParts("/models/chair.glb", color);
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={CHAIR_SCALE * scale * sizeMul}>
      <GltfPartMeshes parts={parts} outline={outline} />
    </group>
  );
}
