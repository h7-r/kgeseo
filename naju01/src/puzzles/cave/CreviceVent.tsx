/**
 * 바위 틈 숨구멍 — 바닥에 구멍을 뚫지 않고, 서로 기댄 바위 둘(셋) 사이 틈에서 공기 방울이 새어 오른다.
 * 숨을 채우는 공기 기둥(AirColumn)을 틈 자리에 함께 세운다. 자리는 미터 — 배율(M)은 여기서 곱하므로 M 배 그룹 밖에 둔다
 */
import { useEffect, useMemo } from "react";

import { buildBakedRockPrototypes } from "../../models/nature";
import { makeToonMaterial } from "../materials";
import { M } from "../units";
import AirColumn from "./AirColumn";
import { normalizePrototype } from "./seabed";

interface Props {
  x: number;
  z: number;
  floor: number;
  /** 바위 덩치(미터) */
  size?: number;
  /** 바위가 기대 선 방향(라디안) — 틈이 이 축을 따라 난다 */
  yaw?: number;
  /** 숨이 차는 둘레(미터) */
  radius?: number;
  on?: boolean;
  count?: number;
  /** 거품 크기 배율 — 어두운 데선 키워야 숨구멍인 줄 안다 */
  bubbleScale?: number;
}

export default function CreviceVent({
  x,
  z,
  floor,
  size = 1,
  yaw = 0,
  radius = 0.7,
  on = true,
  count = 70,
  bubbleScale = 1,
}: Props) {
  const rocks = useMemo(() => {
    const prototypes = buildBakedRockPrototypes().map(normalizePrototype);
    const picked = [2, 5, 3].map((n) => prototypes[(n + Math.round(x * 7)) % prototypes.length].clone());
    prototypes.forEach((geometry) => geometry.dispose());
    return { picked, material: makeToonMaterial("#5E6B69", { vertexColors: true }) };
  }, [x]);
  useEffect(
    () => () => {
      rocks.picked.forEach((geometry) => geometry.dispose());
      rocks.material.dispose();
    },
    [rocks],
  );
  // 기댄 바위 둘이 위에서 맞닿고 아래로 갈라진다 — 틈은 손바닥 폭. 뒤에 작은 바위 하나가 틈 뒤를 막는다
  return (
    <>
      <group position={[x * M, floor * M, z * M]} rotation={[0, yaw, 0]} scale={size * M}>
        <mesh
          geometry={rocks.picked[0]}
          material={rocks.material}
          position={[-0.36, -0.06, 0]}
          rotation={[0, 0.6, -0.22]}
          scale={[0.62, 0.95, 0.7]}
          castShadow
          receiveShadow
        />
        <mesh
          geometry={rocks.picked[1]}
          material={rocks.material}
          position={[0.36, -0.06, 0.02]}
          rotation={[0, 2.1, 0.24]}
          scale={[0.6, 0.85, 0.66]}
          castShadow
          receiveShadow
        />
        <mesh
          geometry={rocks.picked[2]}
          material={rocks.material}
          position={[0, -0.08, 0.32]}
          rotation={[0, 1.2, 0]}
          scale={[0.5, 0.55, 0.45]}
          castShadow
          receiveShadow
        />
      </group>
      <AirColumn
        x={x}
        z={z}
        floor={floor + 0.12 * size}
        radius={radius}
        on={on}
        count={count}
        bubbleScale={bubbleScale}
      />
    </>
  );
}
