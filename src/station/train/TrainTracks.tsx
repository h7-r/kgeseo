import { useEffect, useMemo } from "react";

import { buildMergedBoxes, type BoxPiece } from "@/engine/geometry";
import { createRandom } from "@/engine/random";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import ShellOutline from "./ShellOutline";

interface TrainTracksProps {
  /** [x, z] */
  position?: [number, number];
  /** 도상 윗면 높이. 레일 꼭대기가 방 바닥(y=0) 아래에 있어야 사무실 안으로 레일이 안 넘어온다 */
  y?: number;
  /** 기차와 달리 반듯하게 둔다 — 기차만 틀어져 있어야 밀려나 멈춘 그림이 된다 */
  rotation?: number;
  length?: number;
  width?: number;
  /** 레일 사이 간격. 표준궤 1,435mm ÷ 0.30m ≈ 4.8유닛 */
  gauge?: number;
  ballastColor?: string;
  sleeperColor?: string;
  railColor?: string;
  hasGravel?: boolean;
  seed?: number;
  outline?: OutlineValues | null;
}

function ToonColor({ color }: { color: string }) {
  return <meshToonMaterial color={color} gradientMap={TOON_GRADIENT} />;
}

/** 도상·침목·레일. 길이 방향이 로컬 X 라 기차와 같은 회전값을 주면 기차 밑에 나란히 깔린다. */
export default function TrainTracks({
  position = [18, -1],
  y = -0.62,
  rotation = Math.PI / 2,
  length = 90,
  width = 8,
  gauge = 4.8,
  ballastColor = "#2B2E33",
  sleeperColor = "#241F1B",
  railColor = "#666D77",
  hasGravel = true,
  seed = 7,
  outline,
}: TrainTracksProps) {
  const [x, z] = position;

  // 침목·자갈은 작은 상자가 수백 개라 드로우콜을 아끼려고 한 덩어리로 합친다.
  const sleeperGeometry = useMemo(() => {
    const rnd = createRandom(seed + 11);
    const spacing = 2.4;
    const count = Math.floor(length / spacing);
    return buildMergedBoxes(
      Array.from({ length: count }, (_, i): BoxPiece => {
        // 살짝 틀어진 침목 — 관리 안 된 폐선 느낌
        const offsetZ = (rnd() - 0.5) * 0.5;
        const turn = (rnd() - 0.5) * 0.06;
        const scale = 0.9 + rnd() * 0.2;
        return {
          size: [0.95, 0.24, (gauge + 2.2) * scale],
          position: [-length / 2 + i * spacing + spacing / 2, 0.12, offsetZ],
          rotation: [0, turn, 0],
        };
      }),
    );
  }, [length, gauge, seed]);

  const gravelGeometry = useMemo(() => {
    if (!hasGravel) return null;
    const rnd = createRandom(seed + 29);
    return buildMergedBoxes(
      Array.from({ length: 260 }, (): BoxPiece => {
        const gx = (rnd() - 0.5) * length;
        const gz = (rnd() - 0.5) * width * 0.98;
        const scale = 0.16 + rnd() * 0.3;
        const turn = rnd() * Math.PI;
        const tilt = rnd() * 0.5;
        return {
          size: [scale, scale * 0.7, scale],
          position: [gx, 0.02 + tilt * 0.1, gz],
          rotation: [tilt, turn, tilt * 0.7],
        };
      }),
    );
  }, [width, length, hasGravel, seed]);

  useEffect(
    () => () => {
      sleeperGeometry?.dispose();
      gravelGeometry?.dispose();
    },
    [sleeperGeometry, gravelGeometry],
  );

  return (
    <group position={[x, y, z]} rotation={[0, rotation, 0]}>
      <mesh position={[0, -0.45, 0]} receiveShadow>
        <boxGeometry args={[length, 0.9, width]} />
        <ToonColor color={ballastColor} />
      </mesh>

      {sleeperGeometry && (
        <mesh geometry={sleeperGeometry} receiveShadow castShadow>
          <ToonColor color={sleeperColor} />
          <ShellOutline outline={outline} />
        </mesh>
      )}

      {[-1, 1].map((side) => (
        <mesh key={`rail${side}`} position={[0, 0.38, (side * gauge) / 2]} castShadow>
          <boxGeometry args={[length, 0.3, 0.26]} />
          <ToonColor color={railColor} />
          <ShellOutline outline={outline} />
        </mesh>
      ))}

      {gravelGeometry && (
        <mesh geometry={gravelGeometry}>
          <ToonColor color={ballastColor} />
        </mesh>
      )}
    </group>
  );
}
