import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { buildMergedBoxes, type BoxPiece } from "@/engine/geometry";
import { createRandom } from "@/engine/random";
import { CEILING_TEXTURE_SIZE, makeCeilingTexture, makeFloorTexture } from "@/engine/textures/surfaces";
import { TOON_GRADIENT } from "@/engine/toon";
import { applySurfaceStains } from "@/station/vertexNoise";

import WallPiece from "./WallPiece";

interface PlatformExtensionProps {
  /** 기존 방이 끝나는 x */
  startX?: number;
  /** 새로 세울 먼 벽 x */
  endX?: number;
  z0?: number;
  z1?: number;
  height?: number;
  hasFarWall?: boolean;
  hasCeiling?: boolean;
  hasFloor?: boolean;
  floorY?: number;
  floorColor?: string;
  floorSeed?: number;
  floorStain?: number;
  wallColor?: string;
  baseColor?: string;
  ceilingColor?: string;
  ceilingSeed?: number;
  ceilingWear?: number;
  /** 천장 마감판 한 장 크기 */
  tileSize?: number;
  /** 떨어져 나간 판의 비율 */
  collapse?: number;
  /** 떨어지기 직전 처진 판의 비율 */
  sag?: number;
  /** 뚫린 자리로 보이는 철골 격자 */
  hasFrame?: boolean;
  frameSpacing?: number;
  frameThickness?: number;
  frameColor?: string;
  /** 구멍 가장자리에 매달린 마감판 */
  hasHangingPanels?: boolean;
  /** 환기 덕트 + 배관 다발 */
  hasUtilities?: boolean;
  ductWidth?: number;
  ductHeight?: number;
  /** 시작x~끝x 사이 어디에 걸지(0=방 쪽, 1=먼 벽 쪽) */
  ductPlacement?: number;
  ductDrop?: number;
  jointSpacing?: number;
  pipeCount?: number;
  pipePlacement?: number;
  pipeDrop?: number;
  pipeRadius?: number;
  pipeSpacing?: number;
  hangerSpacing?: number;
  ductColor?: string;
  pipeColor?: string;
  /** 벗겨진 단열재 — 누렇게 삭은 색 */
  insulationColor?: string;
  wear?: number;
  seed?: number;
}

interface CeilingHole {
  x: number;
  z: number;
  tx: number;
  tz: number;
  t: number;
}

/** length 를 spacing 언저리 간격으로 고르게 나눈 z 좌표들(덕트 이음매·행거) */
function computeEvenlySpacedZ(length: number, spacing: number, centerZ: number): number[] {
  const count = Math.max(1, Math.round(length / spacing));
  const step = length / count;
  return Array.from({ length: count }, (_, i) => centerZ - length / 2 + step / 2 + i * step);
}

/**
 * 기차 저편을 같은 공간으로 잇는다. 어두운 판으로 가리는 대신 벽·천장을 이어 붙여
 * "기차가 들어와 선 큰 홀" 하나로 만든다.
 */
