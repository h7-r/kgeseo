import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/* ═══════════════════════════════════════════════════════
   앙암바위 사진 둘레를 도는 입체 궤도

   [원본을 왜 안 지우나]
   피그마의 둥근 사진과 겹겹의 링은 그대로 둔다. 이 장면은 그 **뒤에**
   깔려서, 평면으로 겹쳐 있던 링을 진짜 기울어진 궤도로 바꿔 놓는다.
   사진은 그대로니 원본 구도는 지켜지고, 공간감만 더해진다.

   [왜 기울기가 서로 달라야 하나]
   같은 각도로 도는 링 여러 개는 화면에서 **동심원**으로만 보인다.
   축을 서로 어긋나게 기울여야 앞뒤로 교차하면서 깊이가 읽힌다.

   가볍게 유지하는 법은 유물.jsx 와 같다 — 적은 폴리곤, dpr 묶기,
   화면 밖이면 정지, 동작 줄이기면 회전 정지.
   ═══════════════════════════════════════════════════════ */

const 파랑 = "#3b82f6";
const 하늘 = "#93c5fd";

/* 궤도 링 하나 — 아주 얇은 도넛 */
function 링({ 반지름, 굵기, 기울기, 속도, 색, 투명도 }) {
  const 몸 = useRef(null);

  useFrame((_, 지난시간) => {
    if (몸.current) 몸.current.rotation.z += 지난시간 * 속도;
  });

  return (
    <group rotation={기울기}>
      <mesh ref={몸}>
        <torusGeometry args={[반지름, 굵기, 8, 128]} />
        <meshBasicMaterial color={색} transparent opacity={투명도} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* 궤도를 따라 도는 표식 — 링 위를 미끄러지는 작은 빛 */
function 표식({ 반지름, 기울기, 속도, 시작 }) {
  const 몸 = useRef(null);

  useFrame(({ clock }) => {
    if (!몸.current) return;
    const 각 = clock.getElapsedTime() * 속도 + 시작;
    몸.current.position.set(Math.cos(각) * 반지름, Math.sin(각) * 반지름, 0);
  });

  return (
    <group rotation={기울기}>
      <mesh ref={몸}>
        <sphereGeometry args={[0.035, 10, 10]} />
        <meshBasicMaterial color={하늘} />
      </mesh>
    </group>
  );
}

/* 얕은 먼지 — 궤도 바깥으로 퍼져 공간을 넓혀 준다 */
function 티끌({ 개수 = 240 }) {
  const 자리 = useMemo(() => {
    const 값 = new Float32Array(개수 * 3);
    for (let i = 0; i < 개수; i += 1) {
      const 각 = Math.random() * Math.PI * 2;
      const 거리 = 1.6 + Math.random() * 2.6;
      값[i * 3] = Math.cos(각) * 거리;
      값[i * 3 + 1] = Math.sin(각) * 거리;
      값[i * 3 + 2] = (Math.random() - 0.5) * 2.4;
    }
    return 값;
  }, [개수]);

  const 몸 = useRef(null);
  useFrame((_, 지난시간) => {
    if (몸.current) 몸.current.rotation.z -= 지난시간 * 0.03;
  });

  return (
    <points ref={몸}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[자리, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.024} color={파랑} transparent opacity={0.6} sizeAttenuation depthWrite={false} />
    </points>
  );
}

/* 마우스를 따라 장면 전체가 아주 조금 기운다 — 사진이 고정돼 있으니
   궤도만 움직여도 「사진이 궤도 안에 떠 있다」로 읽힌다 */
function 기울기따라({ 세기 = 0.16 }) {
  const { pointer, scene } = useThree();
  const 목표 = useRef(new THREE.Euler());

  useFrame(() => {
    목표.current.set(-pointer.y * 세기, pointer.x * 세기, 0);
    scene.rotation.x += (목표.current.x - scene.rotation.x) * 0.05;
    scene.rotation.y += (목표.current.y - scene.rotation.y) * 0.05;
  });

  return null;
}

export default function 궤도({ 보임 = true, 줄임 = false }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 6], fov: 45 }}
      frameloop={보임 && !줄임 ? "always" : "never"}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {/* 축을 서로 어긋나게 기울인 링 셋 */}
      <링 반지름={2.12} 굵기={0.006} 기울기={[1.15, 0.2, 0]} 속도={0.16} 색={파랑} 투명도={0.75} />
      <링 반지름={2.62} 굵기={0.005} 기울기={[-0.9, 0.55, 0.3]} 속도={-0.11} 색={하늘} 투명도={0.5} />
      <링 반지름={3.05} 굵기={0.004} 기울기={[0.45, -1.1, 0]} 속도={0.07} 색={파랑} 투명도={0.34} />

      <표식 반지름={2.12} 기울기={[1.15, 0.2, 0]} 속도={0.16} 시작={0} />
      <표식 반지름={2.62} 기울기={[-0.9, 0.55, 0.3]} 속도={-0.11} 시작={2.2} />

      <티끌 />
      <기울기따라 />
    </Canvas>
  );
}
