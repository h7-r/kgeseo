// 몸 모델 준비 중 메시·뼈를 훑는 부분 — 파츠 붙이기, 재질 복제·파츠 표식·밑창, IK·배율에 쓸 뼈 찾기.
import * as THREE from "three";

import { bothFistCenters } from "./fistCenter";
import type {
  BodyPart,
  Disposables,
  FistMorph,
  Leg,
  LoadedGltf,
  PartError,
  PreparedBody,
  Sole,
  Arm,
} from "./preparedBody";

// 따로 구운 파츠(신발)를 캐릭터 골격에 묶는다. 뼈 순서가 다를 수 있어 skinIndex 를 이름으로 다시 매긴다.
// 쉴 때 자세가 같아 bind 행렬은 몸 것을 쓴다.
export function attachParts(
  partsGltf: LoadedGltf | null,
  targetSkin: THREE.SkinnedMesh,
  errors: PartError[],
  disposables: Disposables,
): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = [];
  if (!partsGltf) return out;
  partsGltf.scene.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const geometry = object.geometry.clone();
    // 우리가 만든 복제본이라 몸이 다시 만들어질 때 반납한다(안 그러면 갈아입을 때마다 쌓인다).
    disposables.geometries.push(geometry);
    const boneNames = targetSkin.skeleton.bones.map((bone) => bone.name);
    const remap = object.skeleton.bones.map((bone) => boneNames.indexOf(bone.name));
    // 몸 골격에 없는 뼈를 쓰는 파츠는 붙이지 않는다. 뿌리로 몰아 붙이면 옷이 가운데 뭉친 채
    // '그럭저럭 보이는' 상태로 넘어가 원인을 못 찾는다.
    const missingBones = object.skeleton.bones
      .filter((bone) => !boneNames.includes(bone.name))
      .map((bone) => bone.name);
    if (missingBones.length) {
      errors.push({ name: object.name, missingBones });
      return;
    }
    const index = geometry.getAttribute("skinIndex");
    const array = index.array;
    for (let i = 0; i < index.count * index.itemSize; i += 1) array[i] = remap[array[i]] ?? 0;
    index.needsUpdate = true;
    // 재질은 여기서 복제하지 않는다 — 곧 prepareBody 가 메시마다 다시 복제해 덮어써서 여기 복제본은 GPU 에 샌다.
    const mesh = new THREE.SkinnedMesh(geometry, object.material);
    mesh.name = object.name;
    // 파츠 표식(slot·variant·side·foot_shrink)은 재질이 여럿이면 부모 그룹 노드에 붙어 온다.
    // 조상까지 훑어 모은다(가까운 쪽이 우선). 빠뜨리면 신발이 늘 보이고 밑창 맞춤·발 줄이기가 죽는다.
    for (let node: THREE.Object3D | null = object; node && node !== partsGltf.scene; node = node.parent) {
      Object.entries(node.userData).forEach(([key, value]) => {
        if (!(key in mesh.userData)) mesh.userData[key] = value;
      });
    }
    mesh.bind(targetSkin.skeleton, targetSkin.bindMatrix);
    targetSkin.parent?.add(mesh);
    out.push(mesh);
  });
  return out;
}

interface MeshParts {
  skinMaterials: THREE.Material[];
  parts: BodyPart[];
  soles: Sole[];
}

