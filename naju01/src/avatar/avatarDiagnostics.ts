// 개발용 진단 — 스켈레톤·스킨메시·클립·재질을 한 번에 훑는다.
//   콘솔에 저절로 쏟지 않는다. 필요할 때 `__game.avatarDiagnostics()` 로 부른다(DEV 서버에서만 열린다).
// 월드 좌표로 걸음을 잴 때 '앞'은 시점마다 축이 다르다. 아바타는 facing 만큼 y 축으로 돌아서
// 정면(facing 0)에선 앞 = +z, 측면(facing π/2)에선 앞 = +x 다. 측면에서 z 로 재면 좌우 폭을 잰다 —
// 뼈 각도·발 높이처럼 축과 무관한 지표를 먼저 쓰고, 앞뒤는 facing 으로 되돌려 잰다.
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";

/** 진단이 읽는 아바타 준비물 */
export interface DiagnosticsTarget {
  model: THREE.Object3D;
  targetSkin: THREE.SkinnedMesh | null;
  clipFor?: (name: string) => THREE.AnimationClip | null;
  clipCount?: number;
}

export interface DiagnosticsOptions {
  clipNames?: readonly string[];
}

interface BoneRow {
  depth: number;
  name: string;
  parent: string;
  children: number;
}

type JointRow = Record<string, number>;

function collectBoneHierarchy(bone: THREE.Object3D, depth = 0, out: BoneRow[] = []): BoneRow[] {
  out.push({ depth, name: bone.name, parent: bone.parent?.name ?? "", children: bone.children.length });
  bone.children.forEach((child) => {
    if (child instanceof THREE.Bone) collectBoneHierarchy(child, depth + 1, out);
  });
  return out;
}

// 관절 한 곳의 스키닝 — 위 본 → 아래 본 가중치가 관절을 지나며 부드럽게 넘어가야 한다.
// 한쪽이 1 에서 0 으로 뚝 떨어지면 굽힐 때 살이 접힌다.
// 좌우를 섞어 재면 안 된다(그래서 '혼합 가중치 0' 이라는 틀린 결론을 낸 적이 있다) — 뼈 축선까지 거리로 가른다.
function measureJointProfile(mesh: THREE.SkinnedMesh, upperName: string, lowerName: string): JointRow[] | null {
  const skeleton = mesh.skeleton;
  const upper = skeleton.getBoneByName(upperName);
  const lower = skeleton.getBoneByName(lowerName);
  if (!upper || !lower) return null;
  skeleton.pose();
  // 월드 행렬은 뿌리부터 갱신해야 한다. 그 본만 갱신하면 부모가 지난 프레임 포즈로 남는다.
  let rootBone: THREE.Object3D = skeleton.bones[0];
  while (rootBone.parent && rootBone.parent instanceof THREE.Bone) rootBone = rootBone.parent;
  (rootBone.parent ?? rootBone).updateMatrixWorld(true);
  mesh.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const positionOf = (bone: THREE.Bone) =>
    new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld).applyMatrix4(inverse);
  const joint = positionOf(lower);
  const upperPosition = positionOf(upper);
  const position = mesh.geometry.getAttribute("position");
  const skinIndex = mesh.geometry.getAttribute("skinIndex");
  const skinWeight = mesh.geometry.getAttribute("skinWeight");
  if (!skinIndex || !skinWeight) return null;
  const box = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute);
  const height = box.max.y - box.min.y;
  // 팔은 T포즈에서 가로로 뻗어 높이로 자르면 관절을 안 지난다. 늘 뼈 축으로 자른다.
  const axis = joint.clone().sub(upperPosition).normalize();
  const radius = height * 0.1;
  const point = new THREE.Vector3();
  const side = new THREE.Vector3();
  const upperPrefix = upperName.replace(/_[lr]$/, "");
  const lowerPrefix = lowerName.replace(/_[lr]$/, "");
  const rows: JointRow[] = [];
  for (let s = -3; s <= 3; s += 1) {
    const offset = height * 0.03 * s;
    let upperSum = 0;
    let lowerSum = 0;
    let count = 0;
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).sub(joint);
      const along = point.dot(axis);
      if (Math.abs(along - offset) > height * 0.006) continue;
      side.copy(point).addScaledVector(axis, -along);
      if (side.length() > radius) continue;
      for (let k = 0; k < 4; k += 1) {
        const weight = skinWeight.getComponent(i, k);
        if (weight <= 1e-4) continue;
        const name = skeleton.bones[skinIndex.getComponent(i, k)].name;
        if (name.startsWith(upperPrefix)) upperSum += weight;
        else if (name.startsWith(lowerPrefix)) lowerSum += weight;
      }
      count += 1;
    }
    if (count) {
      rows.push({
        fromJoint: +offset.toFixed(3),
        vertices: count,
        [upperName]: +(upperSum / count).toFixed(3),
        [lowerName]: +(lowerSum / count).toFixed(3),
      });
    }
  }
  return rows;
}

