// 치비·Meshy 몸체 런타임 아바타. Sidekick 뼈 이름·축으로 묶은 몸 GLB 에 Quaternius 43개 모션(과
// 우리 몸체에 맞춰 만든 Tripo 걷기·대기·달리기)을 리타게팅하고, 보정·접지 IK·팔 IK·쥠을 얹는다.
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone, retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";

import { exposeDevHook } from "@/debug/devHooks";

import { UNITS_PER_METER } from "../plan/sitePlan";
import type { ArmPole, AvatarLink, WorldPoint } from "@/engine/avatarLink";
import { registerDiagnostics } from "./avatarDiagnostics";
import { bothFistCenters, chestHalfDepth, type FistCenters } from "./fistCenter";
import { DEFAULT_MESH_CONFIG, type MeshAppearanceConfig, meshBodyUrl, meshShoesUrl } from "./meshAppearance";
import {
  type CorrectionOverrides,
  type CorrectionTable,
  type CorrectionValues,
  correctClip,
  correctionQuaternion,
  DEFAULT_CORRECTION,
  GENDER_CORRECTION,
  LOCOMOTION_CLIPS,
  readCorrectionOverrides,
  TRIPO_CORRECTION,
  TRIPO_GENDER_CORRECTION,
} from "./motionCorrection";
import {
  attachSkeleton,
  firstSkinnedMesh,
  type RetargetSetup,
  retargetOptions,
  setMorph,
  strideSpeed,
} from "./retargeting";
import { AUTO_MOTION } from "./sidekickOptions";
import { applyToon, DEFAULT_TOON, type ToonConfig, type ToonHandle, type ToonPartKind } from "./toonMaterial";
import { applyOutline, DEFAULT_OUTLINE, type OutlineConfig, type OutlineHandle } from "./toonOutline";

type Gender = "masculine" | "feminine";
type Side = "l" | "r";

/** 몸체 파일 묶음 — chibi = V4 몸체 시제품, meshy = Meshy 몸체(착장마다 파일이 다르다) */
export type ChibiBody = "chibi" | "meshy";

/** 치비 런타임 외형 — 메시 외형 형식에서 바꿀 것만 넘긴다 */
export type ChibiAvatarConfig = Partial<MeshAppearanceConfig>;

// 발바닥이 땅에 붙은 채 안 움직이는 클립. 여기 있을 때만 발바닥 최저점을 캐시한다.
//   「플레이어가 안 움직인다」와 다른 말이다. 새 클립은 재고 넣을 것(3초 진폭 Idle_Loop 0.10mm · Walk_Loop 38mm).
const STATIONARY_CLIPS = new Set(["Idle_Loop"]);

// meshy 는 착장마다 파일이 달라 meshBodyUrl 이 고른다. 여기는 chibi 몸체만.
const CHIBI_BODY_URLS: Record<Gender, string> = {
  masculine: "/models/chibi-male.glb",
  feminine: "/models/chibi-female.glb",
};
const MOTION_LIBRARY_URL = "/models/vendor/quaternius-universal-animation-library.glb";
// Tripo 가 몸체마다 새로 리깅해 파일마다 리그가 다를 수 있다 — 클립은 제 리그로 리타게팅한다.
const TRIPO_MOTION_URLS: string[] = ["/models/tripo-motions.glb?v=8", "/models/tripo-motions-fold.glb?v=1"];

const DEFAULT_CHIBI_CONFIG: ChibiAvatarConfig = {
  motion: AUTO_MOTION,
  walkMotion: "Walk_Loop",
  runMotion: "Jog_Fwd_Loop",
  gender: "masculine",
  heightScale: 1,
  headScale: 1,
  skinColor: "#f3d2bd",
};

