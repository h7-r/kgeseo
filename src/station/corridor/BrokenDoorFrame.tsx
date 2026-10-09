import { useMemo } from "react";
import { Outlines } from "@react-three/drei";

import { createRandom } from "@/engine/random";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import RubbleStones, { type RubbleStone } from "@/station/train/RubbleStones";
import { buildStoneGeometry } from "@/station/train/stoneGeometry";

interface EdgeChunk {
  y: number;
  z: number;
  size: number;
  seed: number;
}

interface BrokenDoorFrameProps {
  /** 벽면 x */
  x?: number;
  doorZ?: number;
  doorWidth?: number;
  doorHeight?: number;
  /** 벽 두께 — 이만큼이 구멍 안쪽에 드러난다 */
  thickness?: number;
  wallColor?: string;
  /** 개구부 안쪽면은 빛이 잘 안 들어 더 어둡다 */
  revealColor?: string;
  rubbleColor?: string;
  roughness?: number;
  /** false 면 깨끗하게 뚫린 구멍만 남는다 */
  showRubble?: boolean;
  seed?: number;
  outline?: OutlineValues | null;
}

/**
 * 방↔복도 구멍 테두리. 뚫렸다고 읽히려면 벽에 진짜 구멍(벽 쪽에서 판을 쪼갠다),
 * 구멍 안쪽 두께(리빌), 찢어진 테두리가 있어야 한다. 리빌이 없으면 종이에 뚫은 구멍처럼 보인다.
 */
export default function BrokenDoorFrame({
  x = -20,
  doorZ = -4,
  doorWidth = 4.4,
  doorHeight = 7,
  thickness = 0.7,
  wallColor = "#4a5058",
  revealColor = "#2a2e34",
  rubbleColor = "#3b4048",
  roughness = 0.32,
  showRubble = true,
  seed = 77,
  outline,
}: BrokenDoorFrameProps) {
  const layout = useMemo(() => {
    const rnd = createRandom(seed + 909);
    // 찢어진 테두리 — 위·좌·우만. 바닥 쪽은 잔해가 쌓이니 따로 안 한다.
    const edges: EdgeChunk[] = [];
    const place = (count: number, make: (r: () => number, i: number) => EdgeChunk) => {
      for (let i = 0; i < count; i++) edges.push(make(rnd, i));
    };
    place(7, (r, i) => ({
      y: doorHeight + (r() - 0.5) * 0.5,
      z: doorZ - doorWidth / 2 + (doorWidth / 6) * i + (r() - 0.5) * 0.4,
      size: 0.5 + r() * 1.1,
      seed: seed * 31 + i,
    }));
    place(5, (r, i) => ({
      y: 1.2 + (doorHeight / 5) * i + (r() - 0.5) * 0.6,
      z: doorZ - doorWidth / 2 + (r() - 0.5) * 0.5,
      size: 0.45 + r() * 1.0,
      seed: seed * 53 + i,
    }));
    place(5, (r, i) => ({
      y: 1.2 + (doorHeight / 5) * i + (r() - 0.5) * 0.6,
      z: doorZ + doorWidth / 2 + (r() - 0.5) * 0.5,
      size: 0.45 + r() * 1.0,
      seed: seed * 71 + i,
    }));
    // 양쪽 바닥으로 흘러내린 잔해(방 쪽 +x, 복도 쪽 −x)
    const spill: RubbleStone[] = [];
    for (const side of [1, -1])
      for (let i = 0; i < 7; i++) {
        const d = rnd();
        spill.push({
          x: x + side * (0.5 + d * 2.6),
          z: doorZ + (rnd() - 0.5) * (doorWidth + 1.5),
          y: 0.15 + rnd() * 0.3,
          scale: (0.35 + rnd() * 1.0) * (1 - d * 0.4),
          rotation: [rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI],
          brightness: 0.75 + rnd() * 0.5,
          seed: seed * 97 + side * 13 + i,
        });
      }
    return { edges, spill };
  }, [x, doorZ, doorWidth, doorHeight, seed]);

  const outlineNode = outline?.outline ? (
    <Outlines thickness={outline.outlineWidth} color={outline.outlineColor} />
  ) : null;

  return (
    <group>
      {/* 리빌 — 개구부 안쪽면 3장(위·좌·우) */}
      <mesh position={[x, doorHeight - 0.06, doorZ]}>
        <boxGeometry args={[thickness, 0.12, doorWidth]} />
        <meshToonMaterial color={revealColor} gradientMap={TOON_GRADIENT} />
      </mesh>
      {[-1, 1].map((sz) => (
        <mesh key={`jamb${sz}`} position={[x, doorHeight / 2, doorZ + (sz * doorWidth) / 2]}>
          <boxGeometry args={[thickness, doorHeight, 0.12]} />
          <meshToonMaterial color={revealColor} gradientMap={TOON_GRADIENT} />
        </mesh>
      ))}

      {/* 벽과 같은 색이어야 벽이 찢어진 것으로 읽힌다. 잔해색이면 벽 앞에 놓인 돌이 된다. */}
      {showRubble &&
        layout.edges.map((edge, i) => (
          <mesh
            key={`edge${i}`}
            geometry={buildStoneGeometry(edge.seed, roughness * 0.7)}
            position={[x, edge.y, edge.z]}
            rotation={[edge.seed * 0.7, edge.seed * 1.3, edge.seed * 0.4]}
            scale={[thickness * 1.3, edge.size, edge.size * 0.9]}
            castShadow
          >
            <meshToonMaterial color={wallColor} gradientMap={TOON_GRADIENT} flatShading />
            {outlineNode}
          </mesh>
        ))}

      {/* 발치 잔해는 벽에 속한 것이라 밀리는 벽이 열려도 남는다 */}
      {showRubble && (
        <RubbleStones
          stones={layout.spill}
          roughness={roughness}
          color={rubbleColor}
          flatten={0.55}
          depth={0.8}
          outline={outlineNode}
        />
      )}
    </group>
  );
}
