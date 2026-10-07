import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";

import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { mergePieces, type GeometryPiece } from "./geometry";

interface WorkLampModelProps {
  scale?: number;
  metalColor?: string;
  rubberColor?: string;
  bulbColor?: string;
  /** 0~1 전구 발광 세기 */
  glow?: number;
  /** 꺼져 있을 때 유리알의 작은 반짝임 — 깜깜한 복도에서 램프를 찾는 유일한 단서다 */
  floorGlint?: number;
  outline?: OutlineValues | null;
}

const CAGE_BARS = 6;

function cageGeometry() {
  const pieces: GeometryPiece[] = [
    // 분기함 고리에 걸리는 걸이
    { geometry: new THREE.TorusGeometry(0.085, 0.017, 8, 20), position: [0, 0.62, 0], rotation: [Math.PI / 2, 0, 0] },
    // 갓 — 램프의 실루엣을 만든다
    { geometry: new THREE.CylinderGeometry(0.1, 0.22, 0.26, 20, 1, true), position: [0, 0.2, 0] },
    // 갓 테두리 — 뚫린 원뿔은 종이처럼 보여 링으로 아가리를 닫는다
    { geometry: new THREE.TorusGeometry(0.22, 0.014, 6, 24), position: [0, 0.07, 0], rotation: [Math.PI / 2, 0, 0] },
    { geometry: new THREE.TorusGeometry(0.2, 0.012, 6, 22), position: [0, -0.1, 0], rotation: [Math.PI / 2, 0, 0] },
    { geometry: new THREE.TorusGeometry(0.15, 0.012, 6, 22), position: [0, -0.3, 0], rotation: [Math.PI / 2, 0, 0] },
  ];
  // 세로살 — 갓 테두리에서 밑 캡까지 안쪽으로 기울여 건다
  for (let i = 0; i < CAGE_BARS; i++) {
    const a = (i / CAGE_BARS) * Math.PI * 2;
    const r0 = 0.215,
      r1 = 0.1;
    const start = new THREE.Vector3(Math.cos(a) * r0, 0.07, Math.sin(a) * r0);
    const end = new THREE.Vector3(Math.cos(a) * r1, -0.4, Math.sin(a) * r1);
    const span = new THREE.Vector3().subVectors(end, start);
    const g = new THREE.CylinderGeometry(0.011, 0.011, span.length(), 5, 1);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.clone().normalize()));
    g.translate((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
    pieces.push({ geometry: g });
  }
  // 살이 모이는 밑 캡
  pieces.push({ geometry: new THREE.SphereGeometry(0.075, 12, 8), position: [0, -0.42, 0], scale: [1, 0.6, 1] });
  return mergePieces(pieces);
}

/**
 * 케이지 작업등. 1 m ≈ 3.32 유닛이라 실물 35 cm 가 길이 1.16 이다.
 * 원점을 전구 한가운데에 둬 손에 들 때도 꽂을 때도 빛의 자리를 따로 계산하지 않는다.
 * 고무 코드는 없다 — 바닥에서도 손에서도 선이 허공에 떠 지저분했다.
 */
export default function WorkLampModel({
  scale = 1,
  metalColor = "#8d949c",
  rubberColor = "#2b2e33",
  bulbColor = "#fff6d8",
  glow = 0,
  floorGlint = 0,
  outline,
}: WorkLampModelProps) {
  const cage = useMemo(() => cageGeometry(), []);
  useEffect(() => () => cage?.dispose(), [cage]);

  return (
    <group scale={scale}>
      {cage && (
        <mesh geometry={cage} castShadow>
          <meshToonMaterial color={metalColor} gradientMap={TOON_GRADIENT} />
          <ToonOutline geometry={cage} outline={outline} />
          <Outlines thickness={3} color="#141518" />
        </mesh>
      )}
      {/* 고무 손잡이 — 쇠와 합치면 한 색이 된다 */}
      <mesh position={[0, 0.44, 0]} castShadow>
        <cylinderGeometry args={[0.072, 0.078, 0.3, 14]} />
        <meshToonMaterial color={rubberColor} gradientMap={TOON_GRADIENT} />
        <Outlines thickness={3} color="#141518" />
      </mesh>
      {/* 전구 — toneMapped=false 라 1 을 넘기면 하얗게 탄다. 꺼져도 유리알은 보여야 한다. */}
      <mesh>
        <sphereGeometry args={[0.115, 16, 12]} />
        <meshBasicMaterial
          color={new THREE.Color(bulbColor).multiplyScalar(0.18 + floorGlint + glow * 1.5)}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
