// 접지 IK — 낮은 발은 땅에 붙고(아래 지면 맞추기), 다른 발이 접지 직전이면 엉덩이+무릎 2본 IK 로 그 발을
// 수직으로 땅까지 내린다. 리타게팅 클립은 앞발이 땅에 못 닿은 채 딛는다 — '앞발이 높은 곳을 딛는' 것과
// '다리가 안 펴지는' 것의 같은 원인이다. 무릎만 펴면 발이 앞·위로 가서 엉덩이까지 푼다.
// 스윙 중인 발은 건드리지 않는다(창을 넓히면 공중 다리를 붙잡아 곧게 뻗는다). Tripo 클립은 끈다.
import * as THREE from "three";

import { LOCOMOTION_CLIPS, TRIPO_CORRECTION } from "./motionCorrection";
import type { Leg, PreparedBody, Side, Sole } from "./preparedBody";
import { rotateInWorld } from "./rig";

export interface FootContactDebug {
  other: Side;
  gap: number;
  weight: number;
  frontShare: number;
  isAhead: boolean;
}

/** 아바타마다 하나. 프레임을 넘어 남는 값과 그릇이다. */
export interface FootContactState {
  // IK 가 만진 다리 뼈의 클립 자세 보관함. 믹서는 값이 지난 프레임과 같으면 본에 안 쓰므로(정지·검증시각)
  // 안 쓴 프레임엔 되돌려야 IK 가 누적되지 않는다(0.7cm 요청이 몇 프레임 뒤 14cm 에서 포화).
  legStore: Map<THREE.Bone, { clip: THREE.Quaternion; ik: THREE.Quaternion | null }>;
  // IK 양의 지난 프레임 값 — 시간 평활용.
  smooth: Record<Side, { lift: number; drop: number }>;
  debug: FootContactDebug | null;
  H: THREE.Vector3;
  K: THREE.Vector3;
  F: THREE.Vector3;
  F2: THREE.Vector3;
  T: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  n: THREE.Vector3;
  pq: THREE.Quaternion;
  wq: THREE.Quaternion;
  worldSide: THREE.Vector3;
}

export function createFootContactState(): FootContactState {
  const [H, K, F, F2, T, u, v, n] = Array.from({ length: 8 }, () => new THREE.Vector3());
  return {
    legStore: new Map(),
    smooth: { l: { lift: 0, drop: 0 }, r: { lift: 0, drop: 0 } },
    debug: null,
    H,
    K,
    F,
    F2,
    T,
    u,
    v,
    n,
    pq: new THREE.Quaternion(),
    wq: new THREE.Quaternion(),
    worldSide: new THREE.Vector3(1, 0, 0),
  };
}

/** 보이는 밑창 정점(인덱스 목록, step 칸마다) 중 가장 낮은 높이(모델 좌표). 스키닝 결과를 읽는다. */
export function lowestSoleY(
  soles: Sole[],
  pick: (sole: Sole) => number[],
  step: number,
  inverseModel: THREE.Matrix4,
  point: THREE.Vector3,
): number {
  let y = Infinity;
  soles.forEach((sole) => {
    const { object } = sole;
    if (!object.visible) return;
    const list = pick(sole);
    for (let i = 0; i < list.length; i += step) {
      object.getVertexPosition(list[i], point);
      object.localToWorld(point).applyMatrix4(inverseModel);
      y = Math.min(y, point.y);
    }
  });
  return y;
}

