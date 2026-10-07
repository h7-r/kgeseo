import * as THREE from "three";

import { UNITS_PER_METER } from "../../plan/sitePlan";

/** 도면 좌표(X, Z, 고도 — 미터) → three 좌표(유닛). */
export function planPoint(x: number, z: number, elevation: number): THREE.Vector3 {
  return new THREE.Vector3(x * UNITS_PER_METER, elevation * UNITS_PER_METER, z * UNITS_PER_METER);
}
