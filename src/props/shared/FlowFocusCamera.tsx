import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { claimCamera, releaseCamera } from "@/engine/camera";
import { smoothstep } from "@/engine/math";
import { handOverView } from "@/engine/playerView";
import { endCutscene, startCutscene } from "@/props/vendingPushState";

import { takeFlowFocusRequest, type FlowFocusRequest } from "./flowFocus";

const CAMERA_OWNER = "flowFocus";
/** 앞머리보다 이만큼(길의 몫) 앞을 본다 — 시선이 뒤처지지 않고 전류를 먼저 맞이한다 */
const LOOK_AHEAD = 0.05;
/** 시선이 따라붙는 빠르기 — 전류를 좇을 때 · 끝자리로 옮겨 갈 때 */
const FOLLOW_RATE = 8;
const SETTLE_RATE = 4;
/** 바로 머리 위를 지날 때 고개가 뒤집히지 않게 위아래 각을 여기서 끊는다 */
const MAX_PITCH = THREE.MathUtils.degToRad(68);
/** 길이 끝난 뒤 화면이 정면 자리로 옮겨 가는 시간(초) */
const MOVE_SECONDS = 1.1;
const SHAKE_ANGLE = 0.006;

const lookPoint = new THREE.Vector3();
const finalPoint = new THREE.Vector3();
const lookDirection = new THREE.Vector3();
const lookMatrix = new THREE.Matrix4();
const lookQuaternion = new THREE.Quaternion();
const shakeEuler = new THREE.Euler();
const shakeQuaternion = new THREE.Quaternion();

interface ActiveFocus {
  request: FlowFocusRequest;
  homePosition: THREE.Vector3;
  look: THREE.Quaternion;
}

/** 전류를 따라 시선을 돌리고 끝자리에서 멈추는 층 — 복도에 하나만 둔다 */
export default function FlowFocusCamera() {
  const camera = useThree((state) => state.camera);
  const active = useRef<ActiveFocus | null>(null);
  useEffect(
    () => () => {
      if (!active.current) return;
      active.current = null;
      releaseCamera(CAMERA_OWNER);
      endCutscene();
    },
    [],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const now = performance.now() / 1000;
    if (!active.current) {
      const request = takeFlowFocusRequest();
      // 다른 연출이 화면을 쥐고 있으면 전류만 흐르고 시선은 건드리지 않는다
      if (!request || !claimCamera(CAMERA_OWNER)) return;
      if (!startCutscene()) {
        releaseCamera(CAMERA_OWNER);
        return;
      }
      active.current = {
        request,
        homePosition: camera.position.clone(),
        look: camera.quaternion.clone(),
      };
    }
    const focus = active.current;
    const { request } = focus;

    const progress = (now - request.startedAt) / request.seconds;
    const isOnPath = progress < 1;
    if (!isOnPath && request.finalPosition) {
      const moved = smoothstep(Math.min(1, (now - request.startedAt - request.seconds) / MOVE_SECONDS));
      camera.position.lerpVectors(focus.homePosition, finalPoint.fromArray(request.finalPosition()), moved);
    }
    if (isOnPath) request.path.getPointAt(THREE.MathUtils.clamp(progress + LOOK_AHEAD, 0, 1), lookPoint);
    else lookPoint.fromArray(request.finalTarget());
    lookDirection.subVectors(lookPoint, camera.position);
    const flat = Math.hypot(lookDirection.x, lookDirection.z);
    lookDirection.y = THREE.MathUtils.clamp(lookDirection.y, -flat * Math.tan(MAX_PITCH), flat * Math.tan(MAX_PITCH));
    if (flat > 0.02) {
      lookPoint.addVectors(camera.position, lookDirection);
      lookMatrix.lookAt(camera.position, lookPoint, camera.up);
      lookQuaternion.setFromRotationMatrix(lookMatrix);
      focus.look.slerp(lookQuaternion, 1 - Math.exp(-dt * (isOnPath ? FOLLOW_RATE : SETTLE_RATE)));
    }
    const shake = (request.shake?.() ?? 0) * SHAKE_ANGLE;
    shakeEuler.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    camera.quaternion.copy(focus.look).multiply(shakeQuaternion.setFromEuler(shakeEuler));
    if (!isOnPath && now >= request.holdUntil()) {
      // 처음 보던 쪽으로 돌아가지 않는다. 지금 보는 자리에서 그대로 조작을 돌려준다.
      camera.quaternion.copy(focus.look);
      handOverView(request.finalPosition ? [camera.position.x, camera.position.z] : null);
      finish();
    }
  });

  function finish() {
    active.current = null;
    releaseCamera(CAMERA_OWNER);
    endCutscene();
  }

  return null;
}
