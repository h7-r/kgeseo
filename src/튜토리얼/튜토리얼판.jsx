// 튜토리얼판.jsx — 캔버스 안: 매 프레임 튜토리얼 조건을 보고 **바닥 동그라미**를 그린다
//
// [동그라미를 어떻게 그리나]
//   · 조명을 안 받는 재질(meshBasic)에 toneMapped 를 꺼서, 어두운 복도에서도
//     또렷하고 블룸이 켜져 있으면 은은하게 번진다.
//   · 바닥 고리 + 안쪽 옅은 원판 + 위로 솟는 빛기둥 — 멀리서도 「저기」가 보이게.
//   · 숨쉬듯 커졌다 작아지고(1.6초), 들어서면 밝게 번쩍하며 다음 자리로 넘어간다.
//   광원(light)은 하나도 안 쓴다 — 복도 광원 예산(문서: 비밀복도_구조와_되돌리기)을
//   건드리지 않는다.

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { 플레이어시점 } from "../공용.jsx";
import { 단계들, 동그라미반지름, 튜토리얼틱, use튜토리얼 } from "./튜토리얼.js";

const 색 = new THREE.Color("#8ee8ff");

export default function 튜토리얼판({ 켬 = true }) {
  const { 단계 } = use튜토리얼();
  const 지금 = 단계들[단계];
  const 묶음 = useRef(null);
  const 고리 = useRef(null);
  const 원판 = useRef(null);
  const 기둥 = useRef(null);

  useFrame(({ camera, clock }) => {
    if (!켬) return;
    const 눈 = 플레이어시점.쓸수있나 ? 플레이어시점.눈 : camera.position;
    튜토리얼틱({ 눈, yaw: camera.rotation.y });

    const g = 묶음.current;
    if (!g) return;
    const t = clock.elapsedTime;
    const 숨 = 0.5 + 0.5 * Math.sin(t * ((Math.PI * 2) / 1.6));
    g.scale.setScalar(1 + 숨 * 0.06);
    if (고리.current) 고리.current.material.opacity = 0.65 + 숨 * 0.35;
    if (원판.current) 원판.current.material.opacity = 0.1 + 숨 * 0.1;
    if (기둥.current) 기둥.current.material.opacity = 0.08 + 숨 * 0.07;
  });

  if (!켬 || !지금?.자리) return null;
  const [x, z] = 지금.자리;
  const r = 동그라미반지름;
  return (
    <group ref={묶음} position={[x, 0.03, z]} key={지금.id}>
      <mesh ref={고리} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <ringGeometry args={[r * 0.86, r, 64]} />
        <meshBasicMaterial color={색} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={원판} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} renderOrder={5}>
        <circleGeometry args={[r * 0.86, 64]} />
        <meshBasicMaterial color={색} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {/* 빛기둥 — 위로 갈수록 옅어지게 끝을 열어 둔 원통(뚜껑 없음) */}
      <mesh ref={기둥} position={[0, 2.2, 0]} renderOrder={5}>
        <cylinderGeometry args={[r * 0.95, r, 4.4, 48, 1, true]} />
        <meshBasicMaterial
          color={색}
          transparent
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
