import { memo, useEffect, useMemo } from "react";
import * as THREE from "three";

import { CEIL_TEX, ceilingTexture, FLOOR_TEX, floorTexture } from "@/engine/textures/surfaces";
import { TOON_GRADIENT } from "@/engine/toon";
import { ROOM_CX, ROOM_CZ, ROOM_D, ROOM_H, ROOM_W } from "@/station/layout/dimensions";
import RoomShell, { Column, type StructureOutline } from "@/station/room/RoomShell";
import WallPanel from "@/station/room/WallPanel";
import { applySurfaceStains } from "@/station/vertexNoise";

import type { SurfaceValues } from "../controls/roomControls";

/** 왼쪽 벽 비밀 문 구멍 */
interface SecretDoor {
  z: number;
  width: number;
  height: number;
}

interface PanelSpec {
  width: number;
  offsetX: number;
  height: number;
  bottomY: number;
  color: string;
}

/**
 * 바닥·천장 판. 면을 잘게 나눠 정점 얼룩을 얹는다(텍스처 반복을 깨는 큰 얼룩).
 * UV 는 텍스처 한 장이 tileSize 유닛을 덮도록 늘린다.
 */
function stainedPlane(tileSize: number, seed: number, count: number, strength: number) {
  const geometry = new THREE.PlaneGeometry(ROOM_W, ROOM_D, Math.round(ROOM_W / 1.5), Math.round(ROOM_D / 1.5));
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setX(i, uv.getX(i) * (ROOM_W / tileSize));
    uv.setY(i, uv.getY(i) * (ROOM_D / tileSize));
  }
  applySurfaceStains(geometry, seed, { count, strength });
  return geometry;
}

/**
 * 벽 한 면을 판 목록으로. 구멍이 없으면 통짜 두 장(위 본체 + 아래 굽), 있으면 좌·우 조각 + 인방(문 위 남는 벽).
 * 구멍 앞에 문짝만 세우면 「벽에 기대 놓은 판때기」로 보인다 — 그 자리를 안 그려야 뚫린 것이 된다.
 */
function wallPanels(
  width: number,
  offsetX: number,
  hole: { x: number; width: number; height: number } | null,
  surface: SurfaceValues,
) {
  const panels: PanelSpec[] = [];
  const solid = (w: number, x: number) => {
    panels.push({ width: w, offsetX: x, height: 8, bottomY: 4, color: surface.wallColor });
    panels.push({ width: w, offsetX: x, height: 4, bottomY: 0, color: surface.wallBaseColor });
  };
  if (!hole) {
    solid(width, offsetX);
    return panels;
  }
  const left = -width / 2;
  const right = width / 2;
  const half = hole.width / 2;
  const leftWidth = hole.x - half - left;
  const rightWidth = right - (hole.x + half);
  if (leftWidth > 0.01) solid(leftWidth, left + leftWidth / 2);
  if (rightWidth > 0.01) solid(rightWidth, right - rightWidth / 2);
  const lintelHeight = ROOM_H - hole.height;
  if (lintelHeight > 0.01)
    panels.push({
      width: hole.width,
      offsetX: hole.x,
      height: lintelHeight,
      bottomY: hole.height,
      color: surface.wallColor,
    });
  return panels;
}

// 앞벽(z=-14) · 뒷벽(z=+12) · 왼쪽 벽. 오른쪽(+x)은 기차가 들어와 선 자리라 비운다.
const WALLS = [
  [0, -ROOM_D / 2, 0],
  [0, ROOM_D / 2, Math.PI],
  [-ROOM_W / 2, 0, Math.PI / 2],
] as const;

interface RoomStructureProps {
  surface: SurfaceValues;
  outline: StructureOutline;
  /** 비밀 복도가 보이면 왼쪽 벽에 구멍을 뚫는다 */
  door: SecretDoor | null;
  /** 앞·뒷벽이 끝나는 x(「부서진 벽 끝」) */
  frontWallEndX: number;
  backWallEndX: number;
}