const JOINTS = [
  ["knee", "thigh_l", "calf_l"],
  ["elbow", "upperarm_l", "lowerarm_l"],
  ["hip", "pelvis", "thigh_l"],
  ["shoulder", "clavicle_l", "upperarm_l"],
] as const;

function collectDiagnostics(target: DiagnosticsTarget, options: DiagnosticsOptions = {}) {
  const { model, targetSkin, clipFor, clipCount } = target;
  const meshes: Record<string, string | number>[] = [];
  const materials: Record<string, string | number | boolean>[] = [];
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const list: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
    const geometry: THREE.BufferGeometry = object.geometry;
    const isSkinned = object instanceof THREE.SkinnedMesh;
    meshes.push({
      name: object.name,
      type: isSkinned ? "SkinnedMesh" : "Mesh",
      vertices: geometry.getAttribute("position")?.count ?? 0,
      faces: (geometry.index?.count ?? 0) / 3,
      bones: isSkinned ? (object.skeleton?.bones.length ?? 0) : "-",
      morphs: object.morphTargetInfluences?.length ?? 0,
      slot: (object.userData.slot as string | undefined) ?? (object.userData.chibi_part as string | undefined) ?? "",
    });
    list.forEach((m) => {
      const fields = m as THREE.Material & {
        map?: THREE.Texture | null;
        normalMap?: THREE.Texture | null;
        roughness?: number;
        metalness?: number;
      };
      materials.push({
        mesh: object.name,
        material: m.name || "(이름없음)",
        type: m.type,
        map: fields.map?.name || (fields.map ? "있음" : "없음"),
        normalMap: !!fields.normalMap,
        roughness: fields.roughness ?? "-",
        metalness: fields.metalness ?? "-",
        transparent: m.transparent,
        alphaTest: m.alphaTest,
        side: m.side,
      });
    });
  });

  const skeleton = targetSkin?.skeleton ? collectBoneHierarchy(targetSkin.skeleton.bones[0]) : [];
  const clips = (options.clipNames ?? []).map((name) => {
    const clip = clipFor?.(name);
    return clip
      ? { name, seconds: Number(clip.duration.toFixed(3)), tracks: clip.tracks.length }
      : { name, seconds: "-", tracks: 0 };
  });

  const summary = {
    skinnedMeshes: meshes.filter((m) => m.type === "SkinnedMesh").length,
    meshes: meshes.length,
    bones: targetSkin?.skeleton?.bones.length ?? 0,
    clips: clipCount ?? 0,
    materials: materials.length,
  };
  const joints: Record<string, JointRow[]> = {};
  if (targetSkin) {
    JOINTS.forEach(([name, upper, lower]) => {
      const rows = measureJointProfile(targetSkin, upper, lower);
      if (rows) joints[name] = rows;
    });
  }
  console.groupCollapsed("캐릭터 진단", summary);
  console.table(meshes);
  console.table(materials);
  if (clips.length) console.table(clips);
  Object.entries(joints).forEach(([name, rows]) => {
    console.groupCollapsed(`관절 스키닝 — ${name}`);
    console.table(rows);
    console.groupEnd();
  });
  console.groupEnd();
  return { summary, meshes, materials, skeleton, clips, joints };
}

/** DEV 에서만 `__game.avatarDiagnostics(extra?)` 와 `__game.avatarClip(name)` 을 연다. */
export function registerDiagnostics(target: DiagnosticsTarget, options: DiagnosticsOptions) {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  exposeDevHook("avatarDiagnostics", (extra?: DiagnosticsOptions) =>
    collectDiagnostics(target, { ...options, ...extra }),
  );
  // 리타게팅·보정이 끝난 클립을 이름으로 꺼낸다(트랙 값의 키 간 급변 같은 걸 잴 때).
  exposeDevHook("avatarClip", (name: string) => target.clipFor?.(name));
}
