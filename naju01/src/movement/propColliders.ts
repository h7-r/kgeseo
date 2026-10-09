// 인스턴스 무리에서 원기둥 목록을 뽑는다 — 걸을 때 막는 것(소품 충돌)과 3인칭 카메라를 막는 것(카메라 가림).
// 지형의 blockedAt 은 도면 차단물 넷만 알아서 바위·나무·울타리·집은 캐릭터가 그대로 통과했다.
// 표본 경계 상자와 인스턴스 행렬로 XZ 원기둥(미터)을 만든다. 걸을 때 나무는 줄기만 막고(잎은 지나간다),
// 가로대처럼 길쭉한 것은 긴 축을 따라 원을 늘어놓는다. 2 m 격자에 넣어 프레임마다 근처만 본다.

import * as THREE from "three";

import { METERS_PER_UNIT } from "../plan/sitePlan";

/** 충돌을 뽑는 데 필요한 무리 모양(placement/instanceGroups 의 InstanceGroup 이 이 모양을 가진다) */
interface ColliderSourceGroup {
  groupId: string;
  batches: readonly { geometry: THREE.BufferGeometry; matrices: Float32Array }[];
}

interface PropCollider {
  x: number;
  z: number;
  radius: number;
  bottom: number;
  top: number;
  groupId: string;
}

// 무리 이름의 마지막 마디 → 상자 폭 대비 반지름 비율. 없으면 기본값, null 이면 안 막는다.
// 무리 이름은 edits.json 열쇠라 한글 값 그대로다.
const RADIUS_RATIO: Record<string, number | null> = {
  나무: 0.14, // 줄기
  바위덩어리: 0.7,
  비탈바위: 0.7,
  틈바위: 0.7,
  기둥: 0.7,
  가로대: 0.5,
  집: 0.95,
  택촌: 0.95,
  나루터: 0.8,
  나룻배: 0.8,
  돌탑: 0.7,
  천막: 0.85,
  그물틀: 0.6,
  통발: 0.6,
  화톳불: 0.6,
  평상: 0.85,
  솟대: 0.35,
  지게: 0.5,
  물동이: 0.5,
  걸상: 0.6,
  돌무지: 0.7,
  말뚝: 0.4,
  소반: 0.5,
  구렁이: 0.5,
  // 밟고 지나가거나 바닥에 붙은 것들, 헤치고 지나가는 초목
  길가돌: null,
  발치너덜: null,
  디딤돌: null,
  댕기: null,
  부러진가지: null,
  짚신: null,
  흙덩이: null,
  발자국: null,
  배자국: null,
  금줄: null,
  덤불: null,
  잡초: null,
  꽃: null,
  풀: null,
  수풀: null,
  잎더미: null,
  자갈: null,
  절벽틈덤불: null,
  명패: null,
  횃불: null,
};
const DEFAULT_RADIUS_RATIO = 0.6;

// 카메라 가림 — 사람은 헤치고 지나가도 카메라가 그 안에 들어가면 잎 조각이 화면을 덮는다.
// 걷기 표와 다른 것만 적는다. 덤불은 잎이 상자 끝까지 퍼져 있어 폭 전체로, 나무는 줄기가 아니라 잎 덩어리로 본다.
// 발목 높이 풀·꽃은 그대로 무시한다.
const CAMERA_RADIUS_RATIO: Record<string, number | null> = {
  ...RADIUS_RATIO,
  나무: 0.45,
  덤불: 1,
  수풀: 1,
  절벽틈덤불: 1,
};
// 카메라 앞면(near)이 잎을 자르지 않게 두는 여유(m)
const CAMERA_CLEARANCE = 0.3;
const GRID = 2; // m
// 플레이어 반경보다 넉넉히 — 칸 경계 바로 밖의 기둥도 잡힌다
const GRID_MARGIN = 0.8;

