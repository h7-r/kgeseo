/**
 * 캔버스 안: 매 프레임 튜토리얼 조건을 보고 다음 자리에 바닥 동그라미를 그린다.
 * 조명을 안 받는 재질에 toneMapped 를 꺼 어두운 복도에서도 또렷하다. 광원은 복도 예산 때문에 하나도 안 쓴다.
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { playerView } from "@/engine/playerView";

import { FLOOR_MARKER_RADIUS, TUTORIAL_COLOR, TUTORIAL_STEPS, tickTutorial, useTutorial } from "./tutorialState";

const MARKER_COLOR = new THREE.Color(TUTORIAL_COLOR);

type BasicMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

interface TutorialFloorMarkerProps {
  enabled?: boolean;
}

export default function TutorialFloorMarker({ enabled = true }: TutorialFloorMarkerProps) {
  const { step } = useTutorial();
  const current = TUTORIAL_STEPS[step];
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<BasicMesh>(null);
  const discRef = useRef<BasicMesh>(null);
  const beamRef = useRef<BasicMesh>(null);

  useFrame(({ camera, clock }) => {
    if (!enabled) return;
    const eye = playerView.ready ? playerView.eye : camera.position;
    tickTutorial({ eye, yaw: camera.rotation.y });

    const group = groupRef.current;
    if (!group) return;
    // 1.6초 주기로 숨쉬듯
    const breath = 0.5 + 0.5 * Math.sin(clock.elapsedTime * ((Math.PI * 2) / 1.6));
    group.scale.setScalar(1 + breath * 0.06);
    if (ringRef.current) ringRef.current.material.opacity = 0.65 + breath * 0.35;
    if (discRef.current) discRef.current.material.opacity = 0.1 + breath * 0.1;
    if (beamRef.current) beamRef.current.material.opacity = 0.08 + breath * 0.07;
  });

  if (!enabled || !current?.spot) return null;
  const [x, z] = current.spot;
  return (
    <group ref={groupRef} position={[x, 0.03, z]} key={current.id}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <ringGeometry args={[FLOOR_MARKER_RADIUS * 0.86, FLOOR_MARKER_RADIUS, 64]} />
        <meshBasicMaterial color={MARKER_COLOR} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={discRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} renderOrder={5}>
        <circleGeometry args={[FLOOR_MARKER_RADIUS * 0.86, 64]} />
        <meshBasicMaterial color={MARKER_COLOR} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {/* 빛기둥 — 위로 갈수록 옅어지게 뚜껑 없는 원통 */}
      <mesh ref={beamRef} position={[0, 2.2, 0]} renderOrder={5}>
        <cylinderGeometry args={[FLOOR_MARKER_RADIUS * 0.95, FLOOR_MARKER_RADIUS, 4.4, 48, 1, true]} />
        <meshBasicMaterial
          color={MARKER_COLOR}
          transparent
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
