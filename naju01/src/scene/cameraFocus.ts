/**
 * 화면 고정 — 퍼즐이 풀리는 순간 카메라가 그 자리를 바라본다(본부실 자판기 컷신과 같은 셈).
 * 자리는 그대로 두고 시선만 돌린다. 1인칭이라 카메라 자리가 곧 몸이라, 자리를 옮기면 걷기 판정이 어긋난다.
 * 거는 동안 걷기·점프·마우스·겨냥이 멈추고, 끝나면 돌아가지 않고 그 시선 그대로 조작을 돌려준다.
 * 걷기 훅(useTerrainMovement)이 매 프레임 끝에 applyCameraFocus 를 부른다.
 * 시간은 벽시계가 아니라 프레임 시간을 쌓는다 — 물굴처럼 처음 그릴 때 몇 초 멈추는 자리에서 벽시계로 재면 고정이 통째로 지나간다.
 */
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";

export interface CameraFocusRequest {
  /** 같은 이름이 걸려 있으면 다시 걸지 않는다 */
  id: string;
  /** 바라볼 자리(유닛). 움직이는 것은 함수로 */
  target: THREE.Vector3 | (() => THREE.Vector3);
  /** 바라보고 머무는 시간(초) */
  hold: number;
  /** 돌아보는 시간 · 끝난 뒤 당긴 시야를 풀어 주는 시간(초) */
  turnIn?: number;
  turnOut?: number;
  /** 시야각 배율 — 1 보다 작으면 당겨 본다 */
  zoom?: number;
  /** 다른 고정이 걸려 있어도 이어서 건다(시선은 지금 자리에서 이어진다) */
  replace?: boolean;
  /** 머물기가 끝나면 돌아오지 않고 바로 이어 볼 곳 */
  then?: CameraFocusRequest;
  /**
   * 끝나면(turnOut 동안) 이 고정을 건 때 보던 쪽으로 돌아온다 — 지나가며 한 번 보여 주는 것(석실 벽화)이 플레이어의 걷던 방향을
   * 빼앗지 않게(미르 11/10). 기본은 지금처럼 그 시선 그대로 둔다. 이어 걸면(then · replace) 이어 건 고정을 건 때가 기준이다
   */
  returnHome?: boolean;
}

interface ActiveFocus extends Required<Omit<CameraFocusRequest, "replace" | "then">> {
  then: CameraFocusRequest | null;
  /** 돌아보기 시작할 때의 시야각 — 이어 걸 때 지금 값에서 이어진다 */
  fromFov: number;
  /** 걸린 뒤 흐른 프레임 시간(초) */
  elapsed: number;
  /** 돌아보기 시작할 때의 시선 · 원래 시야각 */
  from: THREE.Quaternion;
  homeFov: number;
  /** returnHome — 돌아오기 시작한 때의 시선 */
  outFrom: THREE.Quaternion | null;
}

/** 한 프레임에 흘려보낼 최대 시간(초) — 멈췄다 돌아온 프레임이 연출을 건너뛰지 않게 */
const MAX_FRAME_SECONDS = 1 / 30;

const settings = { enabled: true };
let active: ActiveFocus | null = null;
const lookMatrix = new THREE.Matrix4();
const lookQuaternion = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export const isCameraFocused = () => active !== null;
/** 지금 걸린 고정의 이름(없으면 null) — 고정을 건 쪽이 제 고정인지 알아본다 */
export const cameraFocusId = () => active?.id ?? null;
/** 그 이름의 고정이 다 돌아봤다(머무는 중) — 연출이 돌아보기를 마친 뒤 시작하게 */
export const isCameraFocusTurned = (id: string) => active?.id === id && active.elapsed >= active.turnIn;

/** 건다. 이미 다른 고정이 걸려 있으면 replace 일 때만 이어 건다 */
export function focusCamera(request: CameraFocusRequest) {
  if (!settings.enabled) return false;
  if (active && (active.id === request.id || !request.replace)) return false;
  const camera = currentCamera;
  if (!camera) return false;
  const homeFov = active ? active.homeFov : camera.fov;
  active = {
    id: request.id,
    target: request.target,
    hold: request.hold,
    turnIn: request.turnIn ?? 0.8,
    turnOut: request.turnOut ?? 0.7,
    zoom: request.zoom ?? 1,
    elapsed: 0,
    then: request.then ?? null,
    returnHome: request.returnHome ?? false,
    fromFov: camera.fov,
    from: camera.quaternion.clone(),
    homeFov,
    outFrom: null,
  };
  return true;
}

