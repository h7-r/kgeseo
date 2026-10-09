import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { TOON_GRADIENT } from "@/engine/toon";
import { WALL_TEXTURE_H, WALL_TEXTURE_W, makeWallTexture } from "@/engine/textures/surfaces";
import { applySurfaceStains } from "@/station/vertexNoise";

interface WallPanelProps {
  width: number;
  height: number;
  /** 이 조각의 아랫변 높이. UV 를 그만큼 밀어 위·아래 조각의 블록 줄을 잇는다. */
  bottomY: number;
  color: string;
  seed: number;
  stainStrength?: number;
  wear?: number;
  /** 벽 안에서 이 조각의 가로 중심 */
  offsetX?: number;
}

/** 벽 한 장 — 블록 텍스처 + 반복 안 되는 정점 얼룩. */
export default function WallPanel({
  width,
  height,
  bottomY,
  color,
  seed,
  stainStrength = 0.5,
  wear = 0.7,
  offsetX = 0,
}: WallPanelProps) {
  const texture = makeWallTexture(seed, wear);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(
      width,
      height,
      Math.max(2, Math.round(width / 1.2)),
      Math.max(2, Math.round(height / 1.2)),
    );
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      // 벽을 여러 조각으로 쪼개도 벽돌 무늬가 이어지게 UV 도 offsetX 만큼 민다.
      uv.setX(i, uv.getX(i) * (width / WALL_TEXTURE_W) + (offsetX - width / 2) / WALL_TEXTURE_W);
      uv.setY(i, uv.getY(i) * (height / WALL_TEXTURE_H) + bottomY / WALL_TEXTURE_H);
    }
    applySurfaceStains(g, seed + Math.round(width * 10) + bottomY, {
      count: 18,
      strength: stainStrength,
      verticalStretch: 2.6, // 벽 얼룩은 세로로 흘러내린 모양
      bottomGrime: 3.2,
      heightOffset: bottomY + height / 2,
    });
    return g;
  }, [width, height, bottomY, seed, stainStrength, offsetX]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh position={[offsetX, bottomY + height / 2, 0]} geometry={geometry} receiveShadow>
      <meshToonMaterial color={color} map={texture} gradientMap={TOON_GRADIENT} vertexColors />
    </mesh>
  );
}
