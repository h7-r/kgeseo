/**
 * 터치 시점 — 손가락 드래그로 카메라를 돌린다. 캔버스 안에 둔다.
 *
 * PointerLockControls 의 마우스 회전과 같은 식이다(YXZ 오일러, 위아래 극각 제한, pointerSpeed 배율).
 * 그래서 조작기를 그대로 받아 그 값(잠김 여부 · pointerSpeed · 극각)을 따른다 —
 * 자물쇠·컷신 동안 본편이 pointerSpeed 를 0 으로 두면 손가락으로도 안 돈다.
 *
 * 감도: 화면 짧은 변만큼 끌면 약 1.8 rad(≈103°) 돈다. 작은 폰과 아이패드의 체감을 맞추려고 화면 크기로 나눈다.
 */
import { useFrame, useThree } from "@react-three/fiber";
import type { RefObject } from "react";
import * as THREE from "three";
import type { PointerLockControls } from "three-stdlib";

import { consumeTouchLook } from "./touchInput";
import { isTouchMode } from "./touchMode";

const RADIANS_PER_SHORT_SIDE = 1.8;
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const HALF_PI = Math.PI / 2;

interface TouchLookProps {
  controlsRef: RefObject<PointerLockControls | null>;
  /** 더 막을 조건 — 나주는 퍼즐 집중 카메라 중엔 시점을 돌리지 않는다 */
  canLook?: () => boolean;
}

export function TouchLook({ controlsRef, canLook }: TouchLookProps) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  useFrame(() => {
    const { dx, dy } = consumeTouchLook();
    const controls = controlsRef.current;
    if (!controls || !controls.isLocked || !isTouchMode() || (dx === 0 && dy === 0)) return;
    if (canLook && !canLook()) return;
    const radiansPerPixel =
      (RADIANS_PER_SHORT_SIDE / Math.max(320, Math.min(size.width, size.height))) * controls.pointerSpeed;
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= dx * radiansPerPixel;
    euler.x -= dy * radiansPerPixel;
    euler.x = Math.max(HALF_PI - controls.maxPolarAngle, Math.min(HALF_PI - controls.minPolarAngle, euler.x));
    camera.quaternion.setFromEuler(euler);
  });

  return null;
}
