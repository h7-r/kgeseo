/** 퍼즐 소품의 툰 재질 — 씬과 같은 계단 그라데이션을 쓴다 */
import * as THREE from "three";

import { TOON_GRADIENT } from "@/engine/toon";

export const makeToonMaterial = (
  color: THREE.ColorRepresentation,
  extra: Partial<THREE.MeshToonMaterialParameters> = {},
) => new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT, ...extra });
