import { useEffect, useMemo } from "react";

import { TOON_GRADIENT } from "@/engine/toon";

import { buildCorrosionGeometry, type BrightnessAt } from "./clutterGeometry";

const fullBrightness: BrightnessAt = () => 1;

interface CorridorCorrosionProps {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  floorY?: number;
  wallHeight?: number;
  floorCount?: number;
  wallCount?: number;
  crackCount?: number;
  size?: number;
  /** 방으로 통하는 구멍 자리 — 오른쪽 벽의 이 범위에는 안 붙인다 */
  doorZ?: number;
  doorWidth?: number;
  floorColor?: string;
  wallColor?: string;
  seed?: number;
  /** z 에 따른 깊이 감광. App 이 한 번만 만들어 넘기는 함수라 바뀌면 다시 굽는다 */
  brightness?: BrightnessAt;
}

/** 바닥·벽에 번진 녹과 물때. 벽·바닥 면 바로 위에 덧대는 얇은 판들이다. */
export default function CorridorCorrosion({
  x0,
  x1,
  z0,
  z1,
  floorY = 0.01,
  wallHeight = 8,
  floorCount = 16,
  wallCount = 26,
  crackCount = 8,
  size = 1,
  doorZ = -4,
  doorWidth = 4.4,
  floorColor = "#3a3d42",
  wallColor = "#525b69",
  seed = 4711,
  brightness = fullBrightness,
}: CorridorCorrosionProps) {
  const geometry = useMemo(
    () =>
      buildCorrosionGeometry({
        x0,
        x1,
        z0,
        z1,
        floorY,
        wallHeight,
        counts: { floor: floorCount, wall: wallCount, crack: crackCount },
        seed,
        brightness,
        floorColor,
        wallColor,
        doorZ,
        doorWidth,
        size,
      }),
    [
      x0,
      x1,
      z0,
      z1,
      floorY,
      wallHeight,
      floorCount,
      wallCount,
      crackCount,
      seed,
      brightness,
      floorColor,
      wallColor,
      doorZ,
      doorWidth,
      size,
    ],
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      {/* 면 바로 위에 겹쳐 그려 polygonOffset 이 없으면 깜빡인다. 얼룩에 테를 그으면 스티커가 돼 외곽선은 없다.
          불투명도가 진하면 복도 전체가 눌린 것처럼 어두워 보인다. */}
      <meshToonMaterial
        vertexColors
        color="#ffffff"
        gradientMap={TOON_GRADIENT}
        transparent
        opacity={0.62}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  );
}
