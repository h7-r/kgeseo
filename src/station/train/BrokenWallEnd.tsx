import { useEffect, useMemo } from "react";
import type * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { makeRandom } from "@/engine/random";
import { wallTexture } from "@/engine/textures/surfaces";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { RubbleStones, type RubbleStone } from "./rubble";
import ShellOutline from "./ShellOutline";
import { wallPieceGeometry } from "./wallPieceGeometry";

interface BrokenWallEndProps {
  /** 어느 벽인가 */
  z?: number;
  /** 뒷벽(+z)이면 판을 180° 돌린다 */
  flipped?: boolean;
  /** 단단한 벽이 끝나는 x */
  endX?: number;
  /** 찢어진 조각이 뻗을 수 있는 한계 x */
  limitX?: number;
  /** 기차 높이 언저리를 얼마나 더 파먹을지(0=고르게, 1=푹 파임) */
  centerCut?: number;
  seed?: number;
  height?: number;
  layers?: number;
  /** 층마다 끝이 들쭉날쭉한 정도(유닛) */
  jaggedness?: number;
  wallColor?: string;
  baseColor?: string;
  wear?: number;
  rubbleColor?: string;
  roughness?: number;
  outline?: OutlineValues | null;
}

interface Band {
  y: number;
  h: number;
  d: number;
}

function mergeAll(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!pieces.length) return null;
  if (pieces.length === 1) return pieces[0];
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((piece) => piece.dispose());
  return merged;
}

/**
 * 기차가 뚫고 지나간 벽의 끝. 돌덩이를 붙이면 "벽 옆에 놓인 바위"로 보여서,
 * 벽돌 무늬가 이어지는 판을 층마다 길이만 다르게 잘라 찢어진 단면을 만든다.
 */
export default function BrokenWallEnd({
  z = -14,
  flipped = false,
  endX = 15,
  limitX = 21,
  centerCut = 0.5,
  seed = 3,
  height = 12,
  layers = 16,
  jaggedness = 2.4,
  wallColor = "#525b69",
  baseColor = "#4e5462",
  wear = 0.7,
  rubbleColor = "#3B4048",
  roughness = 0.34,
  outline,
}: BrokenWallEndProps) {
  const { bands, rubble } = useMemo(() => {
    const rnd = makeRandom(seed + 101);
    const h = height / layers;
    // 기차가 지나간 높이(t≈0.45)가 가장 크게 헐렸으니 거기서 가장 짧게 되살린다.
    const bands: Band[] = Array.from({ length: layers }, (_, i) => {
      const t = (i + 0.5) / layers;
      const centerWeight = Math.max(0, 1 - Math.abs(t - 0.45) * 1.6);
      const d = jaggedness * (1 - centerWeight * centerCut) * (0.25 + rnd() * 0.75);
      // 한계가 끝보다 앞이면 되살릴 게 없다 — 음수 폭을 막는다
      return { y: (i + 0.5) * h, h, d: Math.max(0, Math.min(d, limitX - endX)) };
    });
    const rubble: RubbleStone[] = Array.from({ length: 6 }, (_, i) => {
      const distance = rnd();
      return {
        x: endX - 0.8 - distance * 4.5,
        z: z + (rnd() - 0.5) * 3.5,
        y: 0.18 + rnd() * 0.25,
        scale: (0.5 + rnd() * 1.0) * (1 - distance * 0.5),
        rotation: [rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI],
        brightness: 0.8 + rnd() * 0.4,
        seed: seed * 71 + i,
      };
    });
    return { bands, rubble };
  }, [seed, height, layers, jaggedness, endX, limitX, centerCut, z]);

  // 판이 층 수만큼 수십 장인데 색이 둘뿐이라 색끼리 합쳐 드로우콜을 줄인다. UV 는 판마다 구워져 있다.
  const bandGeometry = useMemo(() => {
    const lower: THREE.BufferGeometry[] = [];
    const upper: THREE.BufferGeometry[] = [];
    for (const band of bands) {
      if (band.d <= 0.05) continue; // 파먹힌 층은 기존 벽이 이미 있다
      const x = (flipped ? -1 : 1) * (endX + band.d / 2);
      const piece = wallPieceGeometry({
        width: band.d,
        height: band.h * 0.98,
        x,
        y: band.y,
        flipU: flipped,
      });
      piece.translate(x, band.y, 0);
      (band.y < 4 ? lower : upper).push(piece);
    }
    return { lower: mergeAll(lower), upper: mergeAll(upper) };
  }, [bands, endX, flipped]);
  useEffect(
    () => () => {
      bandGeometry.lower?.dispose();
      bandGeometry.upper?.dispose();
    },
    [bandGeometry],
  );
  const texture = wallTexture(seed, wear);

  return (
    <>
      <group position={[0, 0, z]} rotation={[0, flipped ? Math.PI : 0, 0]}>
        {(
          [
            ["lower", baseColor],
            ["upper", wallColor],
          ] as const
        ).map(([part, color]) => {
          const geometry = bandGeometry[part];
          return geometry ? (
            <mesh key={part} geometry={geometry} receiveShadow>
              <meshToonMaterial color={color} map={texture} gradientMap={TOON_GRADIENT} />
            </mesh>
          ) : null;
        })}
      </group>

      <RubbleStones
        stones={rubble}
        roughness={roughness}
        color={rubbleColor}
        outline={<ShellOutline outline={outline} />}
      />
    </>
  );
}
