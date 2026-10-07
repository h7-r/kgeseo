import { useEffect, useState } from "react";

import { PLAYER_RADIUS } from "@/engine/movement/constants";

import { dynamicColliders, STATIC_COLLIDERS, type ColliderBox } from "./collision";

interface ColliderDebugViewProps {
  visible?: boolean;
  height?: number;
}

/**
 * 막고 있는 영역을 빨간 상자로 그린다. hit() 이 플레이어 반지름을 더하므로 같은 만큼 부풀려야
 * 화면이 실제로 못 들어가는 범위와 맞는다.
 */
export default function ColliderDebugView({ visible = false, height = 4 }: ColliderDebugViewProps) {
  const [boxes, setBoxes] = useState<ColliderBox[]>([]);
  useEffect(() => {
    if (!visible) return;
    const refresh = () => setBoxes([...STATIC_COLLIDERS, ...dynamicColliders.values()].map((c) => ({ ...c })));
    refresh();
    const id = setInterval(refresh, 500); // 물건을 옮기면 따라오게
    return () => clearInterval(id);
  }, [visible]);
  if (!visible) return null;
  return (
    <group>
      {boxes.map((c, i) => {
        const w = c.maxX - c.minX + PLAYER_RADIUS * 2;
        const d = c.maxZ - c.minZ + PLAYER_RADIUS * 2;
        return (
          <mesh key={i} position={[(c.minX + c.maxX) / 2, height / 2, (c.minZ + c.maxZ) / 2]}>
            <boxGeometry args={[w, height, d]} />
            <meshBasicMaterial color="#ff3b30" wireframe transparent opacity={0.7} />
          </mesh>
        );
      })}
    </group>
  );
}