/** 메시마다 재질을 복제하고 파츠 표식·피부 재질·밑창 정점을 모은다. */
export function collectMeshParts(model: THREE.Object3D, disposables: Disposables): MeshParts {
  const skinMaterials: THREE.Material[] = [];
  const soles: Sole[] = [];
  const parts: BodyPart[] = [];
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
    const cloned: THREE.Material | THREE.Material[] = Array.isArray(object.material)
      ? object.material.map((m: THREE.Material) => m.clone())
      : object.material.clone();
    object.material = cloned;
    const clonedList = Array.isArray(cloned) ? cloned : [cloned];
    disposables.materials.push(...clonedList);
    // GLB 노드 extras: slot(body/hair/top/bottom) + variant 번호
    let owner: THREE.Object3D | null = object;
    while (owner && owner.userData.slot === undefined && owner.userData.chibi_part === undefined) owner = owner.parent;
    const data: Record<string, unknown> = owner?.userData ?? {};
    parts.push({
      object,
      slot: String(data.slot ?? data.chibi_part ?? "body"),
      variant: Number(data.variant ?? -1),
    });
    const part = object.userData.chibi_part;
    if (part === "body" || object.name.includes("Nose")) skinMaterials.push(...clonedList);
    if (part === "body") clonedList.forEach((m) => (m.side = THREE.FrontSide));
    if (part === "body") {
      const position = object.geometry.getAttribute("position");
      const indices: number[] = [];
      // 접지 IK 가 발마다 높이를 보므로 좌우(x 부호)로 나눠 둔다.
      const left: number[] = [];
      const right: number[] = [];
      for (let i = 0; i < position.count; i += 1) {
        if (position.getY(i) >= 0.02) continue;
        indices.push(i);
        (position.getX(i) >= 0 ? left : right).push(i);
      }
      soles.push({ object, indices, left, right });
    }
    // 신발은 밑창이 맨발보다 낮다 — 신었을 때는 신발 바닥이 지면 기준이다(보이는 것만 센다).
    if (data.slot === "shoes") {
      const position = object.geometry.getAttribute("position");
      const indices: number[] = [];
      // 최저점 + 5cm. 0 미만으로 잡으면 밑창이 정확히 0 인 신발은 비어 신발이 땅에 묻히고,
      // 발이 앞뒤로 기울면(대기 −35°) 뒤꿈치·앞코 가장자리가 최저가 된다.
      let lowest = Infinity;
      for (let i = 0; i < position.count; i += 1) lowest = Math.min(lowest, position.getY(i));
      for (let i = 0; i < position.count; i += 1) if (position.getY(i) < lowest + 0.05) indices.push(i);
      const left = data.side === "l" ? indices : [];
      const right = data.side === "r" ? indices : [];
      soles.push({ object, indices, left, right });
    }
  });
  return { skinMaterials, parts, soles };
}

function bonesByName(skin: THREE.SkinnedMesh, names: string[]): THREE.Bone[] {
  return names.map((n) => skin.skeleton.getBoneByName(n)).filter((bone): bone is THREE.Bone => !!bone);
}

type RigBones = Pick<
  PreparedBody,
  | "legs"
  | "pelvisBone"
  | "ballBones"
  | "footBones"
  | "shoeShrink"
  | "armRoots"
  | "handBones"
  | "legRoots"
  | "shoulderBones"
  | "palms"
  | "gripSockets"
  | "fistMorphs"
  | "arms"
>;

