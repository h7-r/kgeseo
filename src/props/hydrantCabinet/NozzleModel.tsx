import { useEffect, useRef } from "react";
import type * as THREE from "three";

import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";
import { registerNozzleEnd } from "@/props/nozzleState";
import ToonMaterial from "@/props/shared/ToonMaterial";

import { NOZZLE_DIMENSIONS, buildNozzleGeometry } from "./nozzleGeometry";

interface NozzleModelProps {
  metalColor?: string;
  brightness?: number;
  outline?: OutlineValues | null;
}

const BRASS_HEIGHT = NOZZLE_DIMENSIONS.tip - NOZZLE_DIMENSIONS.brassStart;

/**
 * 관창 한 자루. 원점이 몸통 가운데, +y 가 노란 관창 끝, −y 가 호스 커플링.
 * 함 속·손·배전반 셋 중 한 군데에만 그려지므로, 그려진 곳의 커플링이 곧 호스가 물릴 자리다.
 */
export default function NozzleModel({ metalColor = "#9aa1a8", brightness = 1, outline }: NozzleModelProps) {
  const body = buildNozzleGeometry();
  const couplingRef = useRef<THREE.Group>(null);
  useEffect(() => registerNozzleEnd(couplingRef.current), []);
  return (
    <>
      <group ref={couplingRef} position={[0, -NOZZLE_DIMENSIONS.hose, 0]} />
      {/* 시험이 이 이름으로 지금 화면에 관창이 몇 개 · 어디 있는지 센다 */}
      <mesh name="nozzle" geometry={body} castShadow>
        <ToonMaterial color={metalColor} brightness={brightness} />
        <ToonOutline outline={outline} />
      </mesh>
      {/* 노란(황동) 끝 — 배전반 구멍(지름 0.105)보다 가늘어야 들어간다 */}
      <mesh position={[0, NOZZLE_DIMENSIONS.brassStart + BRASS_HEIGHT / 2, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, BRASS_HEIGHT, 14]} />
        <ToonMaterial color="#b9a24a" brightness={brightness} />
        <ToonOutline outline={outline} />
      </mesh>
      {/* 손잡이 고무 테 */}
      <mesh position={[0, -0.06, 0]} castShadow>
        <cylinderGeometry args={[0.068, 0.068, 0.08, 12]} />
        <ToonMaterial color="#2a2c30" brightness={brightness} />
      </mesh>
      {/* 커플링 테 — 호스 굵기(0.052)보다 조금만 굵다. 크면 밑에 큰 원이 튀어나온다. */}
      <mesh position={[0, -NOZZLE_DIMENSIONS.hose + 0.025, 0]} castShadow>
        <cylinderGeometry args={[0.062, 0.062, 0.05, 14]} />
        <ToonMaterial color={metalColor} brightness={brightness * 0.92} />
        <ToonOutline outline={outline} />
      </mesh>
      {/* 물 나오는 구멍 */}
      <mesh position={[0, NOZZLE_DIMENSIONS.tip - 0.005, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 0.02, 10]} />
        <ToonMaterial color="#15181c" brightness={brightness} />
      </mesh>
    </>
  );
}
