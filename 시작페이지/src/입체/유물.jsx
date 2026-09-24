import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Edges, Float } from "@react-three/drei";
import * as THREE from "three";

/* ═══════════════════════════════════════════════════════
   히어로 뒤에서 도는 입체 유물

   [왜 진짜 3D 인가]
   CSS transform 으로 만든 「3D 같은 것」은 결국 납작한 판을 기울인 것이라,
   각도를 바꿔도 **면이 새로 드러나지 않는다.** 앙암바위의 깎인 면이
   빛을 받아 돌아가는 걸 보여 주려면 진짜 기하 도형이 필요하다.
   저장소에 three · @react-three/fiber · drei 가 이미 들어 있어서 그대로 쓴다.

   [무엇을 그리나]
   · 깎인 돌덩이 하나 — 게임의 소재(나주 앙암바위)를 추상화한 다면체.
     평면 음영(flatShading)이라 면마다 밝기가 달라 각도가 눈에 보인다.
   · 둘레를 도는 파편 넷 — 궤도가 서로 어긋나 깊이가 읽힌다.
   · 먼지 입자 — 카메라가 움직일 때 시차가 생겨 공간이 있다는 걸 알려 준다.

   [가볍게 유지하는 법]
   · 폴리곤이 적은 도형만 쓴다(detail 0~1). 후처리(bloom)는 넣지 않았다 —
     화면 전체를 다시 그리는 비용이 이 장면의 값어치보다 크다.
   · dpr 을 1.5 로 묶는다. 레티나에서 4배로 그리면 팬이 돈다.
   · 화면 밖으로 나가면 렌더를 멈춘다(보임 = false → frameloop "never").
   · 동작 줄이기를 켠 사람에겐 회전을 세우고 정지 화면만 남긴다.
   ═══════════════════════════════════════════════════════ */

const 파랑 = "#3b82f6";
const 하늘 = "#93c5fd";