function solveLeg(fc: FootContactState, group: THREE.Object3D, { thigh, calf, foot }: Leg, worldOffset: number) {
  const { H, K, F, F2, T, u, v, n, pq, wq, worldSide } = fc;
  for (let pass = 0; pass < 3; pass += 1) {
    H.setFromMatrixPosition(thigh.matrixWorld);
    K.setFromMatrixPosition(calf.matrixWorld);
    F.setFromMatrixPosition(foot.matrixWorld);
    if (pass === 0) T.copy(F).setY(F.y + worldOffset);
    const L1 = H.distanceTo(K);
    const L2 = K.distanceTo(F);
    const d = THREE.MathUtils.clamp(H.distanceTo(T), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
    // 무릎 안쪽 각: 목표 거리에 맞는 값과 지금 값의 차이만큼 돌린다.
    const goalAngle = Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    u.copy(H).sub(K).normalize();
    v.copy(F).sub(K).normalize();
    const currentAngle = Math.acos(THREE.MathUtils.clamp(u.dot(v), -1, 1));
    n.crossVectors(u, v);
    if (n.lengthSq() < 1e-8) n.copy(worldSide).applyQuaternion(group.quaternion);
    n.normalize();
    const rotate = (bone: THREE.Bone, axis: THREE.Vector3, angle: number) => {
      wq.setFromAxisAngle(axis, angle);
      rotateInWorld(bone, wq, pq);
    };
    // 거리만 보면 거의 뻗은 다리가 뒤로 꺾인 채 통과한다(무릎 6°→81°). 무릎은 반드시 몸 앞(+z)으로.
    const kneeForward = () => {
      K.setFromMatrixPosition(calf.matrixWorld);
      F2.setFromMatrixPosition(foot.matrixWorld);
      u.copy(K).sub(v.copy(H).add(F2).multiplyScalar(0.5));
      v.set(0, 0, 1).applyQuaternion(group.quaternion);
      return u.dot(v);
    };
    rotate(calf, n, goalAngle - currentAngle);
    F2.setFromMatrixPosition(foot.matrixWorld);
    if (Math.abs(H.distanceTo(F2) - d) > 1e-3 || kneeForward() < 0) {
      rotate(calf, n, -2 * (goalAngle - currentAngle));
      F2.setFromMatrixPosition(foot.matrixWorld);
      if (Math.abs(H.distanceTo(F2) - d) > 1e-3 && kneeForward() < 0) {
        // 어느 쪽으로도 앞무릎이 안 나오면(축이 어긋남) 원래대로 두고 포기한다.
        rotate(calf, n, goalAngle - currentAngle);
        F2.setFromMatrixPosition(foot.matrixWorld);
      }
    }
    // 엉덩이: 발이 목표를 향하도록 다리 전체를 돌린다.
    u.copy(F2).sub(H).normalize();
    v.copy(T).sub(H).normalize();
    wq.setFromUnitVectors(u, v);
    rotateInWorld(thigh, wq, pq);
  }
}

interface FootContactFrame {
  prepared: PreparedBody;
  group: THREE.Object3D;
  action: THREE.AnimationAction | undefined;
  /** 이번 프레임에 고른 클립 이름 */
  next: string;
  delta: number;
  avatarScale: number;
  inverseModel: THREE.Matrix4;
  point: THREE.Vector3;
}

/** 손목 맞춤 뒤, 지면 맞추기 앞에 부른다. inverseModel 은 이번 프레임 모델 행렬의 역이어야 한다. */
export function applyFootContact(
  fc: FootContactState,
  { prepared, group, action, next, delta, avatarScale, inverseModel, point }: FootContactFrame,
) {
  const useFootContact = prepared.tripoClips.includes(next)
    ? TRIPO_CORRECTION.footContactEnabled !== false
    : prepared.correction?.footContactEnabled !== false;
  if (!(useFootContact && prepared.legs.length === 2 && prepared.pelvisBone)) return;
  const legStore = fc.legStore;
  // 믹서가 이번 프레임에 뼈를 썼으면(남긴 IK 값과 다르면) 그게 클립 자세, 안 썼으면 보관한 클립 자세로 되돌린다.
  prepared.legs.forEach((leg) =>
    [leg.thigh, leg.calf].forEach((bone) => {
      let entry = legStore.get(bone);
      if (!entry) {
        entry = { clip: bone.quaternion.clone(), ik: null };
        legStore.set(bone, entry);
      } else if (entry.ik && bone.quaternion.equals(entry.ik)) bone.quaternion.copy(entry.clip);
      else entry.clip.copy(bone.quaternion);
    }),
  );
  prepared.legs.forEach((leg) => {
    leg.thigh.updateMatrixWorld(true);
  });
  prepared.targetSkin.skeleton.update();
  // 발마다 발바닥 최저점(모델 좌표).
  const heights = prepared.legs.map((leg) =>
    lowestSoleY(prepared.soles, (sole) => (leg.side === "l" ? sole.left : sole.right), 3, inverseModel, point),
  );
  const lower = heights[0] <= heights[1] ? 0 : 1;
  const other = 1 - lower;
  // 모델 단위
  const gap = heights[other] - heights[lower];
  const contactWindow = (prepared.correction?.footContactWindow ?? 0.045) * 1.45;
  const leg = prepared.legs[other];
  // 골반보다 앞에 있는(다가오는) 발만 — 빼면 떼는 뒷발이 창에 걸려 뒷다리가 꺾인다.
  point.setFromMatrixPosition(leg.foot.matrixWorld).applyMatrix4(inverseModel);
  const footZ = point.z;
  point.setFromMatrixPosition(prepared.pelvisBone.matrixWorld).applyMatrix4(inverseModel);
  // 문턱은 전부 부드러운 가중치 — 딱딱한 on/off 는 양발 지지에서 IK 가 켜졌다 꺼져 몸이 떨린다.
  const aheadWeight = THREE.MathUtils.smoothstep(footZ - point.z, 0.01, 0.03);
  const isAhead = aheadWeight > 0.001;
  const gapWeight =
    THREE.MathUtils.smoothstep(gap, 0.002, 0.008) *
    (1 - THREE.MathUtils.smoothstep(gap, contactWindow * 0.7, contactWindow));
  // 접지 시각 창: 평평하게 붙는 시각의 25% 전 ~ 3% 후. 그 안에서 가중치를 0→1→0 으로 매끄럽게 —
  // 온/오프면 닿는 순간 다리가 '탁' 펴진다. 접근(앞다리가 엉덩이로 내린다) 뒤 하중(디딘 다리를 굽혀 골반을 내린다).
  let contactWeight = 0;
  // 접근 1 → 하중 0
  let frontShare = 0;
  if (action && LOCOMOTION_CLIPS.has(next)) {
    const times = prepared.contactTimeFor(next);
    const duration = action.getClip().duration || 1;
    if (times) {
      const phase = (((action.time % duration) + duration) % duration) / duration;
      // 붙는 시각 기준 0~1
      const sinceContact = (((phase - times[leg.side]) % 1) + 1) % 1;
      if (sinceContact >= 0.72) {
        contactWeight = THREE.MathUtils.smoothstep(sinceContact, 0.72, 0.82);
        frontShare = 1 - THREE.MathUtils.smoothstep(sinceContact, 0.8, 0.9);
      } else if (sinceContact <= 0.06) {
        contactWeight = 1 - THREE.MathUtils.smoothstep(sinceContact, 0.0, 0.06);
        frontShare = 0;
      }
    }
  }
  const inContact = contactWeight > 0.001;
  if (import.meta.env.DEV) {
    fc.debug = {
      other: leg.side,
      gap: +gap.toFixed(4),
      weight: +contactWeight.toFixed(2),
      frontShare: +frontShare.toFixed(2),
      isAhead,
    };
  }
  // 이번 프레임 목표량. 조건 밖이면 0 — 아래 평활이 0 으로 미끄러진다.
  const goal: Record<Side, { lift: number; drop: number }> = { l: { lift: 0, drop: 0 }, r: { lift: 0, drop: 0 } };
  if (inContact && isAhead && gap > 0) {
    // 틈을 두 다리가 나눈다. 앞다리만 내리면 무릎이 2° 로 잠기고, 디딘 다리만 올리면 80° 로 꺾인다.
    // 앞다리 몫엔 낮은 상한을 두고 남는 틈은 둔다(원본도 뒤꿈치 접지 때 1cm 떠 있다).
    const weight = contactWeight * aheadWeight * gapWeight;
    const limit = (prepared.correction?.footContactDrop ?? 0.03) * 1.45 * weight;
    const frontLimit = (prepared.correction?.footContactFrontLimit ?? 0.015) * 1.45 * weight * frontShare;
    goal[leg.side].drop = Math.min(gap, frontLimit);
    goal[prepared.legs[lower].side].lift = Math.min(gap - goal[leg.side].drop, limit);
  }
  // 시간 평활(시정수 40ms) — 남은 프레임 단위 꺾임(무릎 2~5°)을 누른다.
  const smooth = fc.smooth;
  const rate = 1 - Math.exp(-Math.max(0, delta) / 0.04);
  prepared.legs.forEach((l) => {
    smooth[l.side].lift += (goal[l.side].lift - smooth[l.side].lift) * rate;
    smooth[l.side].drop += (goal[l.side].drop - smooth[l.side].drop) * rate;
  });
  prepared.legs.forEach((l) => {
    if (smooth[l.side].lift > 1e-5) solveLeg(fc, group, l, smooth[l.side].lift * avatarScale);
    if (smooth[l.side].drop > 1e-5) solveLeg(fc, group, l, -smooth[l.side].drop * avatarScale);
  });
  prepared.targetSkin.skeleton.update();
  // IK 결과를 남겨 다음 프레임에 믹서가 썼는지 판별한다.
  prepared.legs.forEach((l) =>
    [l.thigh, l.calf].forEach((bone) => {
      const entry = legStore.get(bone);
      if (entry) entry.ik = (entry.ik ?? new THREE.Quaternion()).copy(bone.quaternion);
    }),
  );
}
