import { useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";

import { ToonOutline } from "@/engine/outline";
import { makeRandom } from "@/engine/random";
import { floorTexture } from "@/engine/textures/surfaces";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import RubbleStones, { type RubbleStone } from "@/station/train/RubbleStones";
import WallPiece from "@/station/train/WallPiece";
import { applySurfaceStains } from "@/station/vertexNoise";

import { corridorDepthBrightness } from "./corridorLighting";

interface SecretCorridorProps {
  /** 복도 바깥벽 */
  x0?: number;
  /** 방과 맞닿은 벽(= MIN_X) */
  x1?: number;
  z0?: number;
  z1?: number;
  /** 방(12)보다 낮게 — 사람이 다니라고 낸 좁은 통로 느낌 */
  height?: number;
  /** 밀리는 벽 칸 — 이 자리에는 안쪽벽을 안 세운다 */
  doorZ?: number;
  doorWidth?: number;
  /** 방 쪽 구멍과 같은 높이 */
  doorHeight?: number;
  wallColor?: string;
  baseboardColor?: string;
  floorColor?: string;
  ceilingColor?: string;
  wear?: number;
  floorSeed?: number;
  rubbleCount?: number;
  rubbleColor?: string;
  roughness?: number;
  /** 깊이 감광 세기(0 = 없음, 1 = 끝이 완전히 검정) */
  darkness?: number;
  /** 이 거리만큼 멀어지면 감광이 최대 */
  falloff?: number;
  minBrightness?: number;
  /** 벽 전체에 곱하는 배수. 조명을 더 켜면 셀 셰이딩이 깨지므로 정점색 배수로 벽만 올린다. */
  wallBrightness?: number;
  endDarkness?: number;
  endCurve?: number;
  darkBoundary?: number;
  darkFactor?: number;
  brightBoundary?: number;
  seed?: number;
  outline?: OutlineValues | null;
}

/** 비밀 복도 껍데기(바닥·천장·벽·잔해). 어둠은 빛을 더 놓지 않고 정점색으로 재질 밝기를 깎는다. */
export default function SecretCorridor({
  x0 = -26.5,
  x1 = -20,
  z0 = -12,
  z1 = 10,
  height = 8,
  doorZ = -4,
  doorWidth = 4.4,
  doorHeight: doorHeightInput = 7,
  wallColor = "#525b69",
  baseboardColor = "#4e5462",
  floorColor = "#3a3d42",
  ceilingColor = "#23262b",
  wear = 1.1,
  floorSeed = 340,
  rubbleCount = 14,
  rubbleColor = "#3b4048",
  roughness = 0.32,
  darkness = 0.6,
  falloff = 34,
  minBrightness = 0.45,
  wallBrightness = 1.3,
  endDarkness = 0.45,
  endCurve = 1.8,
  darkBoundary = -Infinity,
  darkFactor = 1,
  brightBoundary = -Infinity,
  seed = 88,
  outline,
}: SecretCorridorProps) {
  const width = x1 - x0;
  const length = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;

  const depthBrightness = useCallback(
    (z: number) =>
      corridorDepthBrightness(z, {
        doorZ,
        falloff,
        darkness,
        minBrightness,
        endDarkness,
        endCurve,
        z0,
        darkBoundary,
        darkFactor,
        brightBoundary,
      }) * wallBrightness,
    [
      doorZ,
      falloff,
      darkness,
      minBrightness,
      endDarkness,
      endCurve,
      z0,
      darkBoundary,
      darkFactor,
      brightBoundary,
      wallBrightness,
    ],
  );

  // 바깥벽 판은 +90° 회전이라 왼쪽 끝(로컬 −w/2)이 z1, 오른쪽 끝이 z0 이다.
  // 판 한 장을 가로로 분할해 칸마다 밝기를 준다 — 메시는 하나라 드로우콜이 늘지 않는다.
  const wallSegments = Math.max(4, Math.round(length / 7));
  const outerWallBrightness = useMemo(
    () => Array.from({ length: wallSegments + 1 }, (_, i) => depthBrightness(z1 - (length * i) / wallSegments)),
    [wallSegments, z1, length, depthBrightness],
  );

  const floorMap = floorTexture(floorSeed);
  const floorGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(
      width,
      length,
      Math.max(2, Math.round(width / 1.2)),
      Math.max(2, Math.round(length / 1.2)),
    );
    applySurfaceStains(g, floorSeed + 9, { count: 22, strength: 1.1 });
    // 얼룩 정점색에 곱해야 한다 — 덮어쓰면 얼룩이 사라진다.
    // 바닥판은 X축 −90° 로 눕혀 로컬 y 가 월드 z 의 반대다(월드z = cz − y).
    const position = g.attributes.position;
    const colors = g.attributes.color;
    for (let i = 0; i < position.count; i++) {
      const brightness = depthBrightness(cz - position.getY(i));
      if (colors)
        colors.setXYZ(i, colors.getX(i) * brightness, colors.getY(i) * brightness, colors.getZ(i) * brightness);
    }
    if (colors) colors.needsUpdate = true;
    return g;
  }, [width, length, floorSeed, cz, depthBrightness]);
  useEffect(() => () => floorGeometry.dispose(), [floorGeometry]);

  // 바닥 잔해 — 오래 안 쓴 통로라는 걸 말해 주는 단서
  const stones = useMemo(() => {
    const rnd = makeRandom(seed + 17);
    return Array.from({ length: rubbleCount }, (_, i): RubbleStone => ({
      x: x0 + 0.6 + rnd() * (width - 1.2),
      z: z0 + rnd() * length,
      y: 0.12 + rnd() * 0.3,
      scale: 0.25 + rnd() * 0.9,
      rotation: [rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI],
      brightness: 0.75 + rnd() * 0.5,
      seed: seed * 131 + i,
    }));
  }, [rubbleCount, x0, z0, width, length, seed]);

  const doorLeft = doorZ - doorWidth / 2;
  const doorRight = doorZ + doorWidth / 2;
  // 방 쪽 구멍과 같은 높이여야 문틀이 안 어긋난다. 복도 천장보다는 낮아야 한다.
  const doorHeight = Math.min(height - 0.6, doorHeightInput);

  const innerSegments = [
    { width: doorLeft - z0, center: (z0 + doorLeft) / 2 },
    { width: z1 - doorRight, center: (doorRight + z1) / 2 },
  ];

  const endWalls: [number, number][] = [
    [z0, 0],
    [z1, Math.PI],
  ];

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.01, cz]} geometry={floorGeometry} receiveShadow>
        <meshToonMaterial color={floorColor} map={floorMap} gradientMap={TOON_GRADIENT} vertexColors />
      </mesh>

      {/* 낮고 어두운 천장 — 거의 안 보여 질감 없이 색만 */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[cx, height, cz]}>
        <planeGeometry args={[width, length]} />
        <meshToonMaterial color={ceilingColor} gradientMap={TOON_GRADIENT} />
      </mesh>

      {/* 바깥벽(x0) — 복도 안쪽을 향하도록 +90°. 위 본체 + 아래 굽. */}
      <group position={[x0, 0, cz]} rotation={[0, Math.PI / 2, 0]}>
        <WallPiece
          width={length}
          height={height - 3}
          x={0}
          y={(height + 3) / 2}
          color={wallColor}
          seed={seed + 21}
          wear={wear}
          segments={wallSegments}
          brightness={outerWallBrightness}
        />
        <WallPiece
          width={length}
          height={3}
          x={0}
          y={1.5}
          color={baseboardColor}
          seed={seed + 21}
          wear={wear}
          segments={wallSegments}
          brightness={outerWallBrightness}
        />
      </group>

      {/* 양 끝벽 */}
      {endWalls.map(([endZ, rotationY], i) => (
        <group key={`end${i}`} position={[cx, 0, endZ]} rotation={[0, rotationY, 0]}>
          <WallPiece
            width={width}
            height={height - 3}
            x={0}
            y={(height + 3) / 2}
            color={wallColor}
            seed={seed + 21}
            wear={wear}
            brightness={[depthBrightness(endZ), depthBrightness(endZ)]}
          />
          <WallPiece
            width={width}
            height={3}
            x={0}
            y={1.5}
            color={baseboardColor}
            seed={seed + 21}
            wear={wear}
            brightness={[depthBrightness(endZ), depthBrightness(endZ)]}
          />
        </group>
      ))}

      {/* 안쪽벽(x1, 방 쪽) — −90° 회전이라 로컬 +X = 월드 +Z, 로컬x = 월드z − cz. 문 자리만 비운다. */}
      <group position={[x1, 0, cz]} rotation={[0, -Math.PI / 2, 0]}>
        {innerSegments.flatMap((segment, i) =>
          segment.width > 0.05
            ? [
                <WallPiece
                  key={`in${i}a`}
                  width={segment.width}
                  height={height - 3}
                  x={segment.center - cz}
                  y={(height + 3) / 2}
                  color={wallColor}
                  seed={seed + 21}
                  wear={wear}
                  brightness={[
                    depthBrightness(segment.center - segment.width / 2),
                    depthBrightness(segment.center + segment.width / 2),
                  ]}
                  flipU
                />,
                <WallPiece
                  key={`in${i}b`}
                  width={segment.width}
                  height={3}
                  x={segment.center - cz}
                  y={1.5}
                  color={baseboardColor}
                  seed={seed + 21}
                  wear={wear}
                  brightness={[
                    depthBrightness(segment.center - segment.width / 2),
                    depthBrightness(segment.center + segment.width / 2),
                  ]}
                  flipU
                />,
              ]
            : [],
        )}
        {/* 문 위 인방 */}
        {height - doorHeight > 0.05 && (
          <WallPiece
            width={doorWidth}
            height={height - doorHeight}
            x={doorZ - cz}
            y={(height + doorHeight) / 2}
            color={wallColor}
            seed={seed + 22}
            wear={wear}
            brightness={[depthBrightness(doorZ), depthBrightness(doorZ)]}
            flipU
          />
        )}
      </group>

      <RubbleStones
        stones={stones}
        roughness={roughness}
        color={rubbleColor}
        flatten={0.55}
        depth={0.8}
        outline={() => <ToonOutline outline={outline} />}
      />
    </group>
  );
}
