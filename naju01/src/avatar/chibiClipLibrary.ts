// 동작 클립 준비 — Quaternius·Tripo 클립을 몸 리그로 리타게팅하고 보정하며, 보폭·접지 시각을 잰다.
import * as THREE from "three";
import { clone, retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";

import {
  type CorrectionTable,
  type CorrectionValues,
  applyClipCorrection,
  computeCorrectionTable,
  LOCOMOTION_CLIPS,
} from "./motionCorrection";
import type { ContactTimes, LoadedGltf } from "./preparedBody";
import {
  attachSkeleton,
  findFirstSkinnedMesh,
  type RetargetSetup,
  computeRetargetOptions,
  measureStrideSpeed,
} from "./rig";

// 리타깃·보폭·접지 표본은 뼈대와 동작 파일만 보고 정해진다 — 옷은 껍데기라 상관없다.
// 갈아입을 때마다 다시 계산하면 멈춤이 길어진다.
// 뼈대 서명 + 보정값으로 열쇠를 만들어 모듈에 들고 있는다. 트랙 이름이 뼈 이름이라 같은 이름 뼈대면 그대로 붙는다.
interface RigStore {
  retargeted: Map<string, THREE.AnimationClip>;
  contactTimes: Map<string, ContactTimes | null>;
  strides: Map<string, number>;
}
const rigCache = new Map<string, RigStore>();
const RIG_CACHE_MAX = 6;

function computeRigSignature(skin: THREE.SkinnedMesh): string {
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

function getRigStore(key: string): RigStore {
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

export interface TripoSource {
  scene: THREE.Object3D;
  skin: THREE.SkinnedMesh;
  clips: THREE.AnimationClip[];
  options?: RetargetSetup;
}

export interface TripoSources {
  sources: TripoSource[];
  clips: Map<string, { clip: THREE.AnimationClip; source: TripoSource }>;
}

/** Tripo 동작 파일 여러 개 — 같은 이름 클립은 앞 파일이 이긴다. 클립마다 제 파일의 리그를 쓴다. */
export function loadTripoSources(tripoGltfs: LoadedGltf[] | null): TripoSources {
  const sources: TripoSource[] = (tripoGltfs ?? [])
    .map((g) => {
      const scene = clone(g.scene);
      return { scene, skin: findFirstSkinnedMesh(scene), clips: g.animations };
    })
    .filter((x): x is TripoSource => !!x.skin);
  const clips = new Map<string, { clip: THREE.AnimationClip; source: TripoSource }>();
  sources.forEach((tripo) =>
    tripo.clips.forEach((clip) => {
      if (!clips.has(clip.name)) clips.set(clip.name, { clip, source: tripo });
    }),
  );
  return { sources, clips };
}

interface ClipLibraryInput {
  retargetModel: THREE.Object3D;
  retargetSkin: THREE.SkinnedMesh;
  source: THREE.Object3D;
  sourceSkin: THREE.SkinnedMesh;
  motionGltf: LoadedGltf;
  tripo: TripoSources;
  correction: CorrectionValues;
  tripoValues: CorrectionValues;
  outerKey: string;
}

export interface ClipLibrary {
  clipFor: (name: string) => THREE.AnimationClip | null;
  strideFor: (name: string) => number;
  contactTimeFor: (name: string) => ContactTimes | null;
  clipCount: number;
  mappedBones: number;
}

export function createClipLibrary({
  retargetModel,
  retargetSkin,
  source,
  sourceSkin,
  motionGltf,
  tripo: { sources: tripoSources, clips: tripoClips },
  correction,
  tripoValues,
  outerKey,
}: ClipLibraryInput): ClipLibrary {
  const tripoSkin = tripoSources[0]?.skin ?? null;
  const options = computeRetargetOptions(retargetSkin, sourceSkin);
  tripoSources.forEach((tripo) => {
    tripo.options = computeRetargetOptions(retargetSkin, tripo.skin);
    attachSkeleton(tripo.scene, tripo.skin.skeleton);
  });
  const baseTable = computeCorrectionTable(retargetSkin, correction);
  const tripoTable = tripoSkin ? computeCorrectionTable(retargetSkin, tripoValues) : null;
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
  const foldTable = tripoSkin ? computeCorrectionTable(retargetSkin, foldValues) : null;
  // 그냥 서 있는 대기(Idle_Loop)만 따로 편다 — 걷기·달리기는 손대지 않는다.
  const idleValues: CorrectionValues = { ...tripoValues, ...(tripoValues.idleOverrides ?? {}) };
  const idleTable = tripoSkin ? computeCorrectionTable(retargetSkin, idleValues) : null;
  attachSkeleton(source, sourceSkin.skeleton);
  const sourceClips = new Map(motionGltf.animations.map((clip) => [clip.name, clip]));
  // 옷만 바뀐 것이면 앞서 계산한 리타깃·보폭·접지를 그대로 쓴다.
  const store = getRigStore(`${outerKey}|${computeRigSignature(retargetSkin)}`);
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
    if (correction.enabled) applyClipCorrection(result, table, name, values);
    retargeted.set(name, result);
    return result;
  };
  // 발마다 '접지 시각'(한 주기에서 디딤이 시작되는 순간, 0~1). 접지 IK 는 이 직전·직후에만 건다.
  // 높이만으로는 낮게 스윙하는 발과 디디려는 발을 못 가른다 — 창을 넓히면 스윙 다리를 붙잡아 곧게 뻗는다.
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
    const speed = clip && LOCOMOTION_CLIPS.has(name) ? measureStrideSpeed(retargetModel, retargetSkin, clip) : 0;
    strides.set(name, speed);
    return speed;
  };
  return {
    clipFor,
    strideFor,
    contactTimeFor,
    clipCount: sourceClips.size,
    mappedBones: Object.keys(options.names).length,
  };
}