/* 깎인 돌덩이 — 면이 굵직해야 도는 게 보인다 */
function 돌덩이() {
  const 몸 = useRef(null);

  useFrame((_, 지난시간) => {
    if (!몸.current) return;
    /* 축을 둘 다 조금씩 돌려야 같은 면이 반복돼 보이지 않는다 */
    몸.current.rotation.y += 지난시간 * 0.16;
    몸.current.rotation.x += 지난시간 * 0.05;
  });

  return (
    <group ref={몸}>
      {/* 몸통은 **반투명**하게 둔다.
          꽉 찬 덩어리로 두면 바로 위에 얹힌 제목을 가려 글이 안 읽힌다.
          뒤가 비쳐야 결(모서리 선)만 남아 「깎인 수정」처럼 보인다. */}
      <mesh castShadow={false} receiveShadow={false}>
        <icosahedronGeometry args={[1.26, 1]} />
        <meshStandardMaterial
          color="#0a1a38"
          roughness={0.5}
          metalness={0.35}
          flatShading
          transparent
          opacity={0.42}
          emissive="#0d2a5c"
          emissiveIntensity={0.7}
          depthWrite={false}
        />
        {/* 모서리 선 — 이 장면에서 형태를 알려 주는 건 면이 아니라 선이다 */}
        <Edges threshold={18} color={하늘} />
      </mesh>

      {/* 한 겹 더 큰 선만 있는 껍질 — 겹친 두 결이 회전을 또렷하게 만든다 */}
      <mesh scale={1.34}>
        <icosahedronGeometry args={[1.26, 0]} />
        <meshBasicMaterial visible={false} />
        <Edges threshold={1} color={파랑} />
      </mesh>

      {/* 속에서 새어 나오는 빛 — 전설이 깨어난다는 뜻 */}
      <mesh scale={0.5}>
        <icosahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color={하늘} transparent opacity={0.14} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* 둘레를 도는 파편 — 궤도 기울기와 속도를 서로 다르게 준다 */
function 파편들() {
  const 칸 = useRef(null);
  const 조각 = useMemo(
    () => [
      { 반지름: 2.35, 속도: 0.42, 기울기: 0.22, 크기: 0.1, 시작: 0 },
      { 반지름: 2.75, 속도: -0.3, 기울기: -0.44, 크기: 0.075, 시작: 1.9 },
      { 반지름: 3.15, 속도: 0.22, 기울기: 0.62, 크기: 0.06, 시작: 3.6 },
      { 반지름: 2.05, 속도: -0.52, 기울기: 0.85, 크기: 0.05, 시작: 5.1 },
    ],
    [],
  );

  useFrame(({ clock }) => {
    const ㅅ = clock.getElapsedTime();
    칸.current?.children.forEach((조각몸, i) => {
      const ㅈ = 조각[i];
      const 각 = ㅅ * ㅈ.속도 + ㅈ.시작;
      조각몸.position.set(
        Math.cos(각) * ㅈ.반지름,
        Math.sin(각) * ㅈ.반지름 * Math.sin(ㅈ.기울기),
        Math.sin(각) * ㅈ.반지름 * Math.cos(ㅈ.기울기),
      );
      조각몸.rotation.x += 0.01;
      조각몸.rotation.z += 0.007;
    });
  });

  return (
    <group ref={칸}>
      {조각.map((ㅈ, i) => (
        <mesh key={i} scale={ㅈ.크기}>
          <tetrahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#1e3a5f" emissive={파랑} emissiveIntensity={0.9} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/* 먼지 — 카메라가 움직일 때 시차를 만들어 공간감을 낸다 */
function 먼지({ 개수 = 420 }) {
  const 자리 = useMemo(() => {
    const 값 = new Float32Array(개수 * 3);
    for (let i = 0; i < 개수; i += 1) {
      /* 구 껍질에 고루 뿌린다 — 가운데가 비어야 돌덩이를 가리지 않는다 */
      const 각1 = Math.random() * Math.PI * 2;
      const 각2 = Math.acos(Math.random() * 2 - 1);
      const 거리 = 4 + Math.random() * 5;
      값[i * 3] = Math.sin(각2) * Math.cos(각1) * 거리;
      값[i * 3 + 1] = Math.cos(각2) * 거리 * 0.6;
      값[i * 3 + 2] = Math.sin(각2) * Math.sin(각1) * 거리;
    }
    return 값;
  }, [개수]);

  const 몸 = useRef(null);
  useFrame((_, 지난시간) => {
    if (몸.current) 몸.current.rotation.y += 지난시간 * 0.012;
  });

  return (
    <points ref={몸}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[자리, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.035} color={하늘} transparent opacity={0.55} sizeAttenuation depthWrite={false} />
    </points>
  );
}

/* 마우스를 따라 카메라가 아주 조금 움직인다.
   물체를 돌리는 게 아니라 **보는 자리**를 옮겨야 진짜 공간처럼 느껴진다. */
function 카메라따라가기({ 세기 = 0.55 }) {
  const { camera, pointer } = useThree();
  const 목표 = useRef(new THREE.Vector3(0, 0, 8.4));

  useFrame(() => {
    목표.current.set(pointer.x * 세기, pointer.y * 세기 * 0.6, 8.4);
    /* 바로 따라가면 딱딱하다 — 조금씩 따라붙어야 관성이 생긴다 */
    camera.position.lerp(목표.current, 0.045);
    camera.lookAt(0, 0, 0);
  });

  return null;
}

export default function 유물({ 보임 = true, 줄임 = false }) {
  return (
    <Canvas
      /* 레티나에서 4배로 그리면 팬이 돈다 — 1.5 로 묶는다 */
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 8.4], fov: 42 }}
      /* 화면 밖에 있으면 아예 안 그린다 */
      frameloop={보임 && !줄임 ? "always" : "never"}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {/* 바탕은 투명하게 둔다 — 뒤에 깔린 피그마 배경색이 그대로 보여야 한다 */}
      <ambientLight intensity={0.35} />
      {/* 테두리를 훑는 빛 — 돌의 윤곽이 살아난다 */}
      <directionalLight position={[-4, 3, 4]} intensity={2.1} color={하늘} />
      <directionalLight position={[5, -2, -3]} intensity={1.1} color="#1d4ed8" />
      <pointLight position={[0, 0, 2.4]} intensity={6} distance={7} color={파랑} />

      <Float speed={1.1} rotationIntensity={0.25} floatIntensity={0.7} floatingRange={[-0.14, 0.14]}>
        <돌덩이 />
      </Float>
      <파편들 />
      <먼지 />
      <카메라따라가기 />
    </Canvas>
  );
}
