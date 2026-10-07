import { useEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { claimCamera, releaseCamera } from "@/engine/camera";
import { playerView } from "@/engine/playerView";
import { endLockControl, lockControl } from "@/props/combinationLock";

const lockPoint = new THREE.Vector3();
const approach = new THREE.Vector3();
const eyeTarget = new THREE.Vector3();
const lookMatrix = new THREE.Matrix4();
const lookQuaternion = new THREE.Quaternion();

interface SavedView {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** 다가갈 방향의 기준 — 카메라가 아니라 사람이 선 자리 */
  player: THREE.Vector3;
}

interface LockCloseUpCameraProps {
  lockId: string;
  targetRef: RefObject<THREE.Object3D | null>;
  distance: number;
}

/**
 * [E] 로 만지는 동안 카메라를 자물쇠 앞으로 당긴다.
 * 설 자리를 좌표로 박지 않고 플레이어가 선 쪽에서 다가가기만 한다 — 걸어온 길이라 그 사이에 벽이 없다.
 */
export default function LockCloseUpCamera({ lockId, targetRef, distance }: LockCloseUpCameraProps) {
  const { camera } = useThree();
  const saved = useRef<SavedView | null>(null);

  // 만지는 도중 자물쇠가 사라지면 아무도 조작을 끝내 주지 않아 이동이 멈춘 채 갇힌다 — 여기서 치운다.
  useEffect(
    () => () => {
      if (saved.current) {
        camera.position.copy(saved.current.position);
        camera.quaternion.copy(saved.current.quaternion);
        saved.current = null;
      }
      releaseCamera(lockId);
      const control = lockControl();
      if (control && control.id === lockId) endLockControl();
    },
    [lockId, camera],
  );

  useFrame((_, dt) => {
    const control = lockControl();
    const isActive = !!control && control.id === lockId && control.phase === "active";
    const target = targetRef.current;
    if (isActive && target) {
      if (!saved.current) {
        // 카메라를 넘겨받지 않으면 3인칭 붐이 매 프레임 캐릭터 뒤로 되돌려 영영 도달하지 못하고 떤다.
        claimCamera(lockId);
        saved.current = {
          position: camera.position.clone(),
          quaternion: camera.quaternion.clone(),
          // 3인칭 카메라는 캐릭터 뒤 9.33 유닛이라 그 사이에 벽이 있을 수 있다 — 사람 자리로 방향을 잡는다.
          player: (playerView.ready ? playerView.eye : camera.position).clone(),
        };
      }
      target.getWorldPosition(lockPoint);
      approach.copy(saved.current.player).sub(lockPoint);
      approach.y *= 0.3; // 위에서 내려다보면 다이얼이 안 읽힌다
      if (approach.lengthSq() < 1e-8) approach.set(0, 0, 1);
      approach.normalize();
      eyeTarget.copy(lockPoint).addScaledVector(approach, distance);
      const k = 1 - Math.exp(-dt * 7);
      camera.position.lerp(eyeTarget, k);
      lookMatrix.lookAt(camera.position, lockPoint, camera.up);
      lookQuaternion.setFromRotationMatrix(lookMatrix);
      camera.quaternion.slerp(lookQuaternion, k);
      return;
    }
    if (saved.current) {
      const k = 1 - Math.exp(-dt * 9);
      camera.position.lerp(saved.current.position, k);
      camera.quaternion.slerp(saved.current.quaternion, k);
      if (camera.position.distanceToSquared(saved.current.position) < 1e-4) {
        camera.position.copy(saved.current.position);
        camera.quaternion.copy(saved.current.quaternion);
        saved.current = null;
        releaseCamera(lockId);
        // 다 돌아온 뒤에야 끝낸다. ESC 순간 끝내면 돌아오는 동안 이동이 되살아나 화면이 떤다.
        if (control && control.id === lockId) endLockControl();
      }
      return;
    }
    // 들어가 보지도 않았는데 leaving 으로 남아 있으면 그대로 끝낸다(안 그러면 갇힌다)
    if (control && control.id === lockId && control.phase === "leaving") endLockControl();
  });
  return null;
}
