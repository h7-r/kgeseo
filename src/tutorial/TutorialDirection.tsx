/**
 * 다음 목표가 어느 쪽인지 알려 준다. 바닥 동그라미는 화면 밖에 있으면 안 보여서
 * "어디로 가라는 거지?" 에 막힌다 — 그래서 방향은 늘 보이게 둘을 더한다.
 *   ① 캔버스 안: 캐릭터 머리 위의 납작한 화살표가 목표 쪽으로 돈다
 *   ② 캔버스 밖: 목표가 화면 밖일 때만 그쪽 테두리에 깜빡이는 화살표
 * 조명을 하나도 안 쓴다(조명 수가 바뀌면 재질 셰이더를 전부 다시 만든다). 바닥 동그라미와 같은 규칙.
 * 매 프레임 React state 를 건드리지 않는다 — 3D 는 ref 로, 가장자리 표시는 DOM style 에 직접 쓴다.
 */
import { useEffect, useRef, type CSSProperties } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { playerView } from "@/engine/playerView";

import { TUTORIAL_COLOR, TUTORIAL_STEPS, useTutorial } from "./tutorialState";

const EDGE_MARGIN = 52; // 가장자리 화살표를 테두리에서 이만큼 안쪽에 둔다
// 복도 바닥 높이. 눈 높이는 앉기·시점 설정에 따라 오르내려 머리에 안 붙는다 — 바닥에서 잰다.
const FLOOR_Y = 0;

// 캔버스 안(계산)과 밖(그리기)을 잇는 유일한 통로
let edgeArrowElement: HTMLDivElement | null = null;

// 원뿔은 어느 각도에서도 화살표로 안 읽혔다. 바닥과 나란히 눕힌 판이면 3인칭 카메라에서 그대로 "→" 로 읽힌다.
function buildArrowGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.0); // 촉 끝
  shape.lineTo(-0.62, 0.15);
  shape.lineTo(-0.24, 0.15);
  shape.lineTo(-0.24, -0.85); // 자루
  shape.lineTo(0.24, -0.85);
  shape.lineTo(0.24, 0.15);
  shape.lineTo(0.62, 0.15);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  // XY 평면의 모양을 눕혀 촉이 +z 를 보게 한다. −π/2 로 두면 −z 를 가리킨다.
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

