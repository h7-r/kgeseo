// 손목뼈 → 주먹 한가운데 오프셋을 리그에서 재 온다.
//   손뼈(hand_l/r) 원점은 손목이라, 든 물건을 거기 두면 주먹이 아니라 팔목에 붙는다.
//   이건 취향이 아니라 리그가 정한 사실이라 Leva 값으로 두지 않는다. 뼈 로컬 좌표라 체형 슬라이더로
//   배율이 바뀌어도 그대로고, 쓰는 쪽은 `bone.localToWorld(v.copy(offset))` 한 줄이면 된다.
// 정점이 5만 개가 넘어 손 둘에 40만 번을 돈다. 지오메트리는 SkeletonUtils.clone 이 공유하므로
// uuid 로 캐시해 모델당 한 번만 돈다(아바타 준비는 Leva 값마다 다시 돈다).
import * as THREE from "three";

type HandBone = "hand_l" | "hand_r";

const fistCache = new Map<string, THREE.Vector3 | null>();
const chestCache = new Map<string, number | null>();

// 무게중심의 몇 %를 쥐는 자리로 삼나 — 화면을 보고 고른 값이다.
//   무게중심 그대로(1.0)면 굽힌 손가락 쪽으로 끌려가 머그가 손가락 위에 얹혔다.
//   0.45 · 0.65 · 0.85 · 1.0 을 같은 각도로 찍어 견줘 손가락이 손바닥에 닿는 0.45 를 골랐다.
const GRIP_RATIO = 0.45;

/** 그 뼈에 크게 물린 정점들의 무게중심(× GRIP_RATIO)을 뼈 로컬 좌표로. 없으면 null. */
function computeFistCenter(skin: THREE.SkinnedMesh | null | undefined, boneName: string): THREE.Vector3 | null {
  const geometry = skin?.geometry;
  const position = geometry?.attributes?.position;
  const skinIndex = geometry?.attributes?.skinIndex;
  const skinWeight = geometry?.attributes?.skinWeight;
  if (!skin || !geometry || !position || !skinIndex || !skinWeight) return null;
  const key = `${geometry.uuid}|${boneName}`;
  if (fistCache.has(key)) return fistCache.get(key) ?? null;

  const boneIndex = skin.skeleton.bones.findIndex((bone) => bone.name === boneName);
  if (boneIndex < 0) {
    fistCache.set(key, null);
    return null;
  }
  const vertex = new THREE.Vector3();
  const sum = new THREE.Vector3();
  let totalWeight = 0;
  for (let i = 0; i < position.count; i += 1) {
    let weight = 0;
    for (let k = 0; k < 4; k += 1)
      if (skinIndex.getComponent(i, k) === boneIndex) weight += skinWeight.getComponent(i, k);
    // 0.5 미만은 그 뼈가 주인이 아니다(손목 이음매에 절반씩 물린 정점들)
    if (weight < 0.5) continue;
    // 정점은 바인드 포즈 모델 좌표라 바인드 역행렬로 옮기면 뼈 로컬이 된다
    vertex.fromBufferAttribute(position, i).applyMatrix4(skin.skeleton.boneInverses[boneIndex]);
    sum.addScaledVector(vertex, weight);
    totalWeight += weight;
  }
  const value = totalWeight > 0 ? sum.divideScalar(totalWeight).multiplyScalar(GRIP_RATIO) : null;
  fistCache.set(key, value);
  return value;
}

/**
 * 가슴 반두께 — 어깨 중앙선에서 가슴 앞면까지(모델 좌표).
 * 든 물건이 몸을 안 뚫게 손을 밀어낼 양이다. 걷기 캡슐 반경(0.6)은 어깨 폭까지 든 값이라 과하다.
 * 어깨 높이 근처 얇은 판의 몸통 정점 중 z 최댓값을 본다 — 체형 모프로 몸이 두꺼워지면 따라간다.
 */
export function measureChestHalfDepth(
  skin: THREE.SkinnedMesh | null | undefined,
  shoulderY: number,
  shoulderZ: number,
): number | null {
  const geometry = skin?.geometry;
  const position = geometry?.attributes?.position;
  if (!geometry || !position) return null;
  const key = geometry.uuid;
  if (chestCache.has(key)) return chestCache.get(key) ?? null;
  const vertex = new THREE.Vector3();
  let maxZ = -Infinity;
  const top = shoulderY + 0.02;
  // 어깨에서 가슴까지
  const bottom = shoulderY - 0.18;
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    if (vertex.y < bottom || vertex.y > top) continue;
    // 팔은 빼고 몸통만
    if (Math.abs(vertex.x) > 0.16) continue;
    if (vertex.z > maxZ) maxZ = vertex.z;
  }
  const value = Number.isFinite(maxZ) ? maxZ - shoulderZ : null;
  chestCache.set(key, value);
  return value;
}

export type FistCenters = Partial<Record<HandBone, THREE.Vector3>>;

/** 양손을 한 번에. 없는 뼈는 열쇠가 안 생긴다. */
export function computeFistCenters(skin: THREE.SkinnedMesh | null | undefined): FistCenters {
  const centers: FistCenters = {};
  (["hand_l", "hand_r"] as const).forEach((name) => {
    const center = computeFistCenter(skin, name);
    if (center) centers[name] = center;
  });
  return centers;
}
