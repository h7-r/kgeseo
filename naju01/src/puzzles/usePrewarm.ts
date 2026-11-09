/**
 * 퍼즐 한 벌의 셰이더를 미리 굽는다 — 무리가 선 뒤 모형을 읽을 틈을 두고 한 번.
 * 숨겨 둔 효과(불기둥 · 물결 · 틈 등)가 처음 보이는 순간 셰이더를 굽느라 화면이 멈추는 것을 막는다.
 */
import { useEffect } from "react";
import type * as THREE from "three";
import { useThree } from "@react-three/fiber";

import { prewarmTree } from "./prewarm";

/** 무리가 선 뒤 이만큼(ms) 지나 굽는다 — 그 사이 모형(GLB)이 붙는다 */
const PREWARM_AFTER_MS = 4000;

export function usePrewarm(...roots: THREE.Object3D[]) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    const timer = window.setTimeout(() => prewarmTree(gl, scene, camera, roots), PREWARM_AFTER_MS);
    return () => window.clearTimeout(timer);
    // roots 는 부를 때마다 새 배열이다 — 안에 든 무리로 견준다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, ...roots]);
}
