/**
 * 다음 목표가 어느 쪽인지 바닥에 그린다. 캐릭터 발 앞에서 목표 쪽으로 꺾쇠 셋이 차례로 켜진다.
 * 조명을 하나도 안 쓴다(조명 수가 바뀌면 재질 셰이더를 전부 다시 만든다). 바닥 동그라미와 같은 규칙.
 * 매 프레임 React state 를 건드리지 않는다 — 자리와 밝기는 ref 와 재질에 직접 쓴다.
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { playerView } from "@/engine/playerView";

import { TUTORIAL_COLOR, TUTORIAL_STEPS, useTutorial } from "./tutorialState";

// 복도 바닥 높이. 눈 높이는 앉기·시점 설정에 따라 오르내려 바닥에서 잰다. 바닥 무늬에 묻히지 않게 살짝 띄운다.
const ARROW_Y = 0.05;
/** 발에서 꺾쇠까지 거리 — 캐릭터에 가리지 않을 만큼 앞에 둔다 */
const CHEVRON_DISTANCES = [3.4, 5, 6.6];
const CHEVRON_SCALE = 1.3;
/** 목표에 이만큼 다가오면 사라지기 시작한다. 코앞에서 계속 가리키면 동그라미를 가린다 */
const FADE_NEAR = 2.5;
const FADE_FAR = 6;
/** 꺾쇠가 앞으로 차례차례 켜지는 한 바퀴(초) */
const FLOW_SECONDS = 1.3;

function buildChevronGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.9); // 촉 끝
  shape.lineTo(-1, -0.2);
  shape.lineTo(-1, -0.9);
  shape.lineTo(0, 0.2);
  shape.lineTo(1, -0.9);
  shape.lineTo(1, -0.2);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  // XY 평면의 모양을 바닥에 눕혀 촉이 +z 를 보게 한다
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

// 화면에 한 벌뿐이라 모듈에 둔다. 매 프레임 opacity 를 고치는 게 본체라 훅에 담으면 린트가 막는다.
let resources: { geometry: THREE.ShapeGeometry; materials: THREE.MeshBasicMaterial[] } | null = null;
function getResources() {
  resources ??= {
    geometry: buildChevronGeometry(),
    materials: CHEVRON_DISTANCES.map(
      () =>
        new THREE.MeshBasicMaterial({
          color: TUTORIAL_COLOR,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        }),
    ),
  };
  return resources;
}

interface TutorialDirectionArrowProps {
  enabled?: boolean;
}

export function TutorialDirectionArrow({ enabled = true }: TutorialDirectionArrowProps) {
  // 안내를 접었거나 끝냈으면 바닥 동그라미처럼 같이 사라진다 — 화살표만 남으면 안내가 어긋난다
  const { step, isHidden, isFinished } = useTutorial();
  const current = isHidden || isFinished ? null : TUTORIAL_STEPS[step];
  const groupRef = useRef<THREE.Group>(null);
  const { geometry, materials } = getResources();

  useFrame(({ camera }, delta) => {
    const spot = enabled ? current?.spot : undefined;
    const eye = playerView.ready ? playerView.eye : camera.position;
    const group = groupRef.current;
    const ease = Math.min(1, delta * 10);
    if (!group || !spot) {
      for (const material of materials) material.opacity += (0 - material.opacity) * ease;
      return;
    }
    const dx = spot[0] - eye.x;
    const dz = spot[1] - eye.z;
    const distance = Math.hypot(dx, dz);
    group.position.set(eye.x, ARROW_Y, eye.z);
    // 바로 위에 서면 방향이 튄다 — 그때는 마지막 각을 그대로 둔다
    if (distance > 0.4) group.rotation.y = Math.atan2(dx, dz);
    const strength = THREE.MathUtils.clamp((distance - FADE_NEAR) / (FADE_FAR - FADE_NEAR), 0, 1);
    const flow = (performance.now() / 1000 / FLOW_SECONDS) % 1;
    materials.forEach((material, k) => {
      // 목표를 지나쳐 그리지 않는다
      const fits = CHEVRON_DISTANCES[k] < distance - 1 ? 1 : 0;
      const wave = 0.5 + 0.5 * Math.cos((flow - k / materials.length) * Math.PI * 2);
      const target = fits * strength * (0.5 + 0.5 * wave);
      material.opacity += (target - material.opacity) * ease;
    });
  });

  return (
    <group ref={groupRef} name="tutorial-floor-arrow">
      {CHEVRON_DISTANCES.map((distance, k) => (
        <mesh
          key={distance}
          geometry={geometry}
          material={materials[k]}
          position={[0, 0, distance]}
          scale={CHEVRON_SCALE}
          castShadow={false}
          receiveShadow={false}
          frustumCulled={false}
          renderOrder={6}
        />
      ))}
    </group>
  );
}
