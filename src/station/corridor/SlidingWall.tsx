import { useMemo } from "react";
import { Outlines } from "@react-three/drei";

import { scaleColor } from "@/engine/color";
import { makeRandom } from "@/engine/random";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { stoneGeometry } from "@/station/train/stoneGeometry";

interface WallBlock {
  x: number;
  y: number;
  z: number;
  sy: number;
  sz: number;
  rotation: [number, number, number];
  brightness: number;
  seed: number;
}

interface SlidingWallProps {
  x?: number;
  doorZ?: number;
  doorWidth?: number;
  doorHeight?: number;
  thickness?: number;
  /** 0~1. 1 이면 문폭 + 여유만큼 옆으로 완전히 빠진다 */
  openness?: number;
  rubbleColor?: string;
  roughness?: number;
  seed?: number;
  outline?: OutlineValues | null;
}

/**
 * 구멍을 메우고 있는 위장 덩어리. 겉보기엔 무너져 메워진 자리고, 풀리면 통째로 옆으로 밀린다.
 * 작은 돌을 흩뿌리면 표면 장식처럼 보여서 큼직한 덩어리를 겹쳐 채운다.
 */
export default function SlidingWall({
  x = -20,
  doorZ = -4,
  doorWidth = 4.4,
  doorHeight = 7,
  thickness = 0.7,
  openness = 0,
  rubbleColor = "#3b4048",
  roughness = 0.32,
  seed = 77,
  outline,
}: SlidingWallProps) {
  const blocks = useMemo(() => {
    const rnd = makeRandom(seed + 5);
    const columns = 4,
      rows = 5;
    const out: WallBlock[] = [];
    for (let i = 0; i < columns; i++)
      for (let j = 0; j < rows; j++) {
        out.push({
          z: doorZ + (-0.5 + (i + 0.5) / columns) * doorWidth + (rnd() - 0.5) * 0.5,
          y: ((j + 0.5) / rows) * doorHeight + (rnd() - 0.5) * 0.5,
          x: (rnd() - 0.5) * thickness * 0.5,
          sz: (doorWidth / columns) * (1.1 + rnd() * 0.7),
          sy: (doorHeight / rows) * (1.1 + rnd() * 0.7),
          rotation: [rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI],
          brightness: 0.7 + rnd() * 0.55,
          seed: seed * 211 + i * 10 + j,
        });
      }
    return out;
  }, [doorZ, doorWidth, doorHeight, thickness, seed]);

  const outlineNode = outline?.outline ? (
    <Outlines thickness={outline.outlineWidth} color={outline.outlineColor} />
  ) : null;

  return (
    // 벽 뒤 주머니로 들어가는 미닫이. 문폭 + 0.6 만큼 빠져야 구멍이 완전히 드러난다.
    <group position={[x, 0, openness * (doorWidth + 0.6)]}>
      {/* 구멍을 실제로 막는 얇은 판. 벽 앞으로 튀어나오면 곧바로 판때기로 보인다. */}
      <mesh position={[0, doorHeight / 2, doorZ]} castShadow receiveShadow>
        <boxGeometry args={[thickness * 0.55, doorHeight - 0.1, doorWidth - 0.1]} />
        <meshToonMaterial color={scaleColor(rubbleColor, 0.6)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {blocks.map((block, i) => (
        <mesh
          key={`blk${i}`}
          geometry={stoneGeometry(block.seed, roughness)}
          position={[block.x, block.y, block.z]}
          rotation={block.rotation}
          scale={[thickness * 0.9, block.sy, block.sz]}
          castShadow
        >
          <meshToonMaterial color={scaleColor(rubbleColor, block.brightness)} gradientMap={TOON_GRADIENT} flatShading />
          {outlineNode}
        </mesh>
      ))}
    </group>
  );
}
