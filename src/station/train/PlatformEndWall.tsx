import { useMemo } from "react";

import { makeRandom } from "@/engine/random";
import type { OutlineValues } from "@/engine/toon";

import { RubbleStones, type RubbleStone } from "./rubble";
import ShellOutline from "./ShellOutline";
import WallPiece from "./WallPiece";

interface PlatformEndWallProps {
  z?: number;
  flipped?: boolean;
  startX?: number;
  endX?: number;
  height?: number;
  /** 기차가 지나가는 x 범위(기차 크기에서 계산해 넘긴다) */
  holeX0?: number;
  holeX1?: number;
  holeHeight?: number;
  /** 세로 막대 개수. 많을수록 테두리가 곱게 갈라진다 */
  strips?: number;
  /** 구멍 테두리가 흔들리는 폭 */
  jaggedness?: number;
  wallColor?: string;
  baseColor?: string;
  wear?: number;
  rubbleColor?: string;
  roughness?: number;
  hasRubble?: boolean;
  seed?: number;
  outline?: OutlineValues | null;
}

interface WallSlice {
  key: string;
  h: number;
  y: number;
  color: string;
}

/**
 * 승강장 홀 앞·뒤 끝을 막되 기차가 지나간 자리는 뚫린 벽. 끝이 트여 검정으로 빠지지 않고
 * 기차가 어둠에서 뚫고 나온 그림이 된다. 세로 막대마다 벽이 시작하는 높이를 달리해 구멍을 낸다.
 */
export default function PlatformEndWall({
  z = -22,
  flipped = false,
  startX = 16,
  endX = 29.5,
  height = 12,
  holeX0 = 13,
  holeX1 = 22,
  holeHeight = 11,
  strips = 18,
  jaggedness = 1.8,
  wallColor = "#525b69",
  baseColor = "#4e5462",
  wear = 0.7,
  rubbleColor = "#3b4048",
  roughness = 0.34,
  hasRubble = true,
  seed = 51,
  outline,
}: PlatformEndWallProps) {
  const width = endX - startX;
  const { bars, stones } = useMemo(() => {
    const rnd = makeRandom(seed + 313);
    const w = width / strips;
    const bars = Array.from({ length: strips }, (_, i) => {
      const xc = startX + w * (i + 0.5);
      const isInside = xc > holeX0 && xc < holeX1;
      const edgeDistance = Math.min(Math.abs(xc - holeX0), Math.abs(xc - holeX1));
      let top = 0;
      if (isInside) {
        top = holeHeight + (rnd() - 0.5) * jaggedness;
      } else if (edgeDistance < jaggedness) {
        // 구멍 바로 옆도 조금씩 뜯겨야 경계가 매끈하지 않다
        top = ((jaggedness - edgeDistance) / jaggedness) * holeHeight * 0.55 * rnd();
      }
      return { xc, w, top: Math.max(0, Math.min(top, height - 0.3)) };
    });
    const stones: RubbleStone[] = Array.from({ length: 8 }, (_, i) => ({
      x: holeX0 + rnd() * (holeX1 - holeX0),
      z: z + (rnd() - 0.5) * 3.5,
      y: 0.2 + rnd() * 0.4,
      scale: 0.5 + rnd() * 1.4,
      rotation: [rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI],
      brightness: 0.8 + rnd() * 0.4,
      seed: seed * 91 + i,
    }));
    return { bars, stones };
  }, [width, strips, startX, holeX0, holeX1, holeHeight, jaggedness, height, z, seed]);

  const sign = flipped ? -1 : 1;

  return (
    <>
      <group position={[0, 0, z]} rotation={[0, flipped ? Math.PI : 0, 0]}>
        {bars.map((bar, i) => {
          // 아랫단(0~4)과 윗단을 나눠 칠한다 — 방 벽과 같은 배색
          const slices: WallSlice[] = [];
          if (bar.top < 4) {
            slices.push({ key: `lo${i}`, h: 4 - bar.top, y: (bar.top + 4) / 2, color: baseColor });
          }
          const upperStart = Math.max(bar.top, 4);
          if (upperStart < height) {
            slices.push({
              key: `hi${i}`,
              h: height - upperStart,
              y: (upperStart + height) / 2,
              color: wallColor,
            });
          }
          return slices.map((slice) => (
            <WallPiece
              key={slice.key}
              // 살짝 겹쳐야 막대 사이에 실금이 안 보인다
              width={bar.w * 1.02}
              height={slice.h}
              x={sign * bar.xc}
              y={slice.y}
              color={slice.color}
              seed={seed}
              wear={wear}
              flipU={flipped}
            />
          ));
        })}
      </group>

      {hasRubble && (
        <RubbleStones
          stones={stones}
          roughness={roughness}
          color={rubbleColor}
          outline={<ShellOutline outline={outline} />}
        />
      )}
    </>
  );
}