interface LoadedGltf {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

interface Disposables {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

interface PartError {
  name: string;
  missingBones: string[];
}

interface BodyPart {
  object: THREE.Mesh;
  slot: string;
  variant: number;
}

interface Sole {
  object: THREE.Mesh;
  indices: number[];
  left: number[];
  right: number[];
}

interface Leg {
  side: Side;
  thigh: THREE.Bone;
  calf: THREE.Bone;
  foot: THREE.Bone;
}

interface Arm {
  side: Side;
  upper: THREE.Bone;
  lower: THREE.Bone;
  hand: THREE.Bone;
}

type ContactTimes = Record<Side, number>;

interface PreparedBody {
  /** 몸 골격에 없는 뼈를 써서 못 붙인 파츠. 비어 있어야 정상이다. */
  partErrors: PartError[];
  armRoots: THREE.Bone[];
  arms: Arm[];
  fistMorphs: { mesh: THREE.Mesh; index: number }[];
  palms: FistCenters;
  gripSockets: { hand_l: THREE.Bone | null; hand_r: THREE.Bone | null };
  handBones: THREE.Bone[];
  legRoots: THREE.Bone[];
  shoulderBones: { bone: THREE.Bone; rest: THREE.Vector3 }[];
  ballBones: THREE.Bone[];
  footBones: THREE.Bone[];
  shoeShrink: number;
  model: THREE.Object3D;
  targetSkin: THREE.SkinnedMesh;
  legs: Leg[];
  pelvisBone: THREE.Bone | undefined;
  clipFor: (name: string) => THREE.AnimationClip | null;
  strideFor: (name: string) => number;
  contactTimeFor: (name: string) => ContactTimes | null;
  correction: CorrectionValues;
  clipCount: number;
  tripoClips: string[];
  mappedBones: number;
  skinMaterials: THREE.Material[];
  parts: BodyPart[];
  soles: Sole[];
  headBone: THREE.Bone | undefined;
  /** 1인칭 「몸만」에서 머리 대신 목째 접는다 */
  neckBone: THREE.Bone | undefined;
  /** 이 준비가 직접 만든 것만 반납한다. 두 번 불러도 안전하다. */
  dispose: () => void;
}

function setMaterialColor(material: THREE.Material, color: string) {
  if ("color" in material && material.color instanceof THREE.Color) material.color.set(color);
}

// 따로 구운 파츠(신발)를 캐릭터 골격에 묶는다. 뼈 순서가 다를 수 있어 skinIndex 를 이름으로 다시 매긴다.
// 쉴 때 자세가 같아 bind 행렬은 몸 것을 쓴다.
function attachParts(
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

// 리타깃·보폭·접지 표본은 뼈대와 동작 파일만 보고 정해진다 — 옷은 껍데기라 상관없다.
// 갈아입을 때마다 다시 계산하면 멈춤 1초의 절반(리타깃 180ms + 표본 300ms)이었다.
// 뼈대 서명 + 보정값으로 열쇠를 만들어 모듈에 들고 있는다. 트랙 이름이 뼈 이름이라 같은 이름 뼈대면 그대로 붙는다.
interface RigStore {
  retargeted: Map<string, THREE.AnimationClip>;
  contactTimes: Map<string, ContactTimes | null>;
  strides: Map<string, number>;
}
const rigCache = new Map<string, RigStore>();
const RIG_CACHE_MAX = 6;

function rigSignature(skin: THREE.SkinnedMesh): string {
  const parts: string[] = [];
  skin.skeleton.bones.forEach((b) => {
    parts.push(
      b.name,
      b.position.x.toFixed(3),
      b.position.y.toFixed(3),
      b.position.z.toFixed(3),
      b.quaternion.x.toFixed(3),
      b.quaternion.y.toFixed(3),
      b.quaternion.z.toFixed(3),
      b.quaternion.w.toFixed(3),
    );
  });
  return parts.join(",");
}

function rigStore(key: string): RigStore {
  let store = rigCache.get(key);
  if (!store) {
    store = { retargeted: new Map(), contactTimes: new Map(), strides: new Map() };
    rigCache.set(key, store);
    // 오래된 것부터 버린다 — 성별·보정 조합이 몇 개뿐이라 넉넉하다.
    while (rigCache.size > RIG_CACHE_MAX) {
      const oldest = rigCache.keys().next().value;
      if (oldest === undefined) break;
      rigCache.delete(oldest);
    }
  }
  return store;
}

interface TripoSource {
  scene: THREE.Object3D;
  skin: THREE.SkinnedMesh;
  clips: THREE.AnimationClip[];
  options?: RetargetSetup;
}

function bonesByName(skin: THREE.SkinnedMesh, names: string[]): THREE.Bone[] {
  return names.map((n) => skin.skeleton.getBoneByName(n)).filter((bone): bone is THREE.Bone => !!bone);
}

function prepareBody(
  gltf: LoadedGltf,
  motionGltf: LoadedGltf,
  correction: CorrectionValues = DEFAULT_CORRECTION,
  shoesGltf: LoadedGltf | null = null,
  tripoGltfs: LoadedGltf[] | null = null,
  tripoValues: CorrectionValues = TRIPO_CORRECTION,
  outerKey = "",
): PreparedBody {
  const model = clone(gltf.scene);
  const retargetModel = clone(gltf.scene);
  const source = clone(motionGltf.scene);
  const targetSkin = firstSkinnedMesh(model);
  const retargetSkin = firstSkinnedMesh(retargetModel);
  const sourceSkin = firstSkinnedMesh(source);
  if (!targetSkin || !retargetSkin || !sourceSkin)
    throw new Error("치비 몸 또는 모션 파일에서 스킨 리그를 찾지 못했습니다.");
  // Tripo 동작 소스(파일 여러 개) — 같은 이름 클립은 이쪽을 먼저 찾는다. 클립마다 제 파일의 리그를 쓴다.
  const tripoSources: TripoSource[] = (tripoGltfs ?? [])
    .map((g) => {
      const scene = clone(g.scene);
      return { scene, skin: firstSkinnedMesh(scene), clips: g.animations };
    })
    .filter((x): x is TripoSource => !!x.skin);
  const tripoSkin = tripoSources[0]?.skin ?? null;
  const tripoClips = new Map<string, { clip: THREE.AnimationClip; source: TripoSource }>();
  tripoSources.forEach((tripo) =>
    tripo.clips.forEach((clip) => {
      if (!tripoClips.has(clip.name)) tripoClips.set(clip.name, { clip, source: tripo });
    }),
  );
  const skinMaterials: THREE.Material[] = [];
  const soles: Sole[] = [];
  const parts: BodyPart[] = [];
  const partErrors: PartError[] = [];
  // 이 준비가 직접 만든 GPU 자원만 모은다. GLB 가 준 지오메트리·텍스처는 useGLTF 캐시의 공용 자원이라
  // 버리면 같은 옷으로 돌아올 때 수십 MB 를 다시 올린다(모프 텍스처만 627ms).
  const disposables: Disposables = { geometries: [], materials: [] };
  const shoeParts = attachParts(shoesGltf, targetSkin, partErrors, disposables);
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

  const options = retargetOptions(retargetSkin, sourceSkin);
  tripoSources.forEach((tripo) => {
    tripo.options = retargetOptions(retargetSkin, tripo.skin);
    attachSkeleton(tripo.scene, tripo.skin.skeleton);
  });
  const baseTable = correctionQuaternion(retargetSkin, correction);
  const tripoTable = tripoSkin ? correctionQuaternion(retargetSkin, tripoValues) : null;
  // Tripo 팔짱 클립은 그대로가 제일 낫다 — 어깨·팔을 손대니 아래팔이 뒤바뀌고 한 손이 허공에 떴다.
  // 남은 흠은 오른손이 왼팔을 파고드는 것뿐이라 거기만 편다(18° 면 파고든 정점 198 → 45).
  const foldValues: CorrectionValues = {
    ...tripoValues,
    armSpread: 0,
    armForward: 0,
    elbowStraighten: 0,
    clavicleForward: 0,
    elbowStraightenAlways: true,
    rightElbowStraighten: 18,
    ...(tripoValues.foldOverrides ?? {}),
  };
  const foldTable = tripoSkin ? correctionQuaternion(retargetSkin, foldValues) : null;
  // 그냥 서 있는 대기(Idle_Loop)만 따로 편다 — 걷기·달리기는 손대지 않는다.
  const idleValues: CorrectionValues = { ...tripoValues, ...(tripoValues.idleOverrides ?? {}) };
  const idleTable = tripoSkin ? correctionQuaternion(retargetSkin, idleValues) : null;
  attachSkeleton(source, sourceSkin.skeleton);
  const sourceClips = new Map(motionGltf.animations.map((clip) => [clip.name, clip]));
  // 옷만 바뀐 것이면 앞서 계산한 리타깃·보폭·접지를 그대로 쓴다.
  const store = rigStore(`${outerKey}|${rigSignature(retargetSkin)}`);
  const retargeted = store.retargeted;
  const clipFor = (name: string): THREE.AnimationClip | null => {
    const cached = retargeted.get(name);
    if (cached) return cached;
    const tripo = tripoClips.get(name);
    const sourceClip = tripo?.clip ?? sourceClips.get(name);
    if (!sourceClip) return null;
    const clipSource = tripo ? tripo.source.scene : source;
    const clipSourceSkin = tripo ? tripo.source.skin : sourceSkin;
    retargetSkin.skeleton.pose();
    clipSourceSkin.skeleton.pose();
    clipSource.updateMatrixWorld(true);
    retargetSkin.updateMatrixWorld(true);
    const result = retargetClip(retargetSkin, clipSource, sourceClip, tripo ? tripo.source.options : options);
    result.name = name;
    retargetSkin.skeleton.pose();
    // 클립마다 쓸 보정 — 팔짱·대기는 그 클립 전용 값이 있다.
    let table: CorrectionTable | null = tripo ? tripoTable : baseTable;
    let values = tripo ? tripoValues : correction;
    if (tripo && name === "Idle_Fold_Loop") [table, values] = [foldTable, foldValues];
    if (tripo && name === "Idle_Loop") [table, values] = [idleTable, idleValues];
    if (correction.enabled) correctClip(result, table, name, values);
    retargeted.set(name, result);
    return result;
  };
  // 발마다 '접지 시각'(한 주기에서 디딤이 시작되는 순간, 0~1). 접지 IK 는 이 직전·직후에만 건다.
  // 높이만으로는 낮게 스윙하는 발과 디디려는 발을 못 가른다 — 창을 넓히면 스윙 다리를 붙잡아 곧게 뻗었다.
  const contactTimes = store.contactTimes;
  const contactTimeFor = (name: string): ContactTimes | null => {
    if (contactTimes.has(name)) return contactTimes.get(name) ?? null;
    const clip = clipFor(name);
    let out: ContactTimes | null = null;
    if (clip && LOCOMOTION_CLIPS.has(name)) {
      const feet = (["l", "r"] as const).map((s) => [
        retargetSkin.skeleton.getBoneByName(`foot_${s}`),
        retargetSkin.skeleton.getBoneByName(`ball_${s}`),
      ]);
      if (feet.every(([f, b]) => f && b)) {
        const mixer = new THREE.AnimationMixer(retargetSkin);
        const action = mixer.clipAction(clip).play();
        const samples = 64;
        const heights = [new Float32Array(samples), new Float32Array(samples)];
        const p1 = new THREE.Vector3();
        const p2 = new THREE.Vector3();
        for (let i = 0; i < samples; i += 1) {
          action.time = (clip.duration * i) / samples;
          mixer.update(0);
          retargetModel.updateMatrixWorld(true);
          feet.forEach(([f, b], k) => {
            if (!f || !b) return;
            heights[k][i] = Math.min(
              p1.setFromMatrixPosition(f.matrixWorld).y,
              p2.setFromMatrixPosition(b.matrixWorld).y,
            );
          });
        }
        mixer.stopAllAction();
        mixer.uncacheRoot(retargetSkin);
        retargetSkin.skeleton.pose();
        // 접지 = 입각기가 시작되는 샘플. 최저점은 이미 붙어 있는 한가운데라, 최저점에서 거꾸로 훑어
        // 최저 높이 15% 문턱 아래로 처음 내려오는 순간을 잡는다.
        const starts = heights.map((h) => {
          let min = Infinity;
          let max = -Infinity;
          let minIndex = 0;
          h.forEach((y, i) => {
            if (y < min) {
              min = y;
              minIndex = i;
            }
            if (y > max) max = y;
          });
          const threshold = min + (max - min) * 0.15;
          let i = minIndex;
          for (let k = 0; k < samples; k += 1) {
            const j = (minIndex - k + samples) % samples;
            if (h[j] > threshold) break;
            i = j;
          }
          return i / samples;
        });
        out = { l: starts[0], r: starts[1] };
      }
    }
    contactTimes.set(name, out);
    return out;
  };
  const strides = store.strides;
  const strideFor = (name: string): number => {
    const cached = strides.get(name);
    if (cached !== undefined) return cached;
    const clip = clipFor(name);
    const speed = clip && LOCOMOTION_CLIPS.has(name) ? strideSpeed(retargetModel, retargetSkin, clip) : 0;
    strides.set(name, speed);
    return speed;
  };
  targetSkin.skeleton.pose();
  model.updateMatrixWorld(true);
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
  //   아래팔 위치만 당기면 위팔 살이 그대로라 팔꿈치에서 끊어져 보였다. 한 축만 줄이면 굽을 때 찌그러진다.
  //   손·발은 역배율로 되돌린다(제 크기 조절은 따로 있다).
  const armRoots = bonesByName(targetSkin, ["upperarm_l", "upperarm_r"]);
  const handBones = bonesByName(targetSkin, ["hand_l", "hand_r"]);
  const legRoots = bonesByName(targetSkin, ["thigh_l", "thigh_r"]);
  // 어깨 폭 — 위팔 뼈의 쉴 때 위치에 배율. shoulderWidth 모프는 팔 정점까지 밀어 팔을 내리면 어깨가 처졌다.
  const shoulderBones = bonesByName(targetSkin, ["upperarm_l", "upperarm_r"]).map((bone) => ({
    bone,
    rest: bone.position.clone(),
  }));
  // 손목 → 주먹 한가운데. 리그에서 재되 모델당 한 번만(fistCenter 의 캐시).
  const palms = bothFistCenters(targetSkin);

  // 물건 전용 소켓 뼈 — Synty 리그의 prop_l·prop_r. 스킨 웨이트 0 이고 모션 소스에 없어 어떤 클립에도
  // 안 덮이고 손을 따라다닌다. hand_r 의 로컬 +Y 가 세계 아래를 봐서 물건마다 얹던 128° 리그 상수가 사라진다.
  //   실측: hand_r 기준 prop_r 로컬 [-0.0522, 0.0180, 0.0005](0.184 유닛)
  const gripSockets = {
    hand_l: targetSkin.skeleton.getBoneByName("prop_l") ?? null,
    hand_r: targetSkin.skeleton.getBoneByName("prop_r") ?? null,
  };

  // 주먹 쥐기 모프가 실제로 붙은 메시를 미리 모은다. 이름을 못 박지 않고 있으면 쓰고 없으면 건너뛴다
  //   (meshy 는 Body·Hair0·Hair1·외곽선까지 넷, shoes·chibi 는 0). 외곽선은 parts 에 없어 모델 전체를 훑는다 —
  //   안 넣으면 외곽선만 편 손 모양으로 남아 유령선이 생긴다. 좌우 공용 모프라 한 손만 쥘 수는 없다.
  const fistMorphs: { mesh: THREE.Mesh; index: number }[] = [];
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
    partErrors,
    armRoots,
    arms,
    fistMorphs,
    palms,
    gripSockets,
    handBones,
    legRoots,
    shoulderBones,
    ballBones,
    footBones,
    shoeShrink,
    model,
    targetSkin,
    legs,
    pelvisBone,
    clipFor,
    strideFor,
    contactTimeFor,
    correction,
    clipCount: sourceClips.size,
    tripoClips: [...tripoClips.keys()],
    mappedBones: Object.keys(options.names).length,
    skinMaterials,
    parts,
    soles,
    headBone: targetSkin.skeleton.getBoneByName("head"),
    neckBone: targetSkin.skeleton.getBoneByName("neck_01"),
    dispose: () => {
      disposables.geometries.forEach((g) => g.dispose());
      disposables.materials.forEach((m) => m.dispose());
      disposables.geometries.length = 0;
      disposables.materials.length = 0;
      // 스키닝 뼈 행렬 텍스처도 뼈대마다 한 장이다 — 안 버리면 갈아입을 때마다 2장씩 늘었다.
      const skeletons = new Set<THREE.Skeleton>();
      [model, retargetModel].forEach((root) =>
        root.traverse((o) => {
          if (o instanceof THREE.SkinnedMesh && o.skeleton) skeletons.add(o.skeleton);
        }),
      );
      skeletons.forEach((s) => s.dispose());
    },
  };
}

// 1인칭 「몸만」 — 아래를 보면 배·다리가 보여야 "내가 거기 서 있다"가 된다. 머리만 접으면 목·가슴이 남아
// 물건을 들 때 머리 잘린 몸통이 비쳤다. 상용 1인칭처럼 카메라 앞쪽만 그린다(재질 clippingPlanes, 세계 좌표).
// 높이로 자르면 위로 뻗은 손이 같이 잘려 시선축으로 자른다. 올려다볼 때를 위해 머리 접기도 둔다.
// 그림자는 안 자른다(clipShadows 기본 false) — 몸은 실제로 거기 있다.
//   near = m, 카메라에서 이만큼 앞부터 그린다. 0.32 는 손가락이 껍질처럼 잘렸고, 0.16 이면 손은 온전하고 목 단면도 안 보인다.
//   bodyBack = m, 「몸만」일 때 몸을 뒤로 물리는 거리. 물리면 팔 길이 제한에 든 물건이 화면 밖으로 내려가 0 으로 둔다.
//   crouchNear = m, 앉았을 때의 near. 앉으면 몸이 앞으로 숙여(Crouch 클립) 가슴·등이 면 앞에 놓이고 안쪽 등판이
//     비쳤다. 그때만 면을 더 밀어 몸통까지 자른다. 손·팔뚝은 그보다 앞이라 남는다.
//   showBody = 1인칭에서 내 몸을 그릴까. 기본 끔 — 카메라가 몸 안에 있어 어느 자세든 잘린 단면이 비친다.
//     손만 남기려면 손 뼈 가중치 마스크(에셋·셰이더 작업)가 필요하다. 든 물건은 카메라 기준으로 따로 그려진다.
//   콘솔에서 바로 맞춘다: `__game.clipping.crouchNear = 0.4`, `__game.clipping.showBody = true`
const CLIPPING = { near: 0.16, crouchNear: 0.34, bodyBack: 0, showBody: false };
exposeDevHook("clipping", CLIPPING);
const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);
const CLIP_PLANES = [clipPlane];
const _clipForward = new THREE.Vector3();
const _clipPoint = new THREE.Vector3();
// 팔 IK 그릇 — 매 프레임 새로 만들지 않는다(프레임당 10~20개 쓰레기가 GC 끊김으로 보였다).
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _W = new THREE.Vector3();
const _W2 = new THREE.Vector3();
const _T = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _parentQ = new THREE.Quaternion();
const _worldQ = new THREE.Quaternion();
const _correctionQ = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _fixedPole = new THREE.Vector3();
const _elbowGoal = new THREE.Vector3();
const _wristGoal = new THREE.Vector3();
const _handQ = new THREE.Quaternion();
const _handParentQ = new THREE.Quaternion();
const _lowerArmQ = new THREE.Quaternion();
const _restQ = new THREE.Quaternion();
const _goalQ = new THREE.Quaternion();
const _bodyV = new THREE.Vector3();
const _bodyScale = new THREE.Vector3();

/** 세계 회전을 부모 공간으로 옮겨 뼈에 앞곱한다(pq⁻¹ · wq · pq). */
function rotateInWorld(bone: THREE.Object3D, worldRotation: THREE.Quaternion, parentQ: THREE.Quaternion) {
  bone.parent?.getWorldQuaternion(parentQ);
  bone.quaternion.premultiply(_correctionQ.copy(parentQ).invert().multiply(worldRotation).multiply(parentQ));
  bone.updateMatrixWorld(true);
}

// 주먹을 감았다 펴는 속도(1/초). 물건이 손에 붙는 순간 이미 쥐어져 있게 집는 동작보다 조금 빠르게.
const GRIP_CLOSE_SPEED = 12;
// 손목이 클립 자세에서 벗어날 수 있는 최대 각(도). 아래팔 기준이 아니다 — hand bind 가 이미 90° 꺾여 있다.
//   사람 손목 실용 가동범위(굽힘·젖힘 40°, Ryu et al. 1991). 축을 나누지 않아 실용값 쪽에 둔다.
const WRIST_LIMIT = 40;
// 팔꿈치 폴 기본값 — 꺼진 채. 게임이 armPole 을 내려 주면 그 값이 이긴다.
const DEFAULT_ARM_POLE: ArmPole = { enabled: false, back: 1, down: 1, outward: 0.35, weight: 1 };

/** `__game.armIK` — IK 가 정말 도는지, 무엇에 막혔는지 숫자로 본다(추측으로 고치다 세 번 망가뜨렸다) */
interface ArmIkDebug {
  weight?: number;
  leftWeight?: number;
  hasTarget?: boolean;
  leftHasTarget?: boolean;
  armCount?: number;
  torsoHalfDepth?: number | null;
  handRotationWeight?: number | null;
  hasHandRotation?: boolean;
  hasSocket?: boolean;
  mode?: string;
  shoulder?: number[];
  target?: number[];
  hand?: number[];
  remainingDistance?: number;
  shoulderToTarget?: number;
  armLength?: number;
  elbow?: number[];
}
const armIkDebug: ArmIkDebug = {};
const chibiDebugByGender: Partial<Record<Gender, { motion: string; current: string | null }>> = {};

interface FootContactDebug {
  other: Side;
  gap: number;
  weight: number;
  frontShare: number;
  isAhead: boolean;
}

const roundedPoint = (p: THREE.Vector3) => [p.x, p.y, p.z].map((v) => +v.toFixed(2));

interface ChibiGameAvatarProps {
  /** false 면 그리지 않는다(1인칭 「몸만」은 따로) */
  visible: boolean;
  /** 1인칭에서 몸만 그릴지(Leva 「1인칭 몸」) */
  firstPersonBody?: boolean;
  playerRef: RefObject<AvatarLink | null>;
  config?: ChibiAvatarConfig;
  /** 인게임 미터 배율 */
  scale?: number;
  /** QA 캡처용: 모션을 이 시각(초)에 고정 */
  fixedTime?: number | null;
  body?: ChibiBody;
  toon?: ToonConfig;
  outline?: OutlineConfig;
  /** 기본·성별 보정 위에 덮어쓸 것만 */
  correction?: CorrectionOverrides | null;
  /**
   * useFrame 순서(작을수록 먼저). 손목표(−30) 뒤, 든 물건(−10) 앞이어야 물건이 직전 프레임 손을 따라
   * 헤엄치지 않는다. 음수라 R3F 자동 렌더는 그대로 돈다. 본편은 FRAME_PRIORITY.avatar 를 넘긴다.
   */
  framePriority?: number;
}

function ChibiGameAvatar({
  visible,
  firstPersonBody = false,
  playerRef,
  config = DEFAULT_CHIBI_CONFIG,
  scale = UNITS_PER_METER,
  fixedTime = null,
  body = "chibi",
  toon = DEFAULT_TOON,
  outline = DEFAULT_OUTLINE,
  correction = DEFAULT_CORRECTION,
  framePriority = -20,
}: ChibiGameAvatarProps) {
  const root = useRef<THREE.Group>(null);
  // 1인칭 잘림면은 세계 좌표라 카메라가 필요하고, localClippingEnabled 를 켜야 clippingPlanes 를 본다.
  const { gl, camera } = useThree();
  const isMeshy = body === "meshy";
  const appearanceBase = useMemo<MeshAppearanceConfig>(() => ({ ...DEFAULT_MESH_CONFIG, ...config }), [config]);
  const modelUrl = isMeshy ? meshBodyUrl(appearanceBase) : null;
  const maleGltf = useGLTF(modelUrl ?? CHIBI_BODY_URLS.masculine);
  const femaleGltf = useGLTF(modelUrl ?? CHIBI_BODY_URLS.feminine);
  const motionGltf = useGLTF(MOTION_LIBRARY_URL);
  const shoesGltf = useGLTF(isMeshy ? meshShoesUrl(appearanceBase) : CHIBI_BODY_URLS.masculine);
  const tripoGltfs = useGLTF(TRIPO_MOTION_URLS);
  const usesTripo = (config.motionSource ?? DEFAULT_MESH_CONFIG.motionSource) === "tripo";
  const gender: Gender = config.gender === "feminine" ? "feminine" : "masculine";
  // 기본 → 성별 → 호출자 덧값 순으로 합친다.
  const correctionValues = useMemo<CorrectionValues>(
    () => ({ ...DEFAULT_CORRECTION, ...(GENDER_CORRECTION[gender] ?? {}), ...(correction ?? {}) }),
    [gender, correction],
  );
  const tripoValues = useMemo<CorrectionValues>(() => {
    const values: CorrectionValues = { ...TRIPO_CORRECTION, ...(TRIPO_GENDER_CORRECTION[gender] ?? {}) };
    // DEV 덧값 — gait.html?walk=…&fold=…&idle=…. 주소로 넘어온 열쇠만 덮어쓴다.
    Object.assign(values, readCorrectionOverrides("walk") ?? {});
    const fold = readCorrectionOverrides("fold");
    if (fold) values.foldOverrides = { ...(values.foldOverrides ?? {}), ...fold };
    const idle = readCorrectionOverrides("idle");
    if (idle) values.idleOverrides = { ...(values.idleOverrides ?? {}), ...idle };
    return values;
  }, [gender]);
  // 옷이 바뀌어도 값이 같은 것(리타깃·보폭·접지)을 찾을 열쇠. 몸 GLB 경로는 일부러 안 넣는다.
  const rigKey = useMemo(
    () =>
      `${body}|${gender}|${usesTripo ? "t" : "s"}|${JSON.stringify(correctionValues)}|${JSON.stringify(tripoValues)}`,
    [body, gender, usesTripo, correctionValues, tripoValues],
  );
  const prepared = useMemo(
    () =>
      prepareBody(
        !isMeshy && gender === "feminine" ? femaleGltf : maleGltf,
        motionGltf,
        correctionValues,
        isMeshy ? shoesGltf : null,
        usesTripo ? tripoGltfs : null,
        tripoValues,
        rigKey,
      ),
    [
      isMeshy,
      gender,
      maleGltf,
      femaleGltf,
      motionGltf,
      correctionValues,
      shoesGltf,
      tripoGltfs,
      usesTripo,
      tripoValues,
      rigKey,
    ],
  );

  // 반납은 두 프레임 미룬다. three 는 같은 셰이더 재질끼리 프로그램을 돌려쓰며 쓰는 수를 세는데,
  // 옛 재질을 먼저 버리면 프로그램이 지워지고 새 재질이 같은 셰이더를 처음부터 다시 링크했다
  // (갈아입을 때 멈춤 1초 중 0.66초). 새 재질이 한 번 그려진 뒤 버리면 그대로 물려받는다.
  const pendingDisposals = useRef<(() => void)[]>([]);
  const defer = useCallback((task: () => void) => {
    pendingDisposals.current.push(task);
    // 이미 예약돼 있다
    if (pendingDisposals.current.length > 1) return;
    const flush = () => {
      const tasks = pendingDisposals.current;
      pendingDisposals.current = [];
      tasks.forEach((f) => {
        try {
          f();
        } catch {
          // 반납이 실패해도 화면은 그대로 돈다
        }
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(flush));
  }, []);

  // 밀려난 몸은 제 GPU 자원을 반납한다(안 그러면 갈아입을 때마다 쌓였다).
  // 정리 함수로 버리지 않는다 — StrictMode 의 「실행 → 정리 → 다시 실행」 에서 지금 쓰는 몸을 버리게 된다.
  const previousPrepared = useRef<PreparedBody | null>(null);
  useEffect(() => {
    const previous = previousPrepared.current;
    previousPrepared.current = prepared;
    if (previous && previous !== prepared) defer(() => previous.dispose());
  }, [prepared, defer]);

  // 잘림면은 화면에 실제로 그려지는 재질(그려진 그룹)에 첫 프레임 한 번만 붙인다.
  // clippingPlanes 의 개수가 바뀌면 셰이더를 다시 컴파일하므로, 붙여 두고 평면 자리만 옮긴다.
  const clipAttached = useRef(false);
  const wasBodyOnly = useRef(false);
  useEffect(() => {
    gl.localClippingEnabled = true;
    clipAttached.current = false;
  }, [gl, prepared, config, body]);

  // 재질은 준비(모델)당 한 번만 갈아 끼우고 세기 같은 값은 uniform 으로만 바꾼다. 끄면 원본 재질로 돌아간다.
  const classify = useMemo(
    () =>
      (object: THREE.Object3D): ToonPartKind => {
        let owner: THREE.Object3D | null = object;
        while (owner && owner.userData.slot === undefined && owner.userData.chibi_part === undefined)
          owner = owner.parent;
        const slot = owner?.userData.slot ?? owner?.userData.chibi_part ?? "body";
        return slot === "hair" ? "hair" : slot === "body" ? "body" : "cloth";
      },
    [],
  );
  const toonHandle = useRef<ToonHandle | null>(null);
  const outlineHandle = useRef<OutlineHandle | null>(null);
  // 그리기 전에 붙인다(useLayoutEffect). useEffect 면 툰·외곽선 없는 반쪽 몸이 한 프레임 나가고,
  // 바로 다음 프레임이 새 모델을 올리느라 멈춰 그 그림이 2초 가까이 굳어 있었다.
  useLayoutEffect(() => {
    if (!toon.enabled) return undefined;
    const handle = applyToon(prepared.model, classify, toon);
    toonHandle.current = handle;
    return () => {
      toonHandle.current = null;
      // 곧바로 버리면 셰이더를 다시 링크한다.
      defer(() => handle.restore());
    };
    // 단계·경계가 바뀌면 그라디언트 맵이 달라져 재질을 다시 만든다. 나머지는 update 로.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, classify, toon.enabled, toon.steps, toon.threshold, defer]);
  useEffect(() => {
    toonHandle.current?.update(toon);
  }, [toon]);
  useLayoutEffect(() => {
    if (!outline.enabled) return undefined;
    const handle = applyOutline(prepared.model, outline, classify);
    outlineHandle.current = handle;
    return () => {
      outlineHandle.current = null;
      // 껍데기는 이미 화면 밖(옛 몸)에 있다 — 늦게 걷어도 보이는 것은 같다.
      defer(() => handle.remove());
    };
    // 두께·색은 update 로만 바꾼다. 켬/끔이 아닌 값 변화로 껍데기를 다시 만들지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, classify, outline.enabled, defer]);
  useEffect(() => {
    outlineHandle.current?.update(outline);
  }, [outline]);
  useEffect(() => {
    registerDiagnostics(prepared, { clipNames: [...LOCOMOTION_CLIPS, "Idle_Loop", "Jump_Loop", "Punch_Cross"] });
  }, [prepared]);

  // 파츠 표시·색: Meshy 파츠는 텍스처가 색을 담고 있어 선택 색을 곱한다.
  const appearance = useMemo<MeshAppearanceConfig>(
    () => ({ ...DEFAULT_MESH_CONFIG, ...config }),
    // 외형 값만 본다 — 동작(motion)만 바뀌어도 파츠를 다시 칠하지 않게.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      config.hair,
      config.shoes,
      config.skinColor,
      config.hairColor,
      config.clothColor,
      config.bottomColor,
      config.shoesColor,
      config.gender,
      config.shoulderWidth,
      config.hipWidth,
      config.buff,
      config.heavy,
      config.skinny,
      config.armThickness,
      config.legThickness,
      config.handScale,
      config.footScale,
      config.fistHands,
    ],
  );

  // 그리기 전에 맞춘다. 새 몸은 GLB 파츠가 전부 보이는 채 시작해, 늦으면 안 고른 머리와 벗은 신발이
  // 한 프레임 같이 보인다(머리가 겹쳐 '귀가 하나 더').
  useLayoutEffect(() => {
    if (body !== "meshy") {
      prepared.skinMaterials.forEach((material) =>
        setMaterialColor(material, config.skinColor ?? DEFAULT_CHIBI_CONFIG.skinColor ?? ""),
      );
      return;
    }
    const colors: Record<string, string | undefined> = {
      body: appearance.skinColor,
      hair: appearance.hairColor,
      top: appearance.clothColor,
      bottom: appearance.bottomColor ?? appearance.clothColor,
      // 신발은 따로 된 GLB 라 정점 표식이 없다 — 재질 색을 그대로 곱한다
      shoes: appearance.shoesColor ?? "#ffffff",
    };
    const wearsShoes = (appearance.shoes ?? -1) >= 0;
    // 슬라이더 → morph target. 어깨는 뼈로 넓히고(모프는 팔이 처진다), 신발을 신으면 발은 발뼈 배율로 키운다.
    const morphs: Record<string, number> = {
      heavy: appearance.heavy,
      skinny: appearance.skinny,
      buff: appearance.buff,
      shoulderWidth: 0,
      hipWidth: (appearance.hipWidth - 1) / 0.3,
      armThickness: (appearance.armThickness - 1) / 0.3,
      legThickness: (appearance.legThickness - 1) / 0.3,
      handScale: (appearance.handScale - 1) / 0.3,
      footScale: wearsShoes ? 0 : (appearance.footScale - 1) / 0.3,
      // 평소 손 모양(옷장). 물건을 들 때 감는 건 useFrame 이 이 위에 얹는다 — 지우면 옷장 미리보기 손이 안 바뀐다.
      fistHands: appearance.fistHands,
    };
    // 몸과 옷은 한 메시라 재질 색으로는 못 가른다. 정점 표식이 있는 툰 재질일 때만 피부·의상을 따로 칠한다.
    const hasTintMarks = Boolean(toonHandle.current?.hasTintMarks);
    prepared.parts.forEach(({ object, slot, variant }) => {
      if (slot === "hair" || slot === "shoes") object.visible = variant === appearance[slot];
      Object.entries(morphs).forEach(([key, value]) => setMorph(object, key, value));
      const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
      const paint = slot === "hair" || slot === "shoes" || !hasTintMarks ? (colors[slot] ?? "#ffffff") : "#ffffff";
      materials.forEach((material) => setMaterialColor(material, paint));
    });
    // 숨긴 파츠의 외곽선 껍데기도 같이 숨긴다 — 안 그러면 맨발에 검은 신발 실루엣이 남는다.
    outlineHandle.current?.syncVisibility();
    toonHandle.current?.tint({
      skin: appearance.skinColor,
      cloth: appearance.clothColor,
      // 하의는 정점 표식 3 으로 따로 칠한다
      bottom: appearance.bottomColor ?? appearance.clothColor,
    });
    // 툰 재질이 붙은 뒤에 칠해야 하므로 툰 켬/끔도 의존성에 둔다.
  }, [prepared, appearance, body, config.skinColor, toon.enabled]);

  const mixer = useMemo(() => new THREE.AnimationMixer(prepared.targetSkin), [prepared.targetSkin]);
  const actions = useRef(new Map<string, THREE.AnimationAction>());
  const currentMotion = useRef<string | null>(null);
  const airborneSince = useRef<number | null>(null);
  const wasAirborne = useRef(false);
  const jumpStartEnd = useRef(0);
  const landingEnd = useRef(0);
  const lastAttack = useRef(0);
  const attackEnd = useRef(0);
  const inverseModel = useMemo(() => new THREE.Matrix4(), []);
  const point = useMemo(() => new THREE.Vector3(), []);
  const [H, K, F, F2, T, u, v, n] = useMemo(() => Array.from({ length: 8 }, () => new THREE.Vector3()), []);
  const pq = useMemo(() => new THREE.Quaternion(), []);
  const wq = useMemo(() => new THREE.Quaternion(), []);
  const worldSide = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const footContactDebug = useRef<FootContactDebug | null>(null);
  // IK 가 만진 다리 뼈의 클립 자세 보관함. 믹서는 값이 지난 프레임과 같으면 본에 안 쓰므로(정지·검증시각)
  // 안 쓴 프레임엔 되돌려야 IK 가 누적되지 않는다(0.7cm 요청이 몇 프레임 뒤 14cm 에서 포화).
  const legStore = useRef(new Map<THREE.Bone, { clip: THREE.Quaternion; ik: THREE.Quaternion | null }>());
  // IK 양의 지난 프레임 값 — 시간 평활용.
  const contactSmooth = useRef<Record<Side, { lift: number; drop: number }>>({
    l: { lift: 0, drop: 0 },
    r: { lift: 0, drop: 0 },
  });
  // 발바닥 최저점 캐시 — 정점 7731 개를 매 프레임 훑는 값이 아바타당 3.0ms 다.
  const soleHeightCache = useRef<number | null>(null);
  const soleFingerprint = useRef("");
  const fadeEnd = useRef(0);
  // 주먹 쥠의 지난 프레임 값. 모프는 믹서 블렌드를 못 타서 시간으로 직접 푼다(안 그러면 손 모양이 툭 바뀐다).
  const gripAmount = useRef(0);
  // 몸이 새로 만들어질 때(옷·성별) 하던 동작과 그 시각을 넘겨 주는 쪽지.
  const resumePose = useRef<{ motion: string | null; time: number; writtenAt: number } | null>(null);

  useEffect(
    () => () => {
      // 떠나기 전에 무엇을 몇 초째 돌고 있었는지 적어 둔다. 새 몸이 붙기까지(0.2초쯤) 더 돌려 놓는다.
      const current = currentMotion.current;
      const action = current ? actions.current.get(current) : undefined;
      resumePose.current = action ? { motion: current, time: action.time, writtenAt: performance.now() } : null;
      mixer.stopAllAction();
      actions.current.clear();
      // StrictMode 재실행 뒤에도 T포즈에 멈추지 않게 이름까지 비운다.
      currentMotion.current = null;
      mixer.uncacheRoot(prepared.targetSkin);
    },
    [mixer, prepared.targetSkin],
  );

  const play = (name: string) => {
    if (name === currentMotion.current) return;
    let action = actions.current.get(name);
    if (!action) {
      const clip = prepared.clipFor(name);
      if (!clip) return;
      action = mixer.clipAction(clip, prepared.targetSkin);
      actions.current.set(name, action);
    }
    const previous = currentMotion.current ? actions.current.get(currentMotion.current) : undefined;
    previous?.fadeOut(0.16);
    action.reset().setEffectiveTimeScale(name.startsWith("Punch_") ? 1.2 : 1);
    // 앞 동작이 없으면 섞지 않고 바로 100% — fadeIn 은 바인드 포즈와 섞여 갈아입을 때마다 움찔했다.
    if (previous) action.fadeIn(0.16);
    else action.setEffectiveWeight(1);
    // 옷만 갈아입었으면 하던 동작을 이어서 — 새 믹서는 0초부터라 걸음이 되감겨 보였다.
    const resume = resumePose.current;
    resumePose.current = null;
    if (resume && resume.motion === name) {
      const duration = action.getClip().duration;
      const elapsed = Math.max(0, (performance.now() - resume.writtenAt) / 1000);
      // 오래 떠나 있었으면(씬 전환·탭 멈춤) 이어 붙일 의미가 없다.
      if (duration > 0 && elapsed < 2) action.time = (resume.time + elapsed) % duration;
    }
    const loop = name.endsWith("_Loop") || name === "A_TPose" || name === "Sword_Idle";
    action.clampWhenFinished = !loop;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1).play();
    currentMotion.current = name;
  };

  // playerRef.current 는 일부러 양방향으로 쓰는 상자다(avatarLink.ts). 프레임마다 바뀌는 런타임 상태라
  // state 로 올리면 매 프레임 리렌더가 난다.
  useFrame(({ clock }, delta) => {
    const group = root.current;
    const state = playerRef.current;
    if (!group || !state) return;
    // 잘림면 붙이기 — 마운트 뒤 한 프레임만.
    const attachClipPlanes = () =>
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const m = o.material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        if (Array.isArray(m)) m.forEach((one) => (one.clippingPlanes = CLIP_PLANES));
        else m.clippingPlanes = CLIP_PLANES;
      });
    if (!clipAttached.current) {
      clipAttached.current = true;
      attachClipPlanes();
    }
    // 게임이 프레임마다 내려 주는 「몸만 그려라」(물건을 들거나 [E] 로 뻗는 동안). prop 이면 집을 때마다 리렌더가 난다.
    // firstPersonBody prop 으로 켠 경우는 showBody 와 상관없이 그린다.
    const bodyOnly = firstPersonBody || (CLIPPING.showBody && !visible && !!state.firstPersonHands);
    // 몸만 켜지는 순간 한 번 더 붙인다 — 첫 프레임 뒤에 생긴 외곽선 껍데기가 안 잘린 채 목 단면을 비췄다.
    if (bodyOnly && !wasBodyOnly.current) attachClipPlanes();
    wasBodyOnly.current = bodyOnly;
    const shouldDraw = visible || bodyOnly;
    group.visible = shouldDraw;
    // 손뼈·주먹 중심·소켓을 상자에 얹는다. 쓰는 쪽은 본편이 정한다(이 파일은 본편을 모른다).
    // 몸을 안 그릴 때는 비운다 — 아래에서 바로 빠져나가 뼈가 멈추므로, 든 물건이 안 보이는 몸 속에 박힌다.
    // 뼈가 없으면 쓰는 쪽이 카메라 기준 자리(1인칭 갈래)로 그린다.
    const exportHands = shouldDraw;
    state.rightHand = exportHands ? (prepared.handBones[1] ?? prepared.handBones[0] ?? null) : null;
    state.leftHand = exportHands ? (prepared.handBones[0] ?? null) : null;
    state.rightPalm = exportHands ? (prepared.palms.hand_r ?? null) : null;
    state.leftPalm = exportHands ? (prepared.palms.hand_l ?? null) : null;
    state.rightGripSocket = exportHands ? (prepared.gripSockets.hand_r ?? null) : null;
    state.leftGripSocket = exportHands ? (prepared.gripSockets.hand_l ?? null) : null;
    if (!shouldDraw) return;
    const avatarScale = scale * (config.heightScale ?? 1);

    // 걷기는 언제나 걷기 클립. 달릴 때만 실제 속도에 보폭이 가장 가까운 클립을 고른다(남는 차이는 재생 속도로).
    const pickByStride = (groundSpeed: number, candidates: string[]) => {
      let best = candidates[0];
      let bestError = Infinity;
      candidates.forEach((name) => {
        const own = prepared.strideFor(name) * avatarScale;
        if (own <= 1e-4) return;
        const error = Math.abs(Math.log(Math.max(1e-4, groundSpeed) / own));
        if (error < bestError) {
          bestError = error;
          best = name;
        }
      });
      return best;
    };

    const now = clock.elapsedTime;
    if ((state.attackSerial ?? 0) !== lastAttack.current) {
      lastAttack.current = state.attackSerial ?? 0;
      const attackClip = state.attackMotion ? prepared.clipFor(state.attackMotion) : null;
      attackEnd.current = now + THREE.MathUtils.clamp((attackClip?.duration ?? 0.62) / 1.2, 0.45, 0.82);
    }
    let next = config.motion;
    if (!next || next === AUTO_MOTION) {
      if (!state.grounded && airborneSince.current === null) airborneSince.current = now;
      if (state.grounded) airborneSince.current = null;
      const confirmedAir =
        state.jumping || (!state.grounded && airborneSince.current !== null && now - airborneSince.current > 0.12);
      if (now < attackEnd.current && state.attackMotion) next = state.attackMotion;
      else if (confirmedAir) {
        if (!wasAirborne.current) jumpStartEnd.current = now + 0.22;
        next = now < jumpStartEnd.current ? "Jump_Start" : "Jump_Loop";
      } else if (wasAirborne.current && state.grounded) {
        landingEnd.current = now + 0.28;
        next = "Jump_Land";
      } else if (now < landingEnd.current) next = "Jump_Land";
      else if (state.crouching) next = state.moving ? "Crouch_Fwd_Loop" : "Crouch_Idle_Loop";
      else if (state.moving) {
        next = state.running
          ? pickByStride(state.speed ?? 0, [config.runMotion || "Jog_Fwd_Loop", "Sprint_Loop"])
          : config.walkMotion || "Walk_Loop";
      } else next = "Idle_Loop";
      wasAirborne.current = confirmedAir;
    }
    // 대기는 남녀 같은 클립(Tripo Idle_Loop — 허리에 손). 팔짱 클립(Idle_Fold_Loop)은 어깨가 넓은 Tripo 리그로
    // 만든 자세라 손이 반대팔을 뚫거나 떠서 걷어냈다(파일엔 남아 있다). 남성은 대기 덧값으로 다리를 벌린다.
    const previousMotion = currentMotion.current;
    play(next);
    // 크로스페이드(0.16초) 중에는 두 클립이 섞여 발이 옮겨 간다 — 그동안은 캐시를 안 쓴다.
    if (currentMotion.current !== previousMotion) fadeEnd.current = now + 0.2;
    const action = currentMotion.current ? actions.current.get(currentMotion.current) : undefined;
    // 발이 안 미끄러지게 걷기·달리기 재생 속도를 실제 이동 속도에 맞춘다.
    if (action && fixedTime === null && LOCOMOTION_CLIPS.has(next)) {
      const own = prepared.strideFor(next) * avatarScale;
      const groundSpeed = state.speed ?? 0;
      action.setEffectiveTimeScale(own > 1e-4 ? THREE.MathUtils.clamp(groundSpeed / own, 0.45, 2.2) : 1);
    }
    if (fixedTime !== null && action) {
      actions.current.forEach((other) => {
        if (other !== action) other.stop();
      });
      action.stopFading().setEffectiveWeight(1).play();
      action.time = fixedTime % Math.max(0.001, action.getClip().duration);
      mixer.update(0);
    } else mixer.update(delta);

    // 1인칭이면 머리를 없앤다 — 카메라가 머리 안에 있다. 0 은 행렬이 뒤집혀 아주 작은 값으로 접는다.
    prepared.headBone?.scale.setScalar(bodyOnly ? 1e-4 : (config.headScale ?? 1));
    // 머리만 접으면 목 기둥이 남아 잘린 단면이 비쳤다. 목째 접으면 쇄골 사이 한 점으로 모인다.
    if (prepared.neckBone) prepared.neckBone.scale.setScalar(bodyOnly ? 1e-4 : 1);
    // 1인칭: 시선축에 수직인 평면을 카메라 앞 near 에 세우고 그 뒤를 버린다.
    if (bodyOnly) {
      camera.getWorldDirection(_clipForward);
      const near = state.crouching ? CLIPPING.crouchNear : CLIPPING.near;
      _clipPoint.copy(camera.position).addScaledVector(_clipForward, near * scale);
      clipPlane.normal.copy(_clipForward);
      // 평면식 n·p + c = 0. c = −n·q 면 q 뒤가 잘린다.
      clipPlane.constant = -_clipForward.dot(_clipPoint);
    } else {
      // 상수를 크게 두면 늘 앞쪽이라 아무것도 안 자른다.
      clipPlane.constant = 1e6;
    }
    // 팔·다리 길이 — 믹서가 쓴 뒤에 덮어야 한다(클립에 위치·배율 트랙이 있을 수 있다).
    const armLength = config.armLength ?? 1;
    const legLength = config.legLength ?? 1;
    prepared.armRoots.forEach((bone) => bone.scale.setScalar(armLength));
    prepared.legRoots.forEach((bone) => bone.scale.setScalar(legLength));
    // 손은 팔 배율을 물려받아 되돌린다(손 크기는 모프로).
    prepared.handBones.forEach((bone) => bone.scale.setScalar(1 / armLength));

    // 주먹 쥐기 — 들었다 놓는 건 매 프레임 상태라 여기다. 이 리그는 손가락 뼈가 없어 fistHands 모프가 유일한 손잡이다.
    // 게임이 안 보내면 섞기 0 → 옷장 값과 정확히 같은 수가 나온다.
    if (prepared.fistMorphs.length) {
      const blend = Math.max(0, Math.min(1, state.gripBlend ?? 0));
      gripAmount.current += (blend - gripAmount.current) * (1 - Math.exp(-delta * GRIP_CLOSE_SPEED));
      const resting = appearance.fistHands ?? 0;
      // 쥘 때 값은 절대값 — 상자를 받치는 펴진 손(쥠세기 < 평소)을 만들 수 있어야 한다.
      const gripping = Math.max(0, Math.min(1, state.gripStrength ?? resting));
      const fist = resting + (gripping - resting) * gripAmount.current;
      prepared.fistMorphs.forEach(({ mesh, index }) => {
        if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = fist;
      });
    }

    const shoulderWidth = config.shoulderWidth ?? 1;
    prepared.shoulderBones.forEach(({ bone, rest }) => bone.position.copy(rest).multiplyScalar(shoulderWidth));
    const wearsShoes = isMeshy && (config.shoes ?? -1) >= 0;
    // 신발 GLB 엔 모프가 없어, 신었을 때는 발뼈 배율로 신발째 키운다(그때 몸 모프는 0). 다리 배율도 되돌린다.
    prepared.footBones.forEach((bone) =>
      bone.scale.setScalar((wearsShoes ? prepared.shoeShrink * (config.footScale ?? 1) : 1) / legLength),
    );
    // 발볼은 신발 안에서 접히기만 하면 된다.
    prepared.ballBones.forEach((bone) => bone.scale.setScalar(wearsShoes ? 0.02 : 1));

    group.position.set(state.position.x, state.footY, state.position.z);
    group.rotation.set(0, state.facing, 0);
    // 1인칭 「몸만」: 몸을 뒤로 물려 카메라가 눈 자리에 오게 한다. facing 규약: 앞 = (sin f, cos f).
    if (bodyOnly && CLIPPING.bodyBack) {
      const back = CLIPPING.bodyBack * scale;
      group.position.x -= Math.sin(state.facing) * back;
      group.position.z -= Math.cos(state.facing) * back;
    }
    group.scale.setScalar(avatarScale);
    group.updateMatrixWorld(true);

    // 팔 IK 는 몸 변환을 맞춘 뒤에 푼다 — 그 전이면 지난 프레임 몸 자리 기준이라 걸을 때 한 프레임씩 어긋났다.
    // 각을 찍지 않고 2본 IK 로 '손이 갈 자리'를 준다(X −75° 를 넣었더니 이 리그에선 팔이 등 뒤로 뻗었다).
    // 팔꿈치는 몸 뒤·아래로 빠져야 한다 — 거리만 맞추면 새 날개처럼 위로 꺾인다.
    const armRequests: Record<Side, { weight: number; target: WorldPoint | null | undefined }> = {
      r: { weight: Math.max(0, Math.min(1, state.handIk ?? 0)), target: state.handTarget },
      l: { weight: Math.max(0, Math.min(1, state.leftHandIk ?? 0)), target: state.leftHandTarget },
    };
    // 폴은 화면을 봐야 맞출 수 있어 게임이 상자로 내려 준다. 없으면 꺼짐.
    const pole = state.armPole ?? DEFAULT_ARM_POLE;
    const debug = armIkDebug;
    if (typeof window !== "undefined") exposeDevHook("armIK", debug);
    debug.weight = armRequests.r.weight;
    debug.leftWeight = armRequests.l.weight;
    debug.hasTarget = !!armRequests.r.target;
    debug.leftHasTarget = !!armRequests.l.target;
    debug.armCount = prepared.arms.length;
    // 물건을 안 들어도 보여야 해서 IK 분기 밖에 둔다.
    debug.torsoHalfDepth = state.torsoHalfDepth ?? null;
    debug.handRotationWeight = state.handRotationWeight ?? null;
    debug.hasHandRotation = !!state.handRotation;
    debug.hasSocket = !!state.rightGripSocket;
    debug.mode = pole.enabled ? "폴벡터" : "옛(부호시험)";

    group.updateMatrixWorld(true);

    // 어깨 자리·팔 길이는 IK 를 걸든 안 걸든 알린다 — 아무것도 안 든 첫 프레임에 게임이 어림값으로 목표를 잡아 팔이 튀었다.
    // 품에 안는 자리가 두 어깨의 한가운데라 왼어깨도 낸다.
    prepared.arms.forEach(({ side, upper, lower, hand }) => {
      _S.setFromMatrixPosition(upper.matrixWorld);
      _E.setFromMatrixPosition(lower.matrixWorld);
      _W.setFromMatrixPosition(hand.matrixWorld);
      if (side === "r") {
        state.shoulderPosition = { x: _S.x, y: _S.y, z: _S.z };
        state.shoulderHeight = _S.y;
        state.armLength = _S.distanceTo(_E) + _E.distanceTo(_W);
        // 가슴 두께 — 게임이 든 물건을 몸에서 얼마나 띄울지. 모델 좌표로 재서 세계 배율을 곱한다.
        if (state.torsoHalfDepth === undefined) {
          const skin = prepared.targetSkin;
          const rightUpper = prepared.arms.find((a) => a.side === "r")?.upper;
          if (skin && rightUpper) {
            _bodyV.setFromMatrixPosition(rightUpper.matrixWorld);
            prepared.model.worldToLocal(_bodyV);
            const depth = chestHalfDepth(skin, _bodyV.y, _bodyV.z);
            state.torsoHalfDepth = depth == null ? null : depth * (prepared.model.getWorldScale(_bodyScale).x || 1);
          } else state.torsoHalfDepth = null;
        }
      } else {
        state.leftShoulderPosition = { x: _S.x, y: _S.y, z: _S.z };
      }
    });

    // 뼈를 관절 기준으로 돌려 current 점이 goal 점을 향하게 한다.
    const aimBone = (bone: THREE.Bone, current: THREE.Vector3, goal: THREE.Vector3, joint: THREE.Vector3) => {
      _u.copy(current).sub(joint);
      _v.copy(goal).sub(joint);
      if (_u.lengthSq() < 1e-10 || _v.lengthSq() < 1e-10) return;
      _worldQ.setFromUnitVectors(_u.normalize(), _v.normalize());
      rotateInWorld(bone, _worldQ, _parentQ);
    };

    const writeDebug = (side: Side, upperLength: number | null, lowerLength: number) => {
      if (side !== "r") return;
      // 배열·문자열을 프레임마다 만드는 값이라 개발 중에만 적는다.
      if (!import.meta.env.DEV) return;
      const rightArm = prepared.arms.find((a) => a.side === "r");
      if (rightArm) _W2.setFromMatrixPosition(rightArm.hand.matrixWorld);
      debug.shoulder = roundedPoint(_S);
      debug.target = roundedPoint(_T);
      debug.hand = roundedPoint(_W2);
      debug.remainingDistance = +_W2.distanceTo(_T).toFixed(3);
      debug.shoulderToTarget = +_S.distanceTo(_T).toFixed(3);
      if (upperLength != null) debug.armLength = +(upperLength + lowerLength).toFixed(3);
    };

    // 폴 방식: 팔 평면을 먼저 정하고 한 번에 푼다. 2본 IK 해는 어깨–손 축을 도는 원뿔 전체라, 굽혀 놓고
    // 부호를 사후에 뒤집으면 팔꿈치가 몸 옆 경계를 스칠 때 딸깍거린다(Unity TwoBoneIK Hint · UE Two Bone IK).
    const solveWithPole = ({ side, upper, lower, hand }: Arm, weight: number, target: WorldPoint) => {
      _S.setFromMatrixPosition(upper.matrixWorld);
      _E.setFromMatrixPosition(lower.matrixWorld);
      _W.setFromMatrixPosition(hand.matrixWorld);
      const L1 = _S.distanceTo(_E);
      const L2 = _E.distanceTo(_W);
      if (L1 < 1e-5 || L2 < 1e-5) return;
      // 가중치만큼만 당긴다 — 0 이면 클립 자세, 1 이면 목표에 딱.
      _T.set(target.x, target.y, target.z).sub(_W).multiplyScalar(weight).add(_W);
      _axis.copy(_T).sub(_S);
      if (_axis.lengthSq() < 1e-10) return;
      const d = THREE.MathUtils.clamp(_axis.length(), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
      _axis.normalize();
      // ① 지금(클립) 팔꿈치 쪽 — 어깨→목표 축에 수직인 성분만.
      _pole.copy(_E).sub(_S);
      _pole.addScaledVector(_axis, -_pole.dot(_axis));
      // ② 몸에 고정된 폴 쪽(뒤·아래·바깥). 모델 로컬 +x 가 왼쪽, +z 가 앞이다. 방향만 쓰므로 거리는 안 맞춘다.
      if (pole.enabled) {
        _fixedPole
          .set((side === "l" ? 1 : -1) * pole.outward, -pole.down, -pole.back)
          .applyQuaternion(group.quaternion);
        _fixedPole.addScaledVector(_axis, -_fixedPole.dot(_axis));
        // 클립 쪽 → 고정 쪽으로 섞는다. 곧장 못 박으면 물건을 드는 순간 팔꿈치가 홱 돈다.
        const mix = THREE.MathUtils.clamp(pole.weight * weight, 0, 1);
        if (_fixedPole.lengthSq() > 1e-8) {
          _fixedPole.normalize();
          if (_pole.lengthSq() < 1e-8) _pole.copy(_fixedPole);
          else
            _pole
              .normalize()
              .multiplyScalar(1 - mix)
              .addScaledVector(_fixedPole, mix);
        }
      }
      // 축과 폴이 겹쳤다(팔이 곧게 펴짐) — 이번 프레임은 안 건드린다. 아무 평면이나 고르면 딸깍이 다시 생긴다.
      if (_pole.lengthSq() < 1e-8) return;
      _pole.normalize();
      // ③ 팔꿈치 자리 — 코사인 법칙을 각이 아니라 자리로 푼다.
      const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      _elbowGoal.copy(_S).addScaledVector(_axis, a).addScaledVector(_pole, h);
      _wristGoal.copy(_S).addScaledVector(_axis, d);
      // ④ 뼈 둘을 그 자리에 한 번씩 맞춘다. 길이가 그대로라 정확히 겹친다.
      aimBone(upper, _E, _elbowGoal, _S);
      _E.setFromMatrixPosition(lower.matrixWorld);
      _W.setFromMatrixPosition(hand.matrixWorld);
      aimBone(lower, _W, _wristGoal, _E);
      if (side === "r") {
        writeDebug(side, L1, L2);
        if (import.meta.env.DEV) debug.elbow = roundedPoint(_elbowGoal);
      }
    };

    // 옛 방식(폴 없음) — 폴이 꺼져 있을 때의 기본. 오른팔은 이 방식으로 화면을 보며 맞춰 둔 상태라
    // 새 방식이 더 낫다고 눈으로 확인하기 전까지 지우지 않는다.
    const solveLegacy = ({ side, upper, lower, hand }: Arm, weight: number, target: WorldPoint) => {
      _S.setFromMatrixPosition(upper.matrixWorld);
      _W.setFromMatrixPosition(hand.matrixWorld);
      _T.set(target.x, target.y, target.z).sub(_W).multiplyScalar(weight).add(_W);
      let L1 = 0;
      let L2 = 0;
      for (let pass = 0; pass < 2; pass += 1) {
        _S.setFromMatrixPosition(upper.matrixWorld);
        _E.setFromMatrixPosition(lower.matrixWorld);
        _W.setFromMatrixPosition(hand.matrixWorld);
        L1 = _S.distanceTo(_E);
        L2 = _E.distanceTo(_W);
        if (L1 < 1e-5 || L2 < 1e-5) break;
        const d = THREE.MathUtils.clamp(_S.distanceTo(_T), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
        // 코사인 법칙 — 팔꿈치 안쪽 각
        const goalAngle = Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
        _u.copy(_S).sub(_E).normalize();
        _v.copy(_W).sub(_E).normalize();
        const currentAngle = Math.acos(THREE.MathUtils.clamp(_u.dot(_v), -1, 1));
        _n.crossVectors(_u, _v);
        if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0).applyQuaternion(group.quaternion);
        _n.normalize();
        const rotateArm = (bone: THREE.Bone, axis: THREE.Vector3, angle: number) => {
          _worldQ.setFromAxisAngle(axis, angle);
          rotateInWorld(bone, _worldQ, _parentQ);
        };
        // 팔꿈치가 몸 뒤로 빠졌나 — 어깨·손 중점에서 팔꿈치로 가는 벡터의 −z 성분
        const elbowBehind = () => {
          _E.setFromMatrixPosition(lower.matrixWorld);
          _W2.setFromMatrixPosition(hand.matrixWorld);
          _u.copy(_E).sub(_v.copy(_S).add(_W2).multiplyScalar(0.5));
          _v.set(0, 0, -1).applyQuaternion(group.quaternion);
          return _u.dot(_v);
        };
        rotateArm(lower, _n, goalAngle - currentAngle);
        _W2.setFromMatrixPosition(hand.matrixWorld);
        if (Math.abs(_S.distanceTo(_W2) - d) > 1e-3 || elbowBehind() < 0) {
          rotateArm(lower, _n, -2 * (goalAngle - currentAngle));
          _W2.setFromMatrixPosition(hand.matrixWorld);
          if (Math.abs(_S.distanceTo(_W2) - d) > 1e-3 && elbowBehind() < 0) {
            // 어느 쪽도 아니면 원래대로
            rotateArm(lower, _n, goalAngle - currentAngle);
            _W2.setFromMatrixPosition(hand.matrixWorld);
          }
        }
        // 어깨 — 손이 목표를 향하도록 팔 전체를 돌린다
        _u.copy(_W2).sub(_S).normalize();
        _v.copy(_T).sub(_S).normalize();
        _worldQ.setFromUnitVectors(_u, _v);
        rotateInWorld(upper, _worldQ, _parentQ);
      }
      writeDebug(side, L1, L2);
    };

    // 왼팔은 게임이 왼손목표를 줄 때만 돈다 — 안 주면 예전과 한 픽셀도 안 다르다.
    prepared.arms.forEach((arm) => {
      const { weight, target } = armRequests[arm.side];
      if (!(weight > 0.001) || !target) return;
      (pole.enabled ? solveWithPole : solveLegacy)(arm, weight, target);
    });

    // 손목을 물건에 맞춘다 — 2본 IK 는 자리만 풀어 손등 방향이 늘 클립 그대로였다(UE Effector Rotation 과 같은 것).
    // "손등이 어디를 봐야 하나"는 물건 쪽 사실이라 게임이 완성된 세계 회전을 준다.
    const alignWrist = (arm: Arm, target: { x: number; y: number; z: number; w: number }, strength: number) => {
      const { hand } = arm;
      if (!hand || !(strength > 0.001) || !target) return;
      // 기준은 지금 클립이 만든 손 자세다 — hand_r bind 가 X −90° 라 아래팔 기준으로 자르면 매 프레임 손이 끌려갔다.
      _restQ.copy(hand.getWorldQuaternion(_lowerArmQ));
      // 목표는 다른 그릇에 담는다 — three 의 slerpQuaternions 가 this === qb 면 목표를 먼저 덮어쓴다.
      _goalQ.set(target.x, target.y, target.z, target.w);
      // 세기만큼만 간 뒤 한계로 자른다(rotateTowards 는 목표를 넘지 않는다)
      _handQ.copy(_restQ).slerp(_goalQ, Math.min(1, strength));
      _restQ.rotateTowards(_handQ, (WRIST_LIMIT * Math.PI) / 180);
      hand.parent?.getWorldQuaternion(_handParentQ);
      hand.quaternion.copy(_handParentQ.invert().multiply(_restQ));
      hand.updateMatrixWorld(true);
    };
    const wristStrength = Math.max(0, Math.min(1, state.handRotationWeight ?? 0));
    if (wristStrength > 0.001) {
      const rightArm = prepared.arms.find((a) => a.side === "r");
      const leftArm = prepared.arms.find((a) => a.side === "l");
      if (rightArm && state.handRotation && armRequests.r.weight > 0.001)
        alignWrist(rightArm, state.handRotation, wristStrength);
      if (leftArm && state.leftHandRotation && armRequests.l.weight > 0.001)
        alignWrist(leftArm, state.leftHandRotation, wristStrength);
    }

    // 발마다 발바닥 최저점(모델 좌표). 스키닝 결과를 읽으므로 뼈 행렬을 먼저 굽는다.
    inverseModel.copy(prepared.model.matrixWorld).invert();
    const soleHeight = (side: Side) => {
      let y = Infinity;
      prepared.soles.forEach(({ object, left, right }) => {
        if (!object.visible) return;
        const list = side === "l" ? left : right;
        for (let i = 0; i < list.length; i += 3) {
          object.getVertexPosition(list[i], point);
          object.localToWorld(point).applyMatrix4(inverseModel);
          y = Math.min(y, point.y);
        }
      });
      return y;
    };

    // 접지 IK — 낮은 발은 땅에 붙고(아래 지면 맞추기), 다른 발이 접지 직전이면 엉덩이+무릎 2본 IK 로 그 발을
    // 수직으로 땅까지 내린다. 리타게팅 클립은 앞발이 땅에 못 닿은 채 딛는다 — '앞발이 높은 곳을 딛는' 것과
    // '다리가 안 펴지는' 것의 같은 원인이다. 무릎만 펴면 발이 앞·위로 가서 엉덩이까지 푼다.
    // 스윙 중인 발은 건드리지 않는다(창을 넓혔더니 공중 다리를 붙잡아 곧게 뻗었다). Tripo 클립은 끈다.
    const useFootContact = prepared.tripoClips.includes(next)
      ? TRIPO_CORRECTION.footContactEnabled !== false
      : prepared.correction?.footContactEnabled !== false;
    if (useFootContact && prepared.legs.length === 2 && prepared.pelvisBone) {
      // 믹서가 이번 프레임에 뼈를 썼으면(남긴 IK 값과 다르면) 그게 클립 자세, 안 썼으면 보관한 클립 자세로 되돌린다.
      prepared.legs.forEach((leg) =>
        [leg.thigh, leg.calf].forEach((bone) => {
          let entry = legStore.current.get(bone);
          if (!entry) {
            entry = { clip: bone.quaternion.clone(), ik: null };
            legStore.current.set(bone, entry);
          } else if (entry.ik && bone.quaternion.equals(entry.ik)) bone.quaternion.copy(entry.clip);
          else entry.clip.copy(bone.quaternion);
        }),
      );
      prepared.legs.forEach((leg) => {
        leg.thigh.updateMatrixWorld(true);
      });
      prepared.targetSkin.skeleton.update();
      const heights = prepared.legs.map((leg) => soleHeight(leg.side));
      const lower = heights[0] <= heights[1] ? 0 : 1;
      const other = 1 - lower;
      // 모델 단위
      const gap = heights[other] - heights[lower];
      const contactWindow = (prepared.correction?.footContactWindow ?? 0.045) * 1.45;
      const leg = prepared.legs[other];
      // 골반보다 앞에 있는(다가오는) 발만 — 빼면 떼는 뒷발이 창에 걸려 뒷다리가 70° 로 꺾였다.
      point.setFromMatrixPosition(leg.foot.matrixWorld).applyMatrix4(inverseModel);
      const footZ = point.z;
      point.setFromMatrixPosition(prepared.pelvisBone.matrixWorld).applyMatrix4(inverseModel);
      // 문턱은 전부 부드러운 가중치 — 딱딱한 on/off 는 양발 지지에서 IK 가 켜졌다 꺼져 몸이 12Hz 로 떨렸다.
      const aheadWeight = THREE.MathUtils.smoothstep(footZ - point.z, 0.01, 0.03);
      const isAhead = aheadWeight > 0.001;
      const gapWeight =
        THREE.MathUtils.smoothstep(gap, 0.002, 0.008) *
        (1 - THREE.MathUtils.smoothstep(gap, contactWindow * 0.7, contactWindow));
      // 접지 시각 창: 평평하게 붙는 시각의 25% 전 ~ 3% 후. 그 안에서 가중치를 0→1→0 으로 매끄럽게 —
      // 온/오프면 닿는 순간 다리가 '탁' 펴졌다. 접근(앞다리가 엉덩이로 내린다) 뒤 하중(디딘 다리를 굽혀 골반을 내린다).
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
        footContactDebug.current = {
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
        // 틈을 두 다리가 나눈다. 앞다리만 내리면 무릎이 2° 로 잠기고, 디딘 다리만 올리면 80° 로 꺾였다.
        // 앞다리 몫엔 낮은 상한을 두고 남는 틈은 둔다(원본도 뒤꿈치 접지 때 1cm 떠 있다).
        const weight = contactWeight * aheadWeight * gapWeight;
        const limit = (prepared.correction?.footContactDrop ?? 0.03) * 1.45 * weight;
        const frontLimit = (prepared.correction?.footContactFrontLimit ?? 0.015) * 1.45 * weight * frontShare;
        goal[leg.side].drop = Math.min(gap, frontLimit);
        goal[prepared.legs[lower].side].lift = Math.min(gap - goal[leg.side].drop, limit);
      }
      // 시간 평활(시정수 40ms) — 남은 프레임 단위 꺾임(무릎 2~5°)을 누른다.
      const smooth = contactSmooth.current;
      const rate = 1 - Math.exp(-Math.max(0, delta) / 0.04);
      prepared.legs.forEach((l) => {
        smooth[l.side].lift += (goal[l.side].lift - smooth[l.side].lift) * rate;
        smooth[l.side].drop += (goal[l.side].drop - smooth[l.side].drop) * rate;
      });
      {
        const solveLeg = ({ thigh, calf, foot }: Leg, worldOffset: number) => {
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
        };
        prepared.legs.forEach((l) => {
          if (smooth[l.side].lift > 1e-5) solveLeg(l, smooth[l.side].lift * avatarScale);
          if (smooth[l.side].drop > 1e-5) solveLeg(l, -smooth[l.side].drop * avatarScale);
        });
        prepared.targetSkin.skeleton.update();
      }
      // IK 결과를 남겨 다음 프레임에 믹서가 썼는지 판별한다.
      prepared.legs.forEach((l) =>
        [l.thigh, l.calf].forEach((bone) => {
          const entry = legStore.current.get(bone);
          if (entry) entry.ik = (entry.ik ?? new THREE.Quaternion()).copy(bone.quaternion);
        }),
      );
    }

    // 발바닥 정점 중 가장 낮은 점을 지면에 맞춘다(발끝을 세우는 동작 포함).
    //   캐시 기준은 이동 플래그가 아니라 클립과 설정이다 — 생성 화면은 moving=false 로 걷기 클립을 돌려
    //   최저점이 38mm 움직인다. 제자리 클립 + 크로스페이드 끝 + 외형 그대로일 때만 쓴다.
    //   외형은 항목을 고르지 않고 설정 전체를 지문으로 쓴다 — 항목을 늘릴 때 여기를 잊으면 조용히 틀린다.
    const fingerprint = `${next}|${body}|${JSON.stringify(config)}`;
    const canUseCache =
      STATIONARY_CLIPS.has(next) &&
      next === currentMotion.current &&
      now >= fadeEnd.current &&
      now >= attackEnd.current &&
      state.grounded &&
      fingerprint === soleFingerprint.current &&
      soleHeightCache.current !== null;
    soleFingerprint.current = fingerprint;
    if (!canUseCache) {
      let soleY = Infinity;
      prepared.soles.forEach(({ object, indices }) => {
        if (!object.visible) return;
        // 전부 본다 — 넷 중 하나만 보면 최저점을 놓쳐 몇 mm 씩 묻히고 깜빡였다.
        for (let i = 0; i < indices.length; i += 1) {
          object.getVertexPosition(indices[i], point);
          object.localToWorld(point).applyMatrix4(inverseModel);
          soleY = Math.min(soleY, point.y);
        }
      });
      soleHeightCache.current = Number.isFinite(soleY) ? soleY : null;
    }
    if (soleHeightCache.current !== null) group.position.y = state.footY - soleHeightCache.current * avatarScale;

    if (import.meta.env.DEV) {
      chibiDebugByGender[gender] = { motion: next, current: currentMotion.current };
      exposeDevHook("chibiDebugByGender", chibiDebugByGender);
      exposeDevHook("chibiDebug", {
        visible: true,
        motion: next,
        motionCount: prepared.clipCount,
        mappedBones: prepared.mappedBones,
        gender,
        stride: Object.fromEntries([...LOCOMOTION_CLIPS].map((name) => [name, prepared.strideFor(name)])),
        contact: prepared.contactTimeFor(next),
        ik: footContactDebug.current,
        timeScale: action?.getEffectiveTimeScale?.() ?? 1,
        speed: state.speed ?? 0,
      });
    }
  }, framePriority);

  return (
    <group name="NAJU-chibi-avatar" ref={root} visible={visible || firstPersonBody}>
      <primitive object={prepared.model} />
    </group>
  );
}

// 모듈 예열은 늘 쓰는 것만 — 나주·로비는 meshy 라 chibi 몸체(6.5MB)는 쓸 때 읽는다.
useGLTF.preload(MOTION_LIBRARY_URL);
useGLTF.preload(TRIPO_MOTION_URLS);

export default ChibiGameAvatar;
