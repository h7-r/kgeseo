import { TOON_GRADIENT } from "@/engine/toon";
import { PALETTE } from "@/station/layout/dimensions";

import StructureOutlines, { type StructureOutline } from "./StructureOutlines";

interface ColumnProps {
  x: number;
  z: number;
  outline?: StructureOutline;
}

/** 구조 기둥 — 몸통 + 받침 + 머리. 충돌 박스는 STATIC_COLLIDERS 에 따로 있다. */
export default function Column({ x, z, outline }: ColumnProps) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 6, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.7, 0.8, 12, 20]} />
        <meshToonMaterial color={PALETTE.struct} gradientMap={TOON_GRADIENT} />
        <StructureOutlines outline={outline} />
      </mesh>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 1, 0.6, 20]} />
        <meshToonMaterial color={PALETTE.structDark} gradientMap={TOON_GRADIENT} />
        <StructureOutlines outline={outline} />
      </mesh>
      <mesh position={[0, 11.8, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 0.9, 0.5, 20]} />
        <meshToonMaterial color={PALETTE.structDark} gradientMap={TOON_GRADIENT} />
        <StructureOutlines outline={outline} />
      </mesh>
    </group>
  );
}
