import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";

import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { AimHighlight } from "@/lobby/AimHighlight";
import { isHingeOpen, toggleHinge } from "@/props/hingeState";
import ToonMaterial from "@/props/shared/ToonMaterial";
import { getWorldPositionOf } from "@/props/shared/aimTarget";

interface BreakerSwitchProps {
  id: string;
  geometry: THREE.BufferGeometry;
  /** [x, y] — z 는 켜짐/꺼짐 사이를 움직인다 */
  spot: readonly [number, number];
  offZ: number;
  onZ: number;
  color: string;
  brightness: number;
  outline?: OutlineValues | null;
  canHandle: boolean;
}

/**
 * 분기 스위치 손잡이 하나 — [E] 로 좌우로 민다. 하나만 움직여야 해서 따로 그린다.
 * 미는 동안 매 프레임 바뀌는 자리를 state 로 두면 함 전체가 다시 그려진다 — 켜짐/꺼짐만 hingeState 가 들고
 * 자리는 useFrame 이 스스로 좁혀 간다.
 */
export default function BreakerSwitch({
  id,
  geometry,
  spot,
  offZ,
  onZ,
  color,
  brightness,
  outline,
  canHandle,
}: BreakerSwitchProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const amount = useRef(0); // 0 = 꺼짐, 1 = 켜짐
  useFrame((_, dt) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const target = isHingeOpen(id) ? 1 : 0;
    amount.current += (target - amount.current) * (1 - Math.exp(-dt * 14));
    mesh.position.z = offZ + (onZ - offZ) * amount.current;
  });
  return (
    <>
      {/* 확대는 안 준다 — useFrame 이 위치를 직접 만지는데 강조까지 position 을 쓰면 손잡이가 떤다 */}
      <AimHighlight id={id} anchor={() => null} grow={0}>
        <mesh ref={meshRef} geometry={geometry} position={[spot[0], spot[1], offZ]} castShadow>
          <ToonMaterial color={color} brightness={brightness} />
          <ToonOutline geometry={geometry} outline={outline} />
        </mesh>
      </AimHighlight>
      <Interactable
        id={id}
        radius={0.26}
        reach={4}
        disabled={() => !canHandle}
        label=""
        position={() => getWorldPositionOf(meshRef)}
        run={() => toggleHinge(id)}
      />
    </>
  );
}