// 화면에 하나뿐이라 모듈에 둔다. 매 프레임 opacity 를 고치는 게 본체라 훅에 담으면 린트가 막는다.
let headArrowResources: { geometry: THREE.ShapeGeometry; material: THREE.MeshBasicMaterial } | null = null;
function getHeadArrowResources() {
  headArrowResources ??= {
    geometry: buildArrowGeometry(),
    material: new THREE.MeshBasicMaterial({
      color: TUTORIAL_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false, // 벽 뒤에 있어도 방향은 보여야 한다
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  };
  return headArrowResources;
}

const projected = new THREE.Vector3();

interface TutorialDirectionArrowProps {
  enabled?: boolean;
}

/** 캔버스 안 — 머리 위 화살표 + 가장자리 좌표 계산 */
export function TutorialDirectionArrow({ enabled = true }: TutorialDirectionArrowProps) {
  // 안내를 접었거나 끝냈으면 바닥 동그라미처럼 같이 사라진다 — 화살표만 남으면 안내가 어긋난다
  const { step, isHidden, isFinished } = useTutorial();
  const current = isHidden || isFinished ? null : TUTORIAL_STEPS[step];
  const groupRef = useRef<THREE.Group>(null);
  const { geometry, material } = getHeadArrowResources();

  useFrame(({ camera, size }, delta) => {
    const spot = enabled ? current?.spot : undefined;
    const eye = playerView.ready ? playerView.eye : camera.position;

    // ① 머리 위 화살표
    const group = groupRef.current;
    if (group) {
      if (!spot) {
        material.opacity += (0 - material.opacity) * Math.min(1, delta * 8);
      } else {
        const dx = spot[0] - eye.x;
        const dz = spot[1] - eye.z;
        const distance = Math.hypot(dx, dz);
        const bob = Math.sin(performance.now() / 420) * 0.12;
        group.position.set(eye.x, FLOOR_Y + 5.0 + bob, eye.z);
        // 바로 위에 서면 방향이 튄다 — 그때는 마지막 각을 그대로 둔다
        if (distance > 0.4) group.rotation.y = Math.atan2(dx, dz);
        // 다 왔으면 흐려진다. 코앞에서 계속 가리키면 시야만 가린다.
        const strength = THREE.MathUtils.clamp((distance - 1.6) / 2.5, 0, 1);
        const pulse = 0.72 + 0.28 * Math.sin(performance.now() / 300);
        material.opacity += (0.42 * strength * pulse - material.opacity) * Math.min(1, delta * 10);
      }
    }

    // ② 화면 가장자리 화살표
    const edge = edgeArrowElement;
    if (!edge) return;
    if (!spot) {
      edge.style.opacity = "0";
      return;
    }
    projected.set(spot[0], FLOOR_Y + 0.8, spot[1]).project(camera);
    const isBehind = projected.z > 1;
    // 카메라 뒤면 부호를 뒤집어야 방향이 맞는다
    const x = isBehind ? -projected.x : projected.x;
    const y = isBehind ? -projected.y : projected.y;
    if (!isBehind && Math.abs(x) <= 1 && Math.abs(y) <= 1) {
      edge.style.opacity = "0"; // 목표가 화면에 들어오면 바로 숨긴다
      return;
    }
    const m = Math.max(Math.abs(x), Math.abs(y)) || 1;
    const nx = x / m;
    const ny = y / m;
    const cx = Math.min(size.width - EDGE_MARGIN, Math.max(EDGE_MARGIN, (nx * 0.5 + 0.5) * size.width));
    const cy = Math.min(size.height - EDGE_MARGIN, Math.max(EDGE_MARGIN, (-ny * 0.5 + 0.5) * size.height));
    edge.style.opacity = "1";
    // 화살표 그림은 0° 에 오른쪽을 본다. 화면 y 는 아래로 자라고 CSS 회전은 시계 방향이라
    // 화면 방향 (nx, -ny) 의 각이 곧 회전각이다(앞에 - 를 붙이면 위아래가 뒤집힌다).
    edge.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%) rotate(${Math.atan2(-ny, nx)}rad)`;
  });

  return (
    <group ref={groupRef} name="tutorial-head-arrow">
      <mesh
        geometry={geometry}
        material={material}
        rotation={[-0.32, 0, 0]}
        castShadow={false}
        receiveShadow={false}
        frustumCulled={false}
        renderOrder={6}
      />
    </group>
  );
}

/** 캔버스 밖 — 가장자리 화살표. 자리는 위 컴포넌트가 직접 써 넣는다. */
export default function TutorialDirectionHud() {
  // useEffect(…, []) 로 담으면 안내가 꺼진 첫 렌더에 요소가 없어 영영 비어 있는다 — ref 콜백으로 담는다
  const attach = (element: HTMLDivElement | null) => {
    edgeArrowElement = element;
  };
  useEffect(
    () => () => {
      edgeArrowElement = null;
    },
    [],
  );

  return (
    <>
      <style>{"@keyframes tutorialDirectionBlink{0%,100%{filter:brightness(1)}50%{filter:brightness(2.2)}}"}</style>
      <div ref={attach} data-tutorial="edge" aria-hidden style={edgeArrowStyle}>
        <svg width="38" height="38" viewBox="0 0 34 34">
          <path
            d="M6 17 L24 17 M17 8 L26 17 L17 26"
            fill="none"
            stroke={TUTORIAL_COLOR}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </>
  );
}

const edgeArrowStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  top: 0,
  zIndex: 44,
  width: 38,
  height: 38,
  opacity: 0,
  transition: "opacity 200ms ease",
  pointerEvents: "none",
  willChange: "transform",
  animation: "tutorialDirectionBlink 1s ease-in-out infinite",
};
