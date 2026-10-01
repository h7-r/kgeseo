// 손목뼈 → **주먹 한가운데** 오프셋을 리그에서 재 온다.
//
// [왜 필요한가]
//   손뼈(hand_l/r)의 원점은 **손목**이다. 든 물건을 그 자리에 두면 물건이
//   주먹이 아니라 **팔목에** 붙어서, 손가락 옆을 스쳐 지나간 것처럼 보인다.
//   실제로 머그가 그랬다.
//
// [왜 Leva 값이 아닌가]
//   "손바닥이 어디냐"는 취향이 아니라 **리그가 정한 사실**이다. 체형 슬라이더
//   (팔 길이·손 크기)로 배율이 바뀌어도 이 로컬 좌표는 그대로다.
//   쓰는 쪽에서 `뼈.localToWorld(v.copy(이것))` 한 줄이면 배율·회전이 저절로
//   맞는다 — 스키닝이 하는 계산과 같은 것이라 체형을 바꿔도 안 어긋난다.
//
// [왜 캐시하나 — 성능]
//   정점이 5만 개가 넘는다. 손뼈 둘을 재려면 **40만 번**을 돈다.
//   이걸 `몸준비()` 안에서 그냥 돌렸더니, `몸준비` 가 useMemo 인데 의존성에
//   Leva 에서 오는 `보정값`·`트리포값` 이 있어서 **슬라이더를 만질 때마다**
//   그 40만 번이 다시 돌았다(사용자가 "갑자기 느려졌다"고 한 것).
//   지오메트리는 SkeletonUtils.clone 이 **공유**하므로 uuid 로 캐시하면
//   모델당 딱 한 번만 돈다.
import * as THREE from "three";

const 통 = new Map(); // `${geometry.uuid}|${뼈이름}` → THREE.Vector3

// 무게중심의 몇 %를 '쥐는 자리'로 삼나 — **화면을 보고 고른 값**이다.
//   무게중심 그대로(1.0)면 손목에서 0.320 유닛, 손 길이(0.567)의 57% 지점이다.
//   굽힌 손가락 정점이 많아 중심이 손끝 쪽으로 끌려간 것이라, 그대로 쓰면
//   머그가 **손가락 위로 올라가** 얹힌 것처럼 보였다.
//   0.45 · 0.65 · 0.85 · 1.0 을 같은 각도에서 찍어 견줘 0.45 를 골랐다 —
//   손가락이 손바닥에 맞닿는 자리라, 위에서 봐도 손잡이를 쥔 모양이 나온다.
export const 쥠자리비 = 0.45;

/**
 * 스킨 메시에서 그 뼈에 크게 물린 정점들의 무게중심을 **뼈 로컬 좌표**로 낸다.
 * @param 살   SkinnedMesh
 * @param 이름 뼈 이름 (예: "hand_r")
 * @returns THREE.Vector3 (없으면 null)
 */
export function 주먹중심(살, 이름) {
  const g = 살?.geometry;
  const pos = g?.attributes?.position;
  const si = g?.attributes?.skinIndex;
  const sw = g?.attributes?.skinWeight;
  if (!pos || !si || !sw) return null;
  const 열쇠 = `${g.uuid}|${이름}`;
  if (통.has(열쇠)) return 통.get(열쇠);

  const bi = 살.skeleton.bones.findIndex((b) => b.name === 이름);
  if (bi < 0) {
    통.set(열쇠, null);
    return null;
  }
  const v = new THREE.Vector3();
  const 합 = new THREE.Vector3();
  let 무게 = 0;
  for (let i = 0; i < pos.count; i += 1) {
    let w = 0;
    for (let k = 0; k < 4; k += 1) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k);
    // 0.5 미만은 그 뼈가 주인이 아니다(손목 이음매의 절반씩 물린 정점들)
    if (w < 0.5) continue;
    // 정점은 **바인드 포즈** 모델 좌표다 → 바인드 역행렬로 옮기면 뼈 로컬
    v.fromBufferAttribute(pos, i).applyMatrix4(살.skeleton.boneInverses[bi]);
    합.addScaledVector(v, w);
    무게 += w;
  }
  const 값 = 무게 > 0 ? 합.divideScalar(무게).multiplyScalar(쥠자리비) : null;
  통.set(열쇠, 값);
  return 값;
}

/**
 * 가슴의 **반두께** — 어깨 중앙선에서 가슴 앞면까지(모델 좌표).
 *
 * [왜 필요한가]
 *   든 물건이 몸을 안 뚫게 손을 밖으로 밀어야 하는데, 얼마나 밀지는
 *   **몸이 얼마나 두꺼운가**로 정해진다. 걷기 판정의 캡슐 반경(0.6)을 그대로
 *   쓰면 과하다 — 그건 어깨 폭까지 포함한 값이라, 물건이 필요 이상으로
 *   몸에서 떨어져 팔이 활짝 벌어진 자세가 된다.
 * [어떻게 재나]
 *   어깨 높이 근처의 얇은 판(슬래브)에 든 정점 중 몸통에 해당하는 것만 모아
 *   z 의 최댓값을 본다. 체형 슬라이더로 몸이 두꺼워지면 이 값도 따라간다.
 * [캐시] 주먹중심 과 같은 이유 — 정점 5만 개를 도는 계산이다.
 */
export function 가슴반두께(살, 어깨y, 어깨z) {
  const g = 살?.geometry;
  const pos = g?.attributes?.position;
  if (!pos) return null;
  const 열쇠 = `${g.uuid}|가슴`;
  if (통.has(열쇠)) return 통.get(열쇠);
  const v = new THREE.Vector3();
  let 최대 = -Infinity;
  const 위 = 어깨y + 0.02;
  const 아래 = 어깨y - 0.18; // 어깨에서 가슴까지
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    if (v.y < 아래 || v.y > 위) continue;
    if (Math.abs(v.x) > 0.16) continue; // 팔은 빼고 몸통만
    if (v.z > 최대) 최대 = v.z;
  }
  const 값 = Number.isFinite(최대) ? 최대 - 어깨z : null;
  통.set(열쇠, 값);
  return 값;
}

/** 양손을 한 번에 — `{ hand_l, hand_r }`. 없는 뼈는 키가 안 생긴다. */
export function 양손주먹중심(살) {
  const 표 = {};
  ["hand_l", "hand_r"].forEach((이름) => {
    const v = 주먹중심(살, 이름);
    if (v) 표[이름] = v;
  });
  return 표;
}
