import type { ReactNode } from "react";

import { scaleColor } from "@/engine/color";
import { TOON_GRADIENT } from "@/engine/toon";

import { stoneGeometry } from "./stoneGeometry";

/** 잔해 돌 하나의 배치 */
export interface RubbleStone {
  x: number;
  y: number;
  z: number;
  rotation: [number, number, number];
  scale: number;
  /** 색 밝기 배수 */
  brightness: number;
  /** 돌 모양 시드 */
  seed: number;
}

interface RubbleStonesProps {
  stones: RubbleStone[];
  roughness: number;
  color: string;
  /** 높이 배수 — 눌린 정도 */
  flatten?: number;
  /** 깊이 배수 */
  depth?: number;
  receiveShadow?: boolean;
  /** 돌마다 붙일 외곽선. 함수면 돌마다 새로 만든다 */
  outline?: ReactNode | (() => ReactNode);
}

/** 잔해 돌무더기. 벽·바닥·복도 끝 여러 곳이 같은 모양을 쓴다. */
export default function RubbleStones({
  stones,
  roughness,
  color,
  flatten = 0.6,
  depth = 0.85,
  receiveShadow = true,
  outline,
}: RubbleStonesProps) {
  return (
    <>
      {stones.map((stone, i) => (
        <mesh
          key={i}
          geometry={stoneGeometry(stone.seed, roughness)}
          position={[stone.x, stone.y, stone.z]}
          rotation={stone.rotation}
          scale={[stone.scale, stone.scale * flatten, stone.scale * depth]}
          castShadow
          receiveShadow={receiveShadow}
        >
          <meshToonMaterial color={scaleColor(color, stone.brightness)} gradientMap={TOON_GRADIENT} flatShading />
          {typeof outline === "function" ? outline() : outline}
        </mesh>
      ))}
    </>
  );
}
