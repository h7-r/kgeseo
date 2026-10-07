import type { RefObject } from "react";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

const scratch = new THREE.Vector3();

/** 겨냥 대상이 "어디 있나" 물어올 때 쓴다. 매 프레임 불리므로 그릇은 돌려 쓴다. */
export function worldPositionOf(ref: RefObject<THREE.Object3D | null>): Vector3Tuple | null {
  const object = ref.current;
  if (!object) return null;
  object.getWorldPosition(scratch);
  return [scratch.x, scratch.y, scratch.z];
}
