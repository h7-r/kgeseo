import type { RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { thirdPersonConfig } from "@/engine/movement/boom";
import { playerView } from "@/engine/playerView";

import { HEADQUARTERS_MIN_X } from "./dimensions";
import { passage, type PassageState } from "./passage";

const forward = new THREE.Vector3();

/**
 * 복도↔방이 구멍을 통해 실제로 보이나. 거리만 보면 벽을 마주 보고 서도 켜진다(three 는 가림을 모른다).
 * 구멍의 좌·중·우 세 점 중 하나라도 시야 앞쪽이면 켠다 — 가장자리만 걸쳐 보일 때 방이 사라지면 안 된다.
 */
function isFacingOpening(camera: THREE.Camera, p: THREE.Vector3, pass: PassageState) {
  if (pass.freeRoam) return true;
  // 3인칭은 카메라가 사람 뒤로 물러나 있어, 사람이 여유 밖이어도 카메라는 구멍을 볼 수 있다.
  const openingMargin = 3.5 + (thirdPersonConfig.enabled ? thirdPersonConfig.distance / 0.3 : 0);
  if (Math.abs(p.x - HEADQUARTERS_MIN_X) < openingMargin) return true;
  // 거리로 끄면 복도 끝에서 돌아볼 때 화면 한가운데 구멍 너머가 검게 빈다. 각도만 본다.
  camera.getWorldDirection(forward);
  const fx = forward.x;
  const fz = forward.z;
  const forwardLen = Math.hypot(fx, fz);
  if (forwardLen < 1e-6) return true; // 바로 위/아래를 보는 중
  // 기준 각은 화면이 실제로 담는 가로 각에서 — 숫자를 박으면 비율·fov 가 바뀔 때 방이 사라진다.
  const perspective = camera instanceof THREE.PerspectiveCamera ? camera : null;
  const halfV = ((perspective?.fov ?? 60) * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * (perspective?.aspect ?? 1.6));
  const limit = Math.cos(Math.min(1.5, halfH + 0.2)); // 0.2rad ≈ 11° 여유
  const half = pass.doorWidth / 2 + 1;
  for (const dz of [-half, 0, half]) {
    const dx = HEADQUARTERS_MIN_X - p.x;
    const dzz = pass.doorZ + dz - p.z;
    const len = Math.hypot(dx, dzz);
    if (len < 1e-3) return true;
    if ((dx * fx + dzz * fz) / (len * forwardLen) > limit) return true;
  }
  return false;
}

type GroupRef = RefObject<THREE.Object3D | null>;

interface ZoneCullingProps {
  headquarters: GroupRef;
  corridor: GroupRef;
  train: GroupRef;
  backdrop: GroupRef;
  enabled?: boolean;
}

/** 방·복도·기차 그룹의 visible 을 직접 켜고 끈다. state 로 하면 리렌더와 GLB 재로딩이 난다. */
export default function ZoneCulling({ headquarters, corridor, train, backdrop, enabled = true }: ZoneCullingProps) {
  const camera = useThree((s) => s.camera);
  // 이동(FRAME_PRIORITY.movement)이 먼저 사람 자리를 적고 기본 순서(0)인 여기서 읽는다.
  useFrame(() => {
    // 어느 구역인가는 사람 자리로, 무엇이 보이나는 카메라 방향으로. 3인칭 카메라 자리로 보면 벽 뒤로 넘어가 드로우콜이 17배로 튀었다.
    const p = playerView.ready ? playerView.eye : camera.position;
    const pass = passage.get();

    if (!enabled) {
      for (const r of [headquarters, corridor, train, backdrop]) if (r.current) r.current.visible = true;
      return;
    }

    const inCorridor = p.x < HEADQUARTERS_MIN_X;
    // 복도에서 방이 보이는 길은 구멍 하나뿐이다.
    const facingOpening = isFacingOpening(camera, p, pass);
    const showHeadquarters = !inCorridor || pass.freeRoam || (pass.open > 0.02 && facingOpening);
    // 열림을 따지지 않는다 — 구멍을 막는 밀리는 벽이 복도 그룹에 있어 끄면 방에서 검은 구멍이 보인다.
    const showCorridor = inCorridor || facingOpening;
    // 기차는 방 저편(+x)이라 방이 보일 때만 보인다.
    const showTrain = showHeadquarters;

    if (headquarters.current) headquarters.current.visible = showHeadquarters;
    if (corridor.current) corridor.current.visible = showCorridor;
    if (train.current) train.current.visible = showTrain;
    // 배경은 큰 판 몇 장이라 늘 켠다. 기차와 같이 끄면 컬링이 곧 암전이 된다.
    if (backdrop.current) backdrop.current.visible = true;
  });
  return null;
}
