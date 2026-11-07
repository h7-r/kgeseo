/**
 * 터치 시점 — 손가락 드래그로 카메라를 돌린다. 캔버스 안에 둔다.
 *
 * PointerLockControls 의 마우스 회전과 같은 식이다(YXZ 오일러, 위아래 극각 제한, pointerSpeed 배율).
 * 그래서 조작기를 그대로 받아 그 값(잠김 여부 · pointerSpeed · 극각)을 따른다 —
 * 자물쇠·컷신 동안 본편이 pointerSpeed 를 0 으로 두면 손가락으로도 안 돈다.
 *
 * 감도: 화면 짧은 변만큼 끌면 약 1.8 rad(≈103°) 돈다. 작은 폰과 아이패드의 체감을 맞추려고 화면 크기로 나눈다.
 * 세로는 0.7 배 — 고개를 위아래로 크게 꺾을 일은 적고, 가로로 끌다 손가락이 비스듬히 흘러도 시선이 덜 출렁인다.
 * 관성(부드럽게 하기): 끈 만큼을 한 번에 돌리지 않고 짧은 시간(LOOK_SMOOTH_SECONDS)에 걸쳐 따라간다 — 프레임이 들쭉날쭉한
 * 기기에서 덜 덜컥이고, 손을 떼면 아주 짧게 미끄러지듯 멈춘다(11/8 해랑 검토 「손에 잘 안 붙는다」). 빠르기 배율은 TouchHud.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { PointerLockControls } from "three-stdlib";

import { useGameFrozen } from "./gamePause";
import { addCancelListener, consumeTouchLook } from "./touchInput";
import { isTouchMode } from "./touchMode";

const RADIANS_PER_SHORT_SIDE = 1.8;
const VERTICAL_SCALE = 0.7;
/** 남은 회전의 63% 를 이 시간에 따라간다 — 60fps 에서 네 프레임쯤에 거의 다 따라간다 */
const LOOK_SMOOTH_SECONDS = 0.028;
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
  /** 아직 돌리지 않은 끌기(px) — 관성 */
  const pending = useRef({ x: 0, y: 0 });
  // 멈춤 · 입력 취소 때 남은 관성을 버린다. 멈춘 동안은 프레임이 돌지 않아(frameloop never) 아래 useFrame 이 못 지운다 —
  // 그대로 두면 계속할 때 손을 대지 않았는데도 시점이 돈다(코덱스 리뷰 P2: 852×393 에서 6.5°)
  const isFrozen = useGameFrozen();
  useEffect(() => {
    if (!isFrozen) return;
    pending.current.x = 0;
    pending.current.y = 0;
    consumeTouchLook();
  }, [isFrozen]);
  useEffect(
    () =>
      addCancelListener(() => {
        pending.current.x = 0;
        pending.current.y = 0;
      }),
    [],
  );

  useFrame((_, delta) => {
    const { dx, dy } = consumeTouchLook();
    const controls = controlsRef.current;
    const rest = pending.current;
    if (!controls || !controls.isLocked || !isTouchMode() || (canLook && !canLook())) {
      // 조작이 끊기면(창 · 자물쇠 · 컷신) 남은 관성도 버린다 — 돌아왔을 때 혼자 돌지 않게
      rest.x = 0;
      rest.y = 0;
      return;
    }
    rest.x += dx;
    rest.y += dy * VERTICAL_SCALE;
    if (Math.abs(rest.x) < 0.02 && Math.abs(rest.y) < 0.02) {
      rest.x = 0;
      rest.y = 0;
      return;
    }
    const follow = 1 - Math.exp(-Math.min(delta, 0.1) / LOOK_SMOOTH_SECONDS);
    const stepX = rest.x * follow;
    const stepY = rest.y * follow;
    rest.x -= stepX;
    rest.y -= stepY;
    const radiansPerPixel =
      (RADIANS_PER_SHORT_SIDE / Math.max(320, Math.min(size.width, size.height))) * controls.pointerSpeed;
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= stepX * radiansPerPixel;
    euler.x -= stepY * radiansPerPixel;
    euler.x = Math.max(HALF_PI - controls.maxPolarAngle, Math.min(HALF_PI - controls.minPolarAngle, euler.x));
    camera.quaternion.setFromEuler(euler);
  });

  return null;
}
