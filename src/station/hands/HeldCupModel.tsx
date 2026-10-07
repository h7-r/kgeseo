import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

interface HeldCupModelProps {
  color: string;
  coffeeColor: string;
  /** 남은 양 0~1 — 마실수록 표면이 낮아지고 좁아진다 */
  remaining?: number;
  outline?: OutlineValues | null;
}

/** 손에 든 종이컵 — 자판기에서 나온 컵과 같은 모습. */
export default function HeldCupModel({ color, coffeeColor, remaining = 1, outline }: HeldCupModelProps) {
  // 바닥이 없으면 다 마셨을 때 컵 속이 뚫려 보이고 외곽선도 아래가 끊긴다.
  // 눈앞에 크게 드는 물건이라 면을 28 로 늘렸다(18 이면 옆선이 각져 보였다).
  const geometry = useMemo(() => {
    const wall = new THREE.CylinderGeometry(0.12, 0.083, 0.24, 28, 1, true);
    const bottom = new THREE.CircleGeometry(0.083, 28);
    bottom.rotateX(-Math.PI / 2); // 컵 속에서 내려다보는 면
    bottom.translate(0, -0.12, 0);
    const merged = mergeGeometries([wall, bottom], false);
    wall.dispose();
    bottom.dispose();
    return merged;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const fill = Math.max(0, Math.min(1, remaining));
  const surfaceY = -0.1 + 0.2 * fill;
  const surfaceRadius = (0.083 + (0.12 - 0.083) * ((surfaceY + 0.12) / 0.24)) * 0.9;
  return (
    <group>
      {/* meshBasic 은 명암이 없어 눈앞에 크게 들면 색종이처럼 납작하다. 같이 드는 관창도 toon 이다. */}
      <mesh geometry={geometry} castShadow>
        <meshToonMaterial color={color} gradientMap={TOON_GRADIENT} side={THREE.DoubleSide} />
        <ToonOutline geometry={geometry} outline={outline} />
      </mesh>
      {fill > 0.02 && (
        <mesh position={[0, surfaceY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[surfaceRadius, 18]} />
          <meshBasicMaterial color={coffeeColor} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}