/** 접지 IK·팔 IK·팔다리 배율·쥠에 쓸 뼈와 모프를 찾는다. 몸은 쉴 때 자세여야 한다. */
export function findRigBones(
  targetSkin: THREE.SkinnedMesh,
  model: THREE.Object3D,
  shoeParts: THREE.SkinnedMesh[],
): RigBones {
  // 접지 IK 용 다리 뼈. 굽힘은 '쉴 때 대비 회전'으로 재고 줄인다.
  targetSkin.skeleton.pose();
  const legs = (["l", "r"] as const)
    .map((side) => {
      const thigh = targetSkin.skeleton.getBoneByName(`thigh_${side}`);
      const calf = targetSkin.skeleton.getBoneByName(`calf_${side}`);
      const foot = targetSkin.skeleton.getBoneByName(`foot_${side}`);
      return thigh && calf && foot ? { side, thigh, calf, foot } : null;
    })
    .filter((leg): leg is Leg => !!leg);
  const pelvisBone = targetSkin.skeleton.getBoneByName("pelvis");
  // 신발을 신으면 발볼 뼈를 줄여 발가락을 신발 안으로 접는다.
  const ballBones = bonesByName(targetSkin, ["ball_l", "ball_r"]);
  // 신발을 신으면 발뼈를 foot_shrink 배율로 줄인다 — 신발은 그만큼 미리 키워 구워져 제 크기, 발만 작아진다.
  const footBones = bonesByName(targetSkin, ["foot_l", "foot_r"]);
  const shrinkPart = shoeParts.find((m) => m.userData.foot_shrink);
  const shoeShrink = Number(shrinkPart?.userData.foot_shrink ?? 1);
  // 팔·다리 길이는 뿌리 뼈(위팔·허벅지)를 균등 배율로 줄인다 — 자식과 살이 함께 줄어든다.
  //   아래팔 위치만 당기면 위팔 살이 그대로라 팔꿈치에서 끊어져 보인다. 한 축만 줄이면 굽을 때 찌그러진다.
  //   손·발은 역배율로 되돌린다(제 크기 조절은 따로 있다).
  const armRoots = bonesByName(targetSkin, ["upperarm_l", "upperarm_r"]);
  const handBones = bonesByName(targetSkin, ["hand_l", "hand_r"]);
  const legRoots = bonesByName(targetSkin, ["thigh_l", "thigh_r"]);
  // 어깨 폭 — 위팔 뼈의 쉴 때 위치에 배율. shoulderWidth 모프는 팔 정점까지 밀어 팔을 내리면 어깨가 처진다.
  const shoulderBones = bonesByName(targetSkin, ["upperarm_l", "upperarm_r"]).map((bone) => ({
    bone,
    rest: bone.position.clone(),
  }));
  // 손목 → 주먹 한가운데. 리그에서 재되 모델당 한 번만(fistCenter 의 캐시).
  const palms = bothFistCenters(targetSkin);

  // 물건 전용 소켓 뼈 — Synty 리그의 prop_l·prop_r. 스킨 웨이트 0 이고 모션 소스에 없어 어떤 클립에도
  // 안 덮이고 손을 따라다닌다. 손뼈 축(hand_r 로컬 +Y 가 세계 아래)을 물건마다 보정할 필요가 없다.
  //   hand_r 기준 prop_r 로컬은 [-0.0522, 0.0180, 0.0005](0.184 유닛)
  const gripSockets = {
    hand_l: targetSkin.skeleton.getBoneByName("prop_l") ?? null,
    hand_r: targetSkin.skeleton.getBoneByName("prop_r") ?? null,
  };

  // 주먹 쥐기 모프가 실제로 붙은 메시를 미리 모은다. 이름을 못 박지 않고 있으면 쓰고 없으면 건너뛴다
  //   (meshy 는 Body·Hair0·Hair1·외곽선까지 넷, shoes·chibi 는 0). 외곽선은 parts 에 없어 모델 전체를 훑는다 —
  //   안 넣으면 외곽선만 편 손 모양으로 남아 유령선이 생긴다. 좌우 공용 모프라 한 손만 쥘 수는 없다.
  const fistMorphs: FistMorph[] = [];
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const index = o.morphTargetDictionary?.fistHands;
    if (index !== undefined && o.morphTargetInfluences) fistMorphs.push({ mesh: o, index });
  });

  // 아래팔은 반드시 이름으로 찾는다 — children 첫 뼈는 리그에 따라 쇄골·트위스트 뼈가 잡힌다.
  const arms = (["l", "r"] as const)
    .map((side) => {
      const upper = targetSkin.skeleton.getBoneByName(`upperarm_${side}`);
      const lower = targetSkin.skeleton.getBoneByName(`lowerarm_${side}`);
      const hand = targetSkin.skeleton.getBoneByName(`hand_${side}`);
      return upper && lower && hand ? { side, upper, lower, hand } : null;
    })
    .filter((arm): arm is Arm => !!arm);
  return {
    legs,
    pelvisBone,
    ballBones,
    footBones,
    shoeShrink,
    armRoots,
    handBones,
    legRoots,
    shoulderBones,
    palms,
    gripSockets,
    fistMorphs,
    arms,
  };
}