/**
 * 그 이름의 고정이면 머물기를 여기서 끝낸다 — 당긴 시야를 turnOut 동안 풀고 조작을 돌려준다(이어 볼 곳은 버린다).
 * 대사처럼 끝나는 때를 미리 모르는 쪽이 hold 를 넉넉히 걸고 이걸로 끝낸다. 돌아보는 중이면 다 돌아본 뒤 바로 푼다.
 */
export function endCameraFocus(id: string) {
  if (!active || active.id !== id) return;
  active.hold = Math.max(0, active.elapsed - active.turnIn);
  active.then = null;
}

/** 걸린 고정을 바로 푼다 — 시선은 그 자리에 둔다(자리는 안 옮긴다) */
export function cancelCameraFocus() {
  if (!active) return;
  if (currentCamera) setFov(currentCamera, active.homeFov);
  active = null;
}

let currentCamera: THREE.PerspectiveCamera | null = null;

function setFov(camera: THREE.PerspectiveCamera, fov: number) {
  if (Math.abs(camera.fov - fov) < 1e-3) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

function lookToward(camera: THREE.Camera, target: THREE.Vector3) {
  lookMatrix.lookAt(camera.position, target, UP);
  return lookQuaternion.setFromRotationMatrix(lookMatrix);
}

/** 걷기 훅이 매 프레임 끝에 — 걷기가 자리를 정한 뒤 시선을 덮어쓴다 */
export function applyCameraFocus(camera: THREE.Camera, dt: number) {
  currentCamera = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera) : null;
  if (!active || !currentCamera) return;
  const focus = active;
  focus.elapsed += Math.min(dt, MAX_FRAME_SECONDS);
  const since = focus.elapsed;
  const target = typeof focus.target === "function" ? focus.target() : focus.target;
  const look = lookToward(camera, target);
  const zoomed = focus.homeFov * focus.zoom;

  if (since < focus.turnIn) {
    const s = THREE.MathUtils.smootherstep(since / focus.turnIn, 0, 1);
    camera.quaternion.slerpQuaternions(focus.from, look, s);
    setFov(currentCamera, THREE.MathUtils.lerp(focus.fromFov, zoomed, s));
    return;
  }
  if (since < focus.turnIn + focus.hold) {
    // 움직이는 것을 볼 때 떨리지 않게 살짝 늦게 따라간다
    camera.quaternion.slerp(look, 1 - Math.exp(-Math.min(dt, MAX_FRAME_SECONDS) * 9));
    setFov(currentCamera, zoomed);
    return;
  }
  if (focus.then) {
    focusCamera({ ...focus.then, replace: true });
    return;
  }
  // 시선은 그 자리에 두고 당겼던 시야만 푼다. 원래 보던 쪽으로 돌아가지 않는다(returnHome 이면 돌아온다).
  const s = focus.turnOut > 0 ? Math.min(1, (since - focus.turnIn - focus.hold) / focus.turnOut) : 1;
  if (focus.returnHome) {
    if (!focus.outFrom) focus.outFrom = camera.quaternion.clone();
    camera.quaternion.slerpQuaternions(focus.outFrom, focus.from, THREE.MathUtils.smootherstep(s, 0, 1));
  }
  setFov(currentCamera, THREE.MathUtils.lerp(zoomed, focus.homeFov, THREE.MathUtils.smootherstep(s, 0, 1)));
  if (s >= 1) active = null;
}

exposeDevHook("najuCameraFocus", {
  isActive: isCameraFocused,
  current: () => active && { id: active.id, since: +active.elapsed.toFixed(2) },
  cancel: cancelCameraFocus,
  camera: () => currentCamera,
  /** 검사 스크립트가 화면을 비교할 때 끈다 */
  setEnabled: (value: boolean) => {
    settings.enabled = value;
    if (!value) cancelCameraFocus();
  },
});
