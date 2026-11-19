/**
 * 긴 폰의 가로 시야 상한 — 터치 모드에서만(계획서 6.3, 코덱스 01회차: P0 는 상한만).
 *
 * 시야각은 세로 기준이라 화면이 길수록 가로 시야가 넓어진다(세로 60°: 16:9 → 91.5°, 20:9 → 104.1°).
 * 넓으면 가장자리가 늘어나고 그릴 물체가 는다. 그래서 가로 시야가 96° 를 넘을 때만 세로 시야를 줄여 96° 에 맞춘다.
 * 16:9 이하에서는 아무 일도 하지 않는다.
 *
 * 시야각을 쓰는 곳(본편 3인칭 보간 · 나주 퍼즐 집중 카메라 · 처음 값)은 그대로 두고, 투영 행렬을 만드는 순간에만 묶는다.
 * camera.fov 는 「설계 값」 그대로 남아 다른 코드가 읽어도 어긋나지 않는다.
 */
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type * as THREE from "three";

import { isTouchMode, subscribeTouchMode } from "./touchMode";

/** 가로 시야 상한(도) — 실기기에서 보고 정할 후보 값 */
export const MAX_HORIZONTAL_FOV = 96;

const DEG = Math.PI / 180;

interface CappedCamera extends THREE.PerspectiveCamera {
  __fovCapped?: boolean;
}

function maxVerticalFov(aspect: number): number {
  return (2 * Math.atan(Math.tan((MAX_HORIZONTAL_FOV * DEG) / 2) / aspect)) / DEG;
}

export function FovCap() {
  const camera = useThree((state) => state.camera) as CappedCamera;

  useEffect(() => {
    if (!("isPerspectiveCamera" in camera) || camera.__fovCapped) return;
    camera.__fovCapped = true;
    const original = camera.updateProjectionMatrix.bind(camera);
    camera.updateProjectionMatrix = () => {
      const designFov = camera.fov;
      const limit = maxVerticalFov(camera.aspect);
      if (!isTouchMode() || designFov <= limit) {
        original();
        return;
      }
      camera.fov = limit;
      original();
      camera.fov = designFov;
    };
    camera.updateProjectionMatrix();
  }, [camera]);

  // 터치 ↔ 마우스로 바뀌면 상한을 걸거나 푼다(다음 갱신을 기다리지 않는다)
  useEffect(() => subscribeTouchMode(() => camera.updateProjectionMatrix()), [camera]);

  return null;
}
