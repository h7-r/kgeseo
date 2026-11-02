/**
 * sceneIsolation.ts — 씬(공간) 고립 (10/15 미르: 「실내 공간은 씬별로 골라 들어가고, 그 씬을 편집·둘러보는 동안
 *   다른 씬이 같이 보이거나 넘어가면 안 된다 — 작업 몰입도가 떨어진다」)
 *
 * 고른 씬의 경계(sceneScope.bounds, 미터·여유 포함) 밖은
 *   ① 그리지 않는다 — 렌더러 전역 잘림면 4장(세계 X·Z 세로 벽). 땅·무리·공개 에셋·건물이 모두 같이 잘린다.
 *      바깥은 배경색(하늘색)만 남는다. 원경판·산도 잘린다(실내 씬을 기준으로 둔 선택).
 *   ② 못 넘어간다 — 카메라 X·Z 를 경계 안으로 당긴다(clampCameraXZ). 높이는 묶지 않는다(부감 Tab 용).
 *   ③ 못 집는다 — 경계 밖 맞음은 버린다(isInsideActive).
 *   ※ 툰 외곽선(drei <Outlines>)은 ShaderMaterial 이라 clipping=false 면 잘림면을 무시해 경계 밖에 검은 껍데기만 남는다
 *     → 고립 중에는 maintainIsolation(scene) 이 1초쯤마다 장면을 훑어 잘림 조각이 든 ShaderMaterial 의 clipping 을 켠다
 *       (한 번 켜면 그대로 둔다 — 잘림면이 없으면 셰이더에서 아무 일도 안 한다).
 * 쓰는 곳: 5174 [E] 통합 편집 모드(서랍 「공간」 줄) · 5180 검수 작업대 씬 탭(ReviewBridge).
 *
 * 지금 나주 맵은 야외라 씬끼리 구역이 겹친다(S1·S4 = Z1·Z2). 실내 씬이 들어오면 씬 → 방 경계 표만 바꾸면 된다.
 */
import * as THREE from "three";

import { UNITS_PER_METER, type Range } from "../plan/sitePlan";

export type IsolationBounds = { x: Range; z: Range };

const planes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane(), new THREE.Plane()];
const NONE: THREE.Plane[] = [];
let active: IsolationBounds | null = null;
let renderer: THREE.WebGLRenderer | null = null;

/** 경계를 걸거나(null 이면) 푼다 — 같은 렌더러에 한 번에 하나 */
export function isolate(gl: THREE.WebGLRenderer, bounds: IsolationBounds | null) {
  if (renderer && renderer !== gl) renderer.clippingPlanes = NONE;
  renderer = gl;
  active = bounds;
  patchTick = 0; // 걸자마자 한 번 훑는다
  if (!bounds) {
    gl.clippingPlanes = NONE;
    return;
  }
  const U = UNITS_PER_METER;
  // 평면 법선 쪽(거리 ≥ 0)이 남는다
  planes[0].set(new THREE.Vector3(1, 0, 0), -bounds.x[0] * U);
  planes[1].set(new THREE.Vector3(-1, 0, 0), bounds.x[1] * U);
  planes[2].set(new THREE.Vector3(0, 0, 1), -bounds.z[0] * U);
  planes[3].set(new THREE.Vector3(0, 0, -1), bounds.z[1] * U);
  gl.clippingPlanes = planes;
}

export const activeIsolation = () => active;

/** 세계 좌표(장면 단위) 점이 고립 경계 안인가 — 경계가 없으면 늘 참 */
export function isInsideActive(point: THREE.Vector3) {
  if (!active) return true;
  const x = point.x / UNITS_PER_METER;
  const z = point.z / UNITS_PER_METER;
  return x >= active.x[0] && x <= active.x[1] && z >= active.z[0] && z <= active.z[1];
}

/** 카메라 X·Z 를 경계 안(가장자리 1 m 안쪽)으로 — 옮겼으면 true */
export function clampCameraXZ(camera: THREE.Camera): boolean {
  if (!active) return false;
  const U = UNITS_PER_METER;
  const pad = 1;
  const x = Math.min(active.x[1] - pad, Math.max(active.x[0] + pad, camera.position.x / U)) * U;
  const z = Math.min(active.z[1] - pad, Math.max(active.z[0] + pad, camera.position.z / U)) * U;
  if (Math.abs(x - camera.position.x) < 1e-6 && Math.abs(z - camera.position.z) < 1e-6) return false;
  camera.position.x = x;
  camera.position.z = z;
  camera.updateMatrixWorld();
  return true;
}

const PATCH_EVERY_FRAMES = 60;
let patchTick = 0;
const patched = new WeakSet<THREE.Material>();

/** 매 프레임 불러도 된다 — 고립 중일 때만, 60 프레임에 한 번 외곽선 재질의 잘림을 켠다 */
export function maintainIsolation(scene: THREE.Scene) {
  if (!active || patchTick++ % PATCH_EVERY_FRAMES) return;
  scene.traverse((node) => {
    const material = (node as THREE.Mesh).material;
    if (!material) return;
    for (const one of Array.isArray(material) ? material : [material]) {
      if (patched.has(one)) continue;
      patched.add(one);
      const shader = one as THREE.ShaderMaterial;
      if (!shader.isShaderMaterial || shader.clipping) continue;
      if (!/clipping_planes_(pars_)?vertex/.test(shader.vertexShader ?? "")) continue;
      shader.clipping = true;
      shader.needsUpdate = true;
    }
  });
}