export default function PlatformExtension({
  startX = 16,
  endX = 27,
  z0 = -14,
  z1 = 12,
  height = 12,
  hasFarWall = true,
  hasCeiling = true,
  hasFloor = true,
  floorY = -0.72,
  floorColor = "#3A3D42",
  floorSeed = 340,
  floorStain = 0.9,
  wallColor = "#525b69",
  baseColor = "#4e5462",
  ceilingColor = "#5a5f69",
  ceilingSeed = 12,
  ceilingWear = 0.7,
  tileSize = 2.5,
  collapse = 0.22,
  sag = 0.14,
  hasFrame = true,
  frameSpacing = 1.6,
  frameThickness = 0.13,
  frameColor = "#171b21",
  hasHangingPanels = true,
  hasUtilities = true,
  ductWidth = 1.6,
  ductHeight = 1.05,
  ductPlacement = 0.32,
  ductDrop = 0.95,
  jointSpacing = 6,
  pipeCount = 4,
  pipePlacement = 0.62,
  pipeDrop = 0.75,
  pipeRadius = 0.2,
  pipeSpacing = 0.55,
  hangerSpacing = 5,
  ductColor = "#242931",
  pipeColor = "#1b1f25",
  insulationColor = "#4a4536",
  wear = 0.7,
  seed = 21,
}: PlatformExtensionProps) {
  const depth = z1 - z0;
  const centerZ = (z0 + z1) / 2;
  const floorWidth = endX - startX + 8; // 방 안쪽으로도 물려 틈이 안 보이게
  const ceilingWidth = endX - startX;

  // 판 한 장으로는 구멍을 못 뚫어 마감판 격자로 쪼개고 일부는 빼고 일부는 처지게 한다.
  // 월드 좌표로 직접 짜서 판마다 네 귀퉁이 높이를 따로 준다. UV 를 월드 좌표로 잡아 무늬가 이어진다.
  const ceilingMap = makeCeilingTexture(ceilingSeed, ceilingWear);
  const { ceilingGeometry, holes } = useMemo(() => {
    const rnd = createRandom(ceilingSeed + 5);
    const nx = Math.max(1, Math.round(ceilingWidth / tileSize));
    const nz = Math.max(1, Math.round(depth / tileSize));
    const tx = ceilingWidth / nx;
    const tz = depth / nz;
    const zStart = centerZ - depth / 2;
    const positions: number[] = [];
    const uvs: number[] = [];
    const holes: CeilingHole[] = [];

    const vertex = (vx: number, vy: number, vz: number) => {
      positions.push(vx, vy, vz);
      uvs.push(vx / CEILING_TEXTURE_SIZE, vz / CEILING_TEXTURE_SIZE);
    };

    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x0 = startX + i * tx;
        const x1 = x0 + tx;
        const za = zStart + j * tz;
        const zb = za + tz;
        const r = rnd();
        if (r < collapse) {
          holes.push({ x: (x0 + x1) / 2, z: (za + zb) / 2, tx, tz, t: rnd() });
          continue;
        }
        const sagAmount = r < collapse + sag ? 0.35 + rnd() * 0.8 : 0;
        const cornerY = () => height - sagAmount * (0.25 + rnd() * 0.75);
        const c00 = cornerY();
        const c10 = cornerY();
        const c11 = cornerY();
        const c01 = cornerY();
        // 재질이 DoubleSide 라 감는 방향은 상관없다
        vertex(x0, c00, za);
        vertex(x1, c10, za);
        vertex(x1, c11, zb);
        vertex(x0, c00, za);
        vertex(x1, c11, zb);
        vertex(x0, c01, zb);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return { ceilingGeometry: geometry, holes };
  }, [ceilingWidth, depth, startX, centerZ, height, tileSize, collapse, sag, ceilingSeed]);
  useEffect(() => () => ceilingGeometry.dispose(), [ceilingGeometry]);

  // 천장 위에 깔아 두면 판이 떨어져 나간 자리에서만 드러난다.
  const frameXs = useMemo(() => {
    const count = Math.max(1, Math.round(ceilingWidth / frameSpacing));
    return Array.from({ length: count }, (_, i) => startX + (ceilingWidth / count) * (i + 0.5));
  }, [ceilingWidth, startX, frameSpacing]);
  const frameZs = useMemo(() => {
    const count = Math.max(1, Math.round(depth / (frameSpacing * 2.2)));
    return Array.from({ length: count }, (_, i) => centerZ - depth / 2 + (depth / count) * (i + 0.5));
  }, [depth, centerZ, frameSpacing]);

  // 덕트·배관은 기차와 나란히(z) 지나가야 시선을 안 끊는다. 양끝은 화면 밖으로 뺀다.
  const ductX = startX + ceilingWidth * ductPlacement;
  const pipeX = startX + ceilingWidth * pipePlacement;
  const utilityLength = depth + 6;

  const joints = useMemo(
    () => computeEvenlySpacedZ(utilityLength, jointSpacing, centerZ),
    [utilityLength, jointSpacing, centerZ],
  );
  const hangers = useMemo(
    () => computeEvenlySpacedZ(utilityLength, hangerSpacing, centerZ),
    [utilityLength, hangerSpacing, centerZ],
  );

  // 철골과 행거는 전부 색 하나짜리 가는 막대라 한 덩어리로 합쳐 드로우콜을 줄인다.
  const frameGeometry = useMemo(() => {
    if (!hasFrame) return null;
    return buildMergedBoxes([
      ...frameXs.map((gx): BoxPiece => ({
        size: [frameThickness, frameThickness * 2.4, depth],
        position: [gx, 0, centerZ],
      })),
      ...frameZs.map((gz): BoxPiece => ({
        size: [ceilingWidth, frameThickness, frameThickness * 2],
        position: [(startX + endX) / 2, frameThickness * 1.4, gz],
      })),
    ]);
  }, [hasFrame, frameXs, frameZs, frameThickness, depth, ceilingWidth, startX, endX, centerZ]);

  const hangerGeometry = useMemo(() => {
    if (!hasUtilities) return null;
    return buildMergedBoxes(
      hangers.flatMap((hz): BoxPiece[] => [
        { size: [0.1, ductDrop, 0.1], position: [ductX, height - ductDrop / 2, hz] },
        // 배관 다발은 가로 받침대 하나로 통째로 건다
        {
          size: [pipeSpacing * pipeCount + 0.5, 0.12, 0.12],
          position: [pipeX, height - pipeDrop - 0.18, hz],
        },
        { size: [0.09, pipeDrop, 0.09], position: [pipeX, height - pipeDrop / 2, hz] },
      ]),
    );
  }, [hasUtilities, hangers, ductX, pipeX, height, ductDrop, pipeDrop, pipeSpacing, pipeCount]);

  useEffect(
    () => () => {
      frameGeometry?.dispose();
      hangerGeometry?.dispose();
    },
    [frameGeometry, hangerGeometry],
  );

  // 굵기를 조금씩 달리해야 다발로 보인다 — 다 같으면 빗살무늬가 된다.
  const pipes = useMemo(() => {
    const rnd = createRandom(seed + 41);
    return Array.from({ length: pipeCount }, (_, i) => ({
      x: pipeX + (i - (pipeCount - 1) / 2) * pipeSpacing,
      r: pipeRadius * (0.6 + rnd() * 0.8),
      dy: (rnd() - 0.5) * 0.25,
    }));
  }, [pipeCount, pipeX, pipeSpacing, pipeRadius, seed]);

  const peeledInsulation = useMemo(() => {
    const rnd = createRandom(seed + 77);
    return Array.from({ length: 5 }, () => ({
      pipe: Math.floor(rnd() * pipeCount),
      z: centerZ + (rnd() - 0.5) * utilityLength * 0.9,
      length: 1.2 + rnd() * 3.5,
    }));
  }, [pipeCount, utilityLength, centerZ, seed]);

  // 방 바닥과 같은 방식(텍스처 + 정점 얼룩). 면을 잘게 나눠야 정점 얼룩이 먹는다.
  const floorMap = makeFloorTexture(floorSeed);
  const floorGeometry = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(floorWidth, depth, Math.round(floorWidth / 1.5), Math.round(depth / 1.5));
    applySurfaceStains(geometry, floorSeed + 7, { count: 26, strength: floorStain });
    return geometry;
  }, [floorWidth, depth, floorSeed, floorStain]);
  useEffect(() => () => floorGeometry.dispose(), [floorGeometry]);

  return (
    <>
      {hasFloor && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[startX + floorWidth / 2 - 4, floorY, centerZ]}
          geometry={floorGeometry}
          receiveShadow
        >
          <meshToonMaterial color={floorColor} map={floorMap} gradientMap={TOON_GRADIENT} vertexColors />
        </mesh>
      )}

      <group position={[endX, 0, centerZ]} rotation={[0, -Math.PI / 2, 0]} visible={hasFarWall}>
        <WallPiece
          width={depth}
          height={height - 4}
          x={0}
          y={(height + 4) / 2}
          color={wallColor}
          seed={seed}
          wear={wear}
        />
        <WallPiece width={depth} height={4} x={0} y={2} color={baseColor} seed={seed} wear={wear} />
      </group>

      {/* 방 천장과 같은 텍스처에 색만 어둡게 — 경계가 재질 차이가 아니라 밝기 차이로 읽힌다 */}
      {hasCeiling && (
        <>
          {/* 철골이 없으면 떨어져 나간 자리가 그냥 검은 사각형으로 보인다 */}
          {hasFrame && frameGeometry && (
            <group position={[0, height + 0.55, 0]}>
              <mesh geometry={frameGeometry}>
                <meshToonMaterial color={frameColor} gradientMap={TOON_GRADIENT} />
              </mesh>
            </group>
          )}

          <mesh geometry={ceilingGeometry} receiveShadow>
            <meshToonMaterial
              color={ceilingColor}
              map={ceilingMap}
              gradientMap={TOON_GRADIENT}
              side={THREE.DoubleSide}
            />
          </mesh>

          {/* 떨어지다 만 마감판 몇 장이 "무너지는 중" 이라는 인상을 만든다 */}
          {hasHangingPanels &&
            holes
              .filter((_, i) => i % 4 === 0)
              .slice(0, 6)
              .map((hole, i) => (
                <mesh
                  key={`sag${i}`}
                  position={[hole.x + hole.tx * 0.3, height - 0.45 - hole.t * 0.6, hole.z + hole.tz * 0.2]}
                  rotation={[-1.05 - hole.t * 0.4, hole.t * 1.2, 0.25 - hole.t * 0.5]}
                >
                  <planeGeometry args={[hole.tx * 0.85, hole.tz * 0.8]} />
                  <meshToonMaterial
                    color={ceilingColor}
                    map={ceilingMap}
                    gradientMap={TOON_GRADIENT}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              ))}
        </>
      )}

      {/* 완전한 검정은 깊은 공간이 아니라 빈 구멍으로 읽힌다. 어둠 속에 형태가 지나가야 깊이가 생긴다 */}
      {hasUtilities && (
        <group>
          <mesh position={[ductX, height - ductDrop, centerZ]}>
            <boxGeometry args={[ductWidth, ductHeight, utilityLength]} />
            <meshToonMaterial color={ductColor} gradientMap={TOON_GRADIENT} />
          </mesh>
          {/* 밋밋한 긴 상자를 덕트로 읽히게 하는 건 이음매 테다 */}
          {joints.map((jz, i) => (
            <mesh key={`joint${i}`} position={[ductX, height - ductDrop, jz]}>
              <boxGeometry args={[ductWidth * 1.12, ductHeight * 1.12, 0.22]} />
              <meshToonMaterial color={ductColor} gradientMap={TOON_GRADIENT} />
            </mesh>
          ))}

          {pipes.map((pipe, i) => (
            <mesh
              key={`pipe${i}`}
              position={[pipe.x, height - pipeDrop + pipe.dy, centerZ]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              {/* 어두운 실루엣이라 면 8개면 각져도 안 보인다 */}
              <cylinderGeometry args={[pipe.r, pipe.r, utilityLength, 8]} />
              <meshToonMaterial color={pipeColor} gradientMap={TOON_GRADIENT} />
            </mesh>
          ))}

          {peeledInsulation.map((piece, i) => {
            const pipe = pipes[piece.pipe];
            if (!pipe) return null;
            return (
              <mesh
                key={`ins${i}`}
                position={[pipe.x, height - pipeDrop + pipe.dy, piece.z]}
                rotation={[Math.PI / 2, 0, 0]}
              >
                <cylinderGeometry args={[pipe.r * 1.45, pipe.r * 1.45, piece.length, 8]} />
                <meshToonMaterial color={insulationColor} gradientMap={TOON_GRADIENT} flatShading />
              </mesh>
            );
          })}

          {/* 행거가 없으면 덕트도 배관도 허공에 떠 보인다 */}
          {hangerGeometry && (
            <mesh geometry={hangerGeometry}>
              <meshToonMaterial color={pipeColor} gradientMap={TOON_GRADIENT} />
            </mesh>
          )}
        </group>
      )}
    </>
  );
}