/**
 * 방 껍데기 — 바닥·천장·벽·몰딩·기둥. 로비 상태(서랍·든 것)와 상관없이 Leva 값이 바뀔 때만 달라진다.
 * memo 로 감싸 서랍 한 칸 열 때 여러 번 오는 갱신에 이 가지를 통째로 건너뛰게 한다.
 */
function RoomStructure({ surface, outline, door, frontWallEndX, backWallEndX }: RoomStructureProps) {
  const floorMap = floorTexture(surface.floorSeed);
  const floorGeometry = useMemo(
    () => stainedPlane(FLOOR_TEX, surface.floorSeed, 24, surface.floorStain),
    [surface.floorSeed, surface.floorStain],
  );
  useEffect(() => () => floorGeometry.dispose(), [floorGeometry]);

  const ceilingMap = ceilingTexture(surface.ceilingSeed, surface.ceilingWear);
  const ceilingGeometry = useMemo(
    () => stainedPlane(CEIL_TEX, surface.ceilingSeed, 20, surface.ceilingStain),
    [surface.ceilingSeed, surface.ceilingStain],
  );
  useEffect(() => () => ceilingGeometry.dispose(), [ceilingGeometry]);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ROOM_CX, 0, ROOM_CZ]} geometry={floorGeometry} receiveShadow>
        <meshToonMaterial color={surface.floorColor} map={floorMap} gradientMap={TOON_GRADIENT} vertexColors />
      </mesh>

      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        position={[ROOM_CX, ROOM_H, ROOM_CZ]}
        geometry={ceilingGeometry}
        receiveShadow
      >
        {/* 빛과 상관없이 천장색으로 아주 약하게 스스로 빛나 「검게 죽는 것」만 막는다 */}
        <meshToonMaterial
          color={surface.ceilingColor}
          map={ceilingMap}
          gradientMap={TOON_GRADIENT}
          vertexColors
          emissive={surface.ceilingColor}
          emissiveIntensity={surface.ceilingSelfGlow}
        />
      </mesh>

      <group position={[ROOM_CX, 0, ROOM_CZ]}>
        {WALLS.map(([x, z, rotationY], i) => {
          const isSideWall = i >= 2;
          // 앞·뒷벽은 기차 앞에서 끊는다. 폭을 줄인 만큼 중심도 옮겨야 왼쪽 끝(-20)이 그대로 남는다(뒷벽은 180° 돌아 부호가 반대).
          const retreat = 16 - (i === 1 ? backWallEndX : frontWallEndX);
          const width = isSideWall ? ROOM_D : ROOM_W - retreat;
          const offsetX = isSideWall ? 0 : (i === 1 ? 1 : -1) * (retreat / 2);
          // 이 벽은 Y 로 90° 돌아 있어 로컬 +X 가 월드 -Z 다 → 로컬x = ROOM_CZ - 월드z
          const hole = isSideWall && door ? { x: ROOM_CZ - door.z, width: door.width, height: door.height } : null;
          return (
            <group key={i} position={[x, 0, z]} rotation={[0, rotationY, 0]}>
              {wallPanels(width, offsetX, hole, surface).map((panel, k) => (
                <WallPanel
                  key={k}
                  width={panel.width}
                  offsetX={panel.offsetX}
                  height={panel.height}
                  bottomY={panel.bottomY}
                  color={panel.color}
                  seed={surface.wallSeed + i}
                  stainStrength={surface.wallStain}
                  wear={surface.wallWear}
                />
              ))}
            </group>
          );
        })}
      </group>

      {/* 걸레받이·허리몰딩·코니스·모서리 기둥·부축기둥 */}
      <RoomShell outline={outline} door={door} />

      {/* 구조 기둥은 오른쪽 하나만 — 왼쪽은 책상 구역이다 */}
      <Column x={8} z={0} outline={outline} />
    </>
  );
}

export default memo(RoomStructure);
