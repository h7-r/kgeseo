import * as THREE from "three";

/** 같은 색을 조금 밝게(f > 1)·어둡게(f < 1). 물건이 전부 같은 회색이면 가짜처럼 보인다. */
export function scaleColor(hex: THREE.ColorRepresentation, factor: number): string {
  return `#${new THREE.Color(hex).multiplyScalar(factor).getHexString()}`;
}
