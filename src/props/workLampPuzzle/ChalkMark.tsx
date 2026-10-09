import { useRef } from "react";
import type * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { makeChalkMarkTexture } from "./labelTextures";

interface ChalkMarkProps {
  position: [number, number, number];
  rotation: [number, number, number];
  size?: number;
  /** 몇 번째 자리인지 — 자국에 같이 적힌다 */
  order: number;
  glyph: string;
  color: string;
  seed: number;
  /** 0~1 — 곧 투명도다. 그 구간이 밝을 때만 읽힌다 */
  strengthRef: { current: number };
}

/** 벽·문에 그려진 분필 자국. 벽에서 아주 살짝 띄운 평면이다. */
export default function ChalkMark({
  position,
  rotation,
  size = 0.9,
  order,
  glyph,
  color,
  seed,
  strengthRef,
}: ChalkMarkProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const texture = makeChalkMarkTexture(order, glyph, color, seed);
  useFrame(() => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (!mesh || !material) return;
    const v = strengthRef.current;
    material.opacity = v;
    // 투명 재질은 정렬 비용이 붙어 opacity 0 으로 계속 그리기보다 메시째 빼는 쪽이 싸다
    mesh.visible = v > 0.01;
  });
  return (
    <mesh ref={meshRef} position={position} rotation={rotation} visible={false}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial
        ref={materialRef}
        map={texture}
        transparent
        opacity={0}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
