import { useRef, type CSSProperties } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { COLOR } from "@/styles/tokens";

// 디자인의 둥근 사진과 평면 링은 그대로 두고, 이 장면을 그 뒤에 깔아 링을 진짜 기울어진 궤도로 보이게 한다.

// 회색 위주. 파랑은 튀어 보여 남색은 가운데 링 한 줄에만 쓴다.
const GRAY = "#8f949d";
const SILVER = "#c3c7ce";
const NAVY = COLOR.navyMuted;

// 같은 각도로 도는 링은 동심원으로만 보인다. 축을 어긋나게 기울여야 앞뒤로 교차하며 깊이가 읽힌다.
const INNER_TILT: THREE.EulerTuple = [1.15, 0.2, 0];
const MIDDLE_TILT: THREE.EulerTuple = [-0.9, 0.55, 0.3];
const OUTER_TILT: THREE.EulerTuple = [0.45, -1.1, 0];

const canvasStyle: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

interface OrbitRingProps {
  radius: number;
  thickness: number;
  tilt: THREE.EulerTuple;
  speed: number;
  color: string;
  opacity: number;
}

function OrbitRing({ radius, thickness, tilt, speed, color, opacity }: OrbitRingProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.z += delta * speed;
  });

  return (
    <group rotation={tilt}>
      <mesh ref={meshRef}>
        <torusGeometry args={[radius, thickness, 8, 128]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
    </group>
  );
}

interface OrbitMarkerProps {
  radius: number;
  tilt: THREE.EulerTuple;
  speed: number;
  startAngle: number;
}

/** 링 위를 미끄러지는 작은 빛. */
function OrbitMarker({ radius, tilt, speed, startAngle }: OrbitMarkerProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const angle = clock.getElapsedTime() * speed + startAngle;
    meshRef.current.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  });

  return (
    <group rotation={tilt}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.035, 10, 10]} />
        <meshBasicMaterial color={SILVER} />
      </mesh>
    </group>
  );
}

/** 궤도 바깥으로 퍼진 얕은 먼지. 공간을 넓혀 보이게 한다. */
const DUST_COUNT = 240;
const DUST_POSITIONS = (() => {
  const values = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 1.6 + Math.random() * 2.6;
    values[i * 3] = Math.cos(angle) * distance;
    values[i * 3 + 1] = Math.sin(angle) * distance;
    values[i * 3 + 2] = (Math.random() - 0.5) * 2.4;
  }
  return values;
})();

function Dust() {
  const positions = DUST_POSITIONS;

  const pointsRef = useRef<THREE.Points>(null);
  useFrame((_, delta) => {
    if (pointsRef.current) pointsRef.current.rotation.z -= delta * 0.03;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.024} color={GRAY} transparent opacity={0.5} sizeAttenuation depthWrite={false} />
    </points>
  );
}

// 사진은 고정이니 궤도만 마우스를 따라 기울어도 "사진이 궤도 안에 떠 있다" 로 읽힌다.
function PointerTilt({ strength = 0.16 }: { strength?: number }) {
  const { pointer, scene } = useThree();
  const targetRef = useRef(new THREE.Euler());

  useFrame(() => {
    const target = targetRef.current;
    target.set(-pointer.y * strength, pointer.x * strength, 0);
    scene.rotation.x += (target.x - scene.rotation.x) * 0.05;
    scene.rotation.y += (target.y - scene.rotation.y) * 0.05;
  });

  return null;
}

interface OrbitSceneProps {
  visible?: boolean;
  reducedMotion?: boolean;
}

/** 앙암바위 사진 둘레를 도는 입체 궤도. */
export default function OrbitScene({ visible = true, reducedMotion = false }: OrbitSceneProps) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 6], fov: 45 }}
      frameloop={visible && !reducedMotion ? "always" : "never"}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      // 셰이더 오류 검사는 GPU 컴파일이 끝날 때까지 주 스레드를 붙잡는다(스크롤 중 420ms 측정). 배포에서만 끈다.
      onCreated={({ gl }) => {
        gl.debug.checkShaderErrors = !import.meta.env.PROD;
      }}
      style={canvasStyle}
    >
      <OrbitRing radius={2.12} thickness={0.006} tilt={INNER_TILT} speed={0.16} color={GRAY} opacity={0.6} />
      <OrbitRing radius={2.62} thickness={0.005} tilt={MIDDLE_TILT} speed={-0.11} color={NAVY} opacity={0.3} />
      <OrbitRing radius={3.05} thickness={0.004} tilt={OUTER_TILT} speed={0.07} color={GRAY} opacity={0.3} />

      <OrbitMarker radius={2.12} tilt={INNER_TILT} speed={0.16} startAngle={0} />
      <OrbitMarker radius={2.62} tilt={MIDDLE_TILT} speed={-0.11} startAngle={2.2} />

      <Dust />
      <PointerTilt />
    </Canvas>
  );
}
