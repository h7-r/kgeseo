/** 입 벌린 조개 — 진주 빛 잇기의 조개 여섯(어미 · 돌리는 넷 · 큰 조개)이 같은 모양을 크기만 달리해 쓴다 */
import type { Ref } from "react";
import type * as THREE from "three";

interface ClamParts {
  shell: THREE.BufferGeometry;
  materials: { shell: THREE.Material; nacre: THREE.Material };
}

/**
 * 뒤꼭지(경첩)가 원점, 입이 −z. 아래짝은 모래 위 얕은 바가지, 위짝은 경첩에서 들려 안쪽 자개가 앞을 본다.
 * 진주는 이 밖에서 입 쪽(−z·size/2)에 따로 놓는다
 */
export default function ClamShell({
  size,
  lidAngle,
  lidRef,
  parts,
}: {
  size: number;
  lidAngle: number;
  lidRef?: Ref<THREE.Group>;
  parts: ClamParts;
}) {
  const { shell, materials } = parts;
  return (
    <group scale={size}>
      <mesh geometry={shell} material={materials.shell} scale={[1, -0.35, 1]} position={[0, 0.105, 0]} castShadow />
      <mesh geometry={shell} material={materials.nacre} scale={[0.97, -0.3, 0.97]} position={[0, 0.102, 0]} />
      {/* 경첩 — 두 짝이 맞닿는 뒤꼭지. 사이에 빈틈이 안 보이게 토막으로 잇는다 */}
      <mesh geometry={shell} material={materials.shell} scale={[0.5, 0.35, 0.22]} position={[0, 0.0, 0.04]} />
      <mesh material={materials.shell} position={[0, 0.045, 0.01]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.055, 0.055, 0.46, 10]} />
      </mesh>
      {/* 위짝은 납작하게 눌러 뒤에서 봐도 반구 덩어리로 안 보이게 */}
      <group ref={lidRef} position={[0, 0.03, 0]} rotation={[lidAngle, 0, 0]}>
        <mesh geometry={shell} material={materials.shell} scale={[1, 0.5, 1]} castShadow />
        <mesh geometry={shell} material={materials.nacre} scale={[0.97, 0.45, 0.97]} position={[0, -0.012, 0]} />
      </group>
    </group>
  );
}
