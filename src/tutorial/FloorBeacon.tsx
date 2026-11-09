/**
 * 튜토리얼 바닥 동그라미와 같은 생김새의 「여기로」 표시 — 튜토리얼 뒤에도 같은 말로 길을 알린다.
 * 소화전 밸브에 전기가 닿으면 그 앞에 뜬다(미르 11/9 「돌아가서 밸브를 열어야 한다는 걸 모른다」, 튜토피드백 10회차).
 * 보일지는 매 프레임 묻는다 — 시간으로 정해지는 조건(밸브 충전)은 알림이 없다.
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { getBeamFade } from "./beamFade";
import { FLOOR_MARKER_RADIUS, TUTORIAL_COLOR } from "./tutorialState";

const MARKER_COLOR = new THREE.Color(TUTORIAL_COLOR);

type BasicMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

interface FloorBeaconProps {
  x: number;
  z: number;
  isVisible: () => boolean;
  radius?: number;
}

export default function FloorBeacon({ x, z, isVisible, radius = FLOOR_MARKER_RADIUS }: FloorBeaconProps) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<BasicMesh>(null);
  const discRef = useRef<BasicMesh>(null);
  const beamRef = useRef<BasicMesh>(null);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    group.visible = isVisible();
    if (!group.visible) return;
    // 튜토리얼 동그라미와 같이 1.6초 주기로 숨쉬듯
    const breath = 0.5 + 0.5 * Math.sin(clock.elapsedTime * ((Math.PI * 2) / 1.6));
    group.scale.setScalar(1 + breath * 0.03);
    if (ringRef.current) ringRef.current.material.opacity = 0.65 + breath * 0.35;
    if (discRef.current) discRef.current.material.opacity = 0.1 + breath * 0.1;
    if (beamRef.current) beamRef.current.material.opacity = 0.16 + breath * 0.1;
  });

  return (
    <group ref={groupRef} position={[x, 0.03, z]} visible={false}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <ringGeometry args={[radius * 0.94, radius, 96]} />
        <meshBasicMaterial color={MARKER_COLOR} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={discRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} renderOrder={5}>
        <circleGeometry args={[radius * 0.94, 96]} />
        <meshBasicMaterial color={MARKER_COLOR} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={beamRef} position={[0, 2.2, 0]} renderOrder={5}>
        <cylinderGeometry args={[radius, radius, 4.4, 48, 1, true]} />
        <meshBasicMaterial
          color={MARKER_COLOR}
          alphaMap={getBeamFade()}
          transparent
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
