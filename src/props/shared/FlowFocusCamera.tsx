import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { claimCamera, releaseCamera } from "@/engine/camera";
import { smoothstep, smoothstepRange } from "@/engine/math";
import { handOverView } from "@/engine/playerView";
import { endCutscene, startCutscene } from "@/props/vendingPushState";

import { peekFlowFocusRequest, takeFlowFocusRequest, type FlowFocusRequest } from "./flowFocus";

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
/** 끝자리에서 시야를 당기는 시간 · 처음 보던 쪽으로 돌아오는 시간(초) */
const ZOOM_SECONDS = 0.6;
const RETURN_SECONDS = 0.7;
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
  /** 처음 보던 쪽 — returnHome 이면 여기로 돌아온다 */
  homeLook: THREE.Quaternion;
  look: THREE.Quaternion;
  homeFov: number;
  /**
   * 화면이 시작한 뒤 흐른 프레임 시간(초). 끝자리 머묾 · 당기기 · 돌아오기는 이걸로 잰다 — 휴대폰 멈춤은 렌더 루프와
   * 게임 시계(gameSetTimeout)를 같이 세우는데 벽시계로 재면 풀자마자 돌아와 버린다(Codex 리뷰 af5cca6).
   */
  elapsed: number;
  /** 끝자리에 닿은(길이 끝난) 때의 elapsed */
  arrivedElapsed: number | null;
  /** 돌아오기 시작한 때의 elapsed · 그때의 시선과 시야각 */
  returnElapsed: number | null;
  returnFrom: THREE.Quaternion;
  returnFov: number;
}

/** 전류를 따라 시선을 돌리고 끝자리에서 멈추는 층 — 복도에 하나만 둔다 */
export default function FlowFocusCamera() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
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
      // 다른 연출이 화면을 쥐고 있으면 기다린다 — 꺼내 놓고 못 넘겨받으면 연출이 통째로 사라진다(10회차 Codex)
      if (!peekFlowFocusRequest(now) || !claimCamera(CAMERA_OWNER)) return;
      if (!startCutscene()) {
        releaseCamera(CAMERA_OWNER);
        return;
      }
      const request = takeFlowFocusRequest();
      if (!request) {
        releaseCamera(CAMERA_OWNER);
        endCutscene();
        return;
      }
      active.current = {
        request,
        homePosition: camera.position.clone(),
        homeLook: camera.quaternion.clone(),
        look: camera.quaternion.clone(),
        homeFov: camera.fov,
        elapsed: 0,
        arrivedElapsed: null,
        returnElapsed: null,
        returnFrom: new THREE.Quaternion(),
        returnFov: camera.fov,
      };
      request.onStart?.();
    }
    const focus = active.current;
    const { request } = focus;
    focus.elapsed += dt;

    // 길(전류)은 번개 그림과 같은 벽시계를 따른다. 끝자리부터는 프레임 시간으로 잰다
    const pathEnd = request.startedAt + request.seconds;
    const isOnPath = !!request.path && now < pathEnd;
    if (!isOnPath && focus.arrivedElapsed === null) focus.arrivedElapsed = focus.elapsed;
    const sinceArrived = focus.arrivedElapsed === null ? 0 : focus.elapsed - focus.arrivedElapsed;

    // 돌아오는 중 — 처음 보던 쪽으로, 당긴 시야도 같이 푼다
    if (focus.returnElapsed !== null) {
      const s = smoothstepRange(0, RETURN_SECONDS, focus.elapsed - focus.returnElapsed);
      camera.quaternion.slerpQuaternions(focus.returnFrom, focus.homeLook, s);
      setFov(camera, THREE.MathUtils.lerp(focus.returnFov, focus.homeFov, s));
      if (s >= 1) {
        handOverView(null);
        finish();
      }
      return;
    }

    if (!isOnPath && request.finalPosition) {
      const moved = smoothstep(Math.min(1, (now - pathEnd) / MOVE_SECONDS));
      camera.position.lerpVectors(focus.homePosition, finalPoint.fromArray(request.finalPosition()), moved);
    }
    if (isOnPath && request.path) {
      const progress = (now - request.startedAt) / request.seconds;
      request.path.getPointAt(THREE.MathUtils.clamp(progress + LOOK_AHEAD, 0, 1), lookPoint);
    } else lookPoint.fromArray(request.finalTarget());
    lookDirection.subVectors(lookPoint, camera.position);
    const flat = Math.hypot(lookDirection.x, lookDirection.z);
    lookDirection.y = THREE.MathUtils.clamp(lookDirection.y, -flat * Math.tan(MAX_PITCH), flat * Math.tan(MAX_PITCH));
    if (flat > 0.02) {
      lookPoint.addVectors(camera.position, lookDirection);
      lookMatrix.lookAt(camera.position, lookPoint, camera.up);
      lookQuaternion.setFromRotationMatrix(lookMatrix);
      focus.look.slerp(lookQuaternion, 1 - Math.exp(-dt * (isOnPath ? FOLLOW_RATE : SETTLE_RATE)));
    }
    // 끝자리에서만 당긴다. 쥔 동안은 이 층만 시야각을 쓴다(이동 훅은 카메라 주인이 있으면 손대지 않는다)
    if (!isOnPath && request.fovScale !== undefined && request.fovScale !== 1) {
      const zoomed = smoothstepRange(0, ZOOM_SECONDS, sinceArrived);
      setFov(camera, THREE.MathUtils.lerp(focus.homeFov, focus.homeFov * request.fovScale, zoomed));
    }
    const shake = (request.shake?.() ?? 0) * SHAKE_ANGLE;
    shakeEuler.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    camera.quaternion.copy(focus.look).multiply(shakeQuaternion.setFromEuler(shakeEuler));
    if (!isOnPath && now >= request.holdUntil() && sinceArrived >= (request.minHoldSeconds ?? 0)) {
      camera.quaternion.copy(focus.look);
      if (request.returnHome && !request.finalPosition) {
        focus.returnElapsed = focus.elapsed;
        focus.returnFrom.copy(focus.look);
        focus.returnFov = camera.fov;
        return;
      }
      // 처음 보던 쪽으로 돌아가지 않는다. 지금 보는 자리에서 그대로 조작을 돌려준다(당긴 시야는 이동 훅이 천천히 푼다).
      handOverView(request.finalPosition ? [camera.position.x, camera.position.z] : null);
      finish();
    }
  });

  function finish() {
    const request = active.current?.request;
    active.current = null;
    releaseCamera(CAMERA_OWNER);
    endCutscene();
    request?.onFinish?.();
  }

  return null;
}

function setFov(camera: THREE.PerspectiveCamera, fov: number) {
  if (!camera.isPerspectiveCamera || Math.abs(camera.fov - fov) < 1e-3) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}
