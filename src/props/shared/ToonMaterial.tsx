import type * as THREE from "three";

import { scaleColor } from "@/engine/color";
import { TOON_GRADIENT } from "@/engine/toon";

interface ToonMaterialProps {
  color: THREE.ColorRepresentation;
  brightness?: number;
}

/** 소품이 같이 쓰는 셀셰이딩 재질. 메시의 자식으로 넣는다. */
export default function ToonMaterial({ color, brightness = 1 }: ToonMaterialProps) {
  return <meshToonMaterial color={scaleColor(color, brightness)} gradientMap={TOON_GRADIENT} />;
}