function buildCylinders(
  groups: readonly ColliderSourceGroup[] | null | undefined,
  ratios: Record<string, number | null>,
): PropCollider[] {
  const colliders: PropCollider[] = [];
  const box = new THREE.Box3();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3();
  for (const group of groups ?? []) {
    const lastPart = group.groupId.split(".").pop() ?? "";
    const ratio = ratios[lastPart] === undefined ? DEFAULT_RADIUS_RATIO : ratios[lastPart];
    if (ratio === null) continue;
    for (const { geometry, matrices } of group.batches) {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (!geometry.boundingBox) continue;
      box.copy(geometry.boundingBox);
      const size = new THREE.Vector3().subVectors(box.max, box.min);
      const center = new THREE.Vector3().addVectors(box.max, box.min).multiplyScalar(0.5);
      for (let i = 0; i < matrices.length; i += 16) {
        matrix.fromArray(matrices, i).decompose(position, rotation, scale);
        const sx = Math.abs(scale.x),
          sy = Math.abs(scale.y),
          sz = Math.abs(scale.z);
        const height = size.y * sy * METERS_PER_UNIT;
        // 발목 아래는 넘어간다
        if (height < 0.35) continue;
        const across = size.x * sx,
          along = size.z * sz;
        const short = Math.min(across, along),
          long = Math.max(across, along);
        const radius = Math.max(0.12, short * 0.5 * ratio * METERS_PER_UNIT);
        const bottom = (position.y + box.min.y * sy) * METERS_PER_UNIT;
        const top = bottom + height;
        // 길쭉하면 긴 축을 따라 원을 늘어놓는다(울타리 가로대·천막 등)
        const pieces = long / Math.max(short, 1e-3) > 2.2 ? Math.ceil(long / Math.max(short, 1e-3)) : 1;
        axis.set(across >= along ? 1 : 0, 0, across >= along ? 0 : 1);
        for (let k = 0; k < pieces; k++) {
          const t = pieces === 1 ? 0 : (k / (pieces - 1) - 0.5) * (long - short);
          const p = axis
            .clone()
            .multiplyScalar(t)
            .add(new THREE.Vector3(center.x * sx, 0, center.z * sz));
          p.applyQuaternion(rotation).add(position);
          colliders.push({
            x: p.x * METERS_PER_UNIT,
            z: p.z * METERS_PER_UNIT,
            radius,
            bottom,
            top,
            groupId: group.groupId,
          });
        }
      }
    }
  }

  return colliders;
}

/** 원기둥을 2 m 격자에 넣는다. 돌려준 함수는 그 점이 든 칸의 원기둥만 준다. */
function indexByCell(colliders: readonly PropCollider[]) {
  const cells = new Map<string, PropCollider[]>();
  colliders.forEach((c) => {
    const x0 = Math.floor((c.x - c.radius - GRID_MARGIN) / GRID),
      x1 = Math.floor((c.x + c.radius + GRID_MARGIN) / GRID);
    const z0 = Math.floor((c.z - c.radius - GRID_MARGIN) / GRID),
      z1 = Math.floor((c.z + c.radius + GRID_MARGIN) / GRID);
    for (let gx = x0; gx <= x1; gx++)
      for (let gz = z0; gz <= z1; gz++) {
        const key = `${gx},${gz}`;
        let bucket = cells.get(key);
        if (!bucket) cells.set(key, (bucket = []));
        bucket.push(c);
      }
  });
  return (x: number, z: number) => cells.get(`${Math.floor(x / GRID)},${Math.floor(z / GRID)}`);
}

export function buildPropColliders(groups: readonly ColliderSourceGroup[] | null | undefined) {
  const colliders = buildCylinders(groups, RADIUS_RATIO);
  const near = indexByCell(colliders);

  /** 모두 미터. 막히면 그 소품의 무리 이름을 돌려준다. */
  const blockedAt = (px: number, pz: number, y = 0, radius = 0.3) => {
    const nearby = near(px, pz);
    if (!nearby) return null;
    for (const c of nearby) {
      // 발이 소품 꼭대기 근처(25 cm 아래)까지 올라왔으면 올라선 것으로 본다
      if (y > c.top - 0.25 || y < c.bottom - 1.0) continue;
      const dx = px - c.x,
        dz = pz - c.z,
        d = c.radius + radius;
      if (dx * dx + dz * dz < d * d) return c.groupId;
    }
    return null;
  };
  return { blockedAt, count: colliders.length, colliders };
}

/** 3인칭 카메라를 막는 원기둥. occludes(x, y, z) — 모두 미터, 그 점이 소품 안이면 true. */
export function buildCameraOccluders(groups: readonly ColliderSourceGroup[] | null | undefined) {
  const occluders = buildCylinders(groups, CAMERA_RADIUS_RATIO);
  const near = indexByCell(occluders);
  const occludes = (px: number, py: number, pz: number) => {
    const nearby = near(px, pz);
    if (!nearby) return false;
    for (const c of nearby) {
      if (py < c.bottom - CAMERA_CLEARANCE || py > c.top + CAMERA_CLEARANCE) continue;
      const dx = px - c.x,
        dz = pz - c.z,
        d = c.radius + CAMERA_CLEARANCE;
      if (dx * dx + dz * dz < d * d) return true;
    }
    return false;
  };
  return { occludes, count: occluders.length };
}
