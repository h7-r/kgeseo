import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { aim } from "@/lobby/interactions";

import { CAB_FX, CAB_SEAMS } from "./cabinetGeometry";

interface DrawerAimGlowProps {
  id: string;
  row: number;
  z: number;
  color?: THREE.ColorRepresentation;
  strength?: number;
}

/**
 * 겨냥한 서랍 한 칸 앞에 덧대는 빛판. 닫힌 서랍은 GLB 몸통의 일부라 따로 밝힐 메시가 없다.
 * 더하기 합성이라 원래 색을 지우지 않고 밝기만 올린다(Bloom 이 번진다).
 */
export default function DrawerAimGlow({ id, row, z, color = "#fffee7", strength = 0.45 }: DrawerAimGlowProps) {
  const meshRef = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>(null);
  const amount = useRef(0);
  const y0 = CAB_SEAMS[row];
  const y1 = CAB_SEAMS[row + 1];

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const goal = aim.get() === id ? 1 : 0;
    amount.current += (goal - amount.current) * (1 - Math.exp(-delta * 14));
    mesh.visible = amount.current > 0.01;
    mesh.material.opacity = amount.current * strength;
    mesh.material.color.set(color);
  });

  return (
    <mesh ref={meshRef} visible={false} position={[0, (y0 + y1) / 2, z + 0.003]} scale={[CAB_FX * 2, y1 - y0, 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
