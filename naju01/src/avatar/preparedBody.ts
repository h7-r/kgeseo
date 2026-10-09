// 몸 GLB 하나를 런타임 아바타로 준비한다 — 복제·파츠·클립 라이브러리·뼈 찾기를 한 번에 묶고 반납 함수를 단다.
// 준비된 몸(PreparedBody)과 그 조각의 형식, 몸·동작 파일 경로도 여기 둔다.
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

import { attachParts, collectMeshParts, findRigBones } from "./chibiBodyParts";
import { createClipLibrary, loadTripoSources } from "./chibiClipLibrary";
import type { FistCenters } from "./fistCenter";
import type { MeshAppearanceConfig } from "./meshAppearance";
import { type CorrectionValues, DEFAULT_CORRECTION, TRIPO_CORRECTION } from "./motionCorrection";
import { findFirstSkinnedMesh } from "./rig";
import { AUTO_MOTION } from "./sidekickOptions";

export type Gender = "masculine" | "feminine";
export type Side = "l" | "r";

/** 몸체 파일 묶음 — chibi = V4 몸체 시제품, meshy = Meshy 몸체(착장마다 파일이 다르다) */
export type ChibiBody = "chibi" | "meshy";

/** 치비 런타임 외형 — 메시 외형 형식에서 바꿀 것만 넘긴다 */
export type ChibiAvatarConfig = Partial<MeshAppearanceConfig>;

// 발바닥이 땅에 붙은 채 안 움직이는 클립. 여기 있을 때만 발바닥 최저점을 캐시한다.
//   「플레이어가 안 움직인다」와 다른 말이다. 새 클립은 재고 넣을 것(3초 진폭 Idle_Loop 0.10mm · Walk_Loop 38mm).
export const STATIONARY_CLIPS = new Set(["Idle_Loop"]);

// meshy 는 착장마다 파일이 달라 getMeshBodyUrl 이 고른다. 여기는 chibi 몸체만.
export const CHIBI_BODY_URLS: Record<Gender, string> = {
  masculine: "/models/chibi-male.glb",
  feminine: "/models/chibi-female.glb",
};
export const MOTION_LIBRARY_URL = "/models/vendor/quaternius-universal-animation-library.glb";
// Tripo 가 몸체마다 새로 리깅해 파일마다 리그가 다를 수 있다 — 클립은 제 리그로 리타게팅한다.
export const TRIPO_MOTION_URLS: string[] = ["/models/tripo-motions.glb?v=8", "/models/tripo-motions-fold.glb?v=1"];

export const DEFAULT_CHIBI_CONFIG: ChibiAvatarConfig = {
  motion: AUTO_MOTION,
  walkMotion: "Walk_Loop",
  runMotion: "Jog_Fwd_Loop",
  gender: "masculine",
  heightScale: 1,
  headScale: 1,
  skinColor: "#f3d2bd",
};

export interface LoadedGltf {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

export interface Disposables {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

export interface PartError {
  name: string;
  missingBones: string[];
}

export interface BodyPart {
  object: THREE.Mesh;
  slot: string;
  variant: number;
}

export interface Sole {
  object: THREE.Mesh;
  indices: number[];
  left: number[];
  right: number[];
}

export interface Leg {
  side: Side;
  thigh: THREE.Bone;
  calf: THREE.Bone;
  foot: THREE.Bone;
}

export interface Arm {
  side: Side;
  upper: THREE.Bone;
  lower: THREE.Bone;
  hand: THREE.Bone;
}

export type ContactTimes = Record<Side, number>;

export interface FistMorph {
  mesh: THREE.Mesh;
  index: number;
}

export interface PreparedBody {
  /** 몸 골격에 없는 뼈를 써서 못 붙인 파츠. 비어 있어야 정상이다. */
  partErrors: PartError[];
  armRoots: THREE.Bone[];
  arms: Arm[];
  fistMorphs: FistMorph[];
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

export function prepareBody(
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
  const targetSkin = findFirstSkinnedMesh(model);
  const retargetSkin = findFirstSkinnedMesh(retargetModel);
  const sourceSkin = findFirstSkinnedMesh(source);
  if (!targetSkin || !retargetSkin || !sourceSkin)
    throw new Error("치비 몸 또는 모션 파일에서 스킨 리그를 찾지 못했습니다.");
  const tripo = loadTripoSources(tripoGltfs);
  const partErrors: PartError[] = [];
  // 이 준비가 직접 만든 GPU 자원만 모은다. GLB 가 준 지오메트리·텍스처는 useGLTF 캐시의 공용 자원이라
  // 버리면 같은 옷으로 돌아올 때 수십 MB 를 다시 올린다.
  const disposables: Disposables = { geometries: [], materials: [] };
  const shoeParts = attachParts(shoesGltf, targetSkin, partErrors, disposables);
  const { skinMaterials, parts, soles } = collectMeshParts(model, disposables);
  const clips = createClipLibrary({
    retargetModel,
    retargetSkin,
    source,
    sourceSkin,
    motionGltf,
    tripo,
    correction,
    tripoValues,
    outerKey,
  });
  targetSkin.skeleton.pose();
  model.updateMatrixWorld(true);
  const bones = findRigBones(targetSkin, model, shoeParts);
  return {
    partErrors,
    ...bones,
    model,
    targetSkin,
    clipFor: clips.clipFor,
    strideFor: clips.strideFor,
    contactTimeFor: clips.contactTimeFor,
    correction,
    clipCount: clips.clipCount,
    tripoClips: [...tripo.clips.keys()],
    mappedBones: clips.mappedBones,
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
      // 스키닝 뼈 행렬 텍스처도 뼈대마다 한 장이다 — 안 버리면 갈아입을 때마다 쌓인다.
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
