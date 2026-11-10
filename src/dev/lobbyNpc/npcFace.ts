// 상주쌤 얼굴 가중치(_face) — 뼈대 붙인 쌤 메시(RiggedNpc)에 단다.
// _face: 목 줄 근처에서 0→1 로 오르는 머리 영역 — 툰 셰이더가 이 정점들의 법선을 머리 중심 구 쪽으로 눕힌다.
// faceBack > 0: 머리 앞쪽 위주(옆얼굴 · 귀는 반쯤, 뒤통수는 0) — 09·10회차 Codex.
// 좌표는 메시 로컬(묶은 자세): 위 +Y, 얼굴 +Z.
import * as THREE from "three";

export function computeNpcFace(geometry: THREE.BufferGeometry, headFrac: number, faceBack: number) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const height = box.max.y - box.min.y;
  const neckY = box.max.y - height * headFrac;
  const pos = geometry.getAttribute("position");
  const face = new Float32Array(pos.count);
  const head = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    if (pos.getY(i) > neckY) head.expandByPoint(p.fromBufferAttribute(pos, i));
  }
  const centre = head.getCenter(new THREE.Vector3());
  const depth = head.max.z - head.min.z;
  for (let i = 0; i < pos.count; i += 1) {
    face[i] = THREE.MathUtils.smoothstep(pos.getY(i), neckY - height * 0.01, neckY + height * 0.03);
    if (faceBack > 0) face[i] *= THREE.MathUtils.smoothstep(pos.getZ(i), centre.z - depth * 0.1, centre.z + depth * 0.2);
  }
  /** 툰 구 중심(메시 로컬) — 머리 가운데에서 키×faceBack 만큼 뒤로 */
  const sphereCentre = new THREE.Vector3(centre.x, centre.y, centre.z - height * faceBack);
  return { face, centre, height, sphereCentre };
}
