// NPC 동행 개발 테스트(?npc)용 임시 NPC 구체 — 그리기만 한다.
// 자리는 바깥(useNajuNpcFollow 또는 NajuNpcMarker)이 매 프레임 meshRef 로 직접 고친다.
import type { RefObject } from "react";
import type * as THREE from "three";

import { NPC_TEST_COLOR, NPC_TEST_VISUAL_RADIUS } from "./npcTestConfig";
import { UNITS_PER_METER } from "./units";

interface NajuNpcBodyProps {
  meshRef: RefObject<THREE.Mesh | null>;
}

export default function NajuNpcBody({ meshRef }: NajuNpcBodyProps) {
  return (
    <mesh ref={meshRef} name="npc-test-marker" castShadow>
      <sphereGeometry args={[NPC_TEST_VISUAL_RADIUS * UNITS_PER_METER, 32, 16]} />
      <meshStandardMaterial color={NPC_TEST_COLOR} emissive={NPC_TEST_COLOR} emissiveIntensity={0.25} />
    </mesh>
  );
}
