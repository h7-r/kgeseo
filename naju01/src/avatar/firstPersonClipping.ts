// 1인칭 「몸만」 — 아래를 보면 배·다리가 보여야 "내가 거기 서 있다"가 된다. 머리만 접으면 목·가슴이 남아
// 물건을 들 때 머리 잘린 몸통이 비쳤다. 상용 1인칭처럼 카메라 앞쪽만 그린다(재질 clippingPlanes, 세계 좌표).
// 높이로 자르면 위로 뻗은 손이 같이 잘려 시선축으로 자른다. 올려다볼 때를 위해 머리 접기도 둔다.
// 그림자는 안 자른다(clipShadows 기본 false) — 몸은 실제로 거기 있다.
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";

//   near = m, 카메라에서 이만큼 앞부터 그린다. 0.32 는 손가락이 껍질처럼 잘렸고, 0.16 이면 손은 온전하고 목 단면도 안 보인다.
//   bodyBack = m, 「몸만」일 때 몸을 뒤로 물리는 거리. 물리면 팔 길이 제한에 든 물건이 화면 밖으로 내려가 0 으로 둔다.
//   crouchNear = m, 앉았을 때의 near. 앉으면 몸이 앞으로 숙여(Crouch 클립) 가슴·등이 면 앞에 놓이고 안쪽 등판이
//     비쳤다. 그때만 면을 더 밀어 몸통까지 자른다. 손·팔뚝은 그보다 앞이라 남는다.
//   showBody = 1인칭에서 내 몸을 그릴까. 기본 끔 — 카메라가 몸 안에 있어 어느 자세든 잘린 단면이 비친다.
//     손만 남기려면 손 뼈 가중치 마스크(에셋·셰이더 작업)가 필요하다. 든 물건은 카메라 기준으로 따로 그려진다.
//   콘솔에서 바로 맞춘다: `__game.clipping.crouchNear = 0.4`, `__game.clipping.showBody = true`
export const CLIPPING = { near: 0.16, crouchNear: 0.34, bodyBack: 0, showBody: false };
exposeDevHook("clipping", CLIPPING);
const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);
const CLIP_PLANES = [clipPlane];
const _clipForward = new THREE.Vector3();
const _clipPoint = new THREE.Vector3();

/** 그룹 아래 모든 재질에 잘림면을 붙인다. 개수가 바뀌면 셰이더를 다시 컴파일하므로 붙여 두고 평면 자리만 옮긴다. */
export function attachClipPlanes(group: THREE.Object3D) {
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    if (Array.isArray(m)) m.forEach((one) => (one.clippingPlanes = CLIP_PLANES));
    else m.clippingPlanes = CLIP_PLANES;
  });
}

/** 1인칭: 시선축에 수직인 평면을 카메라 앞 near 에 세우고 그 뒤를 버린다. */
export function updateClipPlane(camera: THREE.Camera, bodyOnly: boolean, crouching: boolean, scale: number) {
  if (bodyOnly) {
    camera.getWorldDirection(_clipForward);
    const near = crouching ? CLIPPING.crouchNear : CLIPPING.near;
    _clipPoint.copy(camera.position).addScaledVector(_clipForward, near * scale);
    clipPlane.normal.copy(_clipForward);
    // 평면식 n·p + c = 0. c = −n·q 면 q 뒤가 잘린다.
    clipPlane.constant = -_clipForward.dot(_clipPoint);
  } else {
    // 상수를 크게 두면 늘 앞쪽이라 아무것도 안 자른다.
    clipPlane.constant = 1e6;
  }
}
