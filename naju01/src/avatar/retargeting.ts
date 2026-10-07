// 두 런타임 아바타(치비·사이드킥)가 같이 쓰는 리타게팅 도구.
import * as THREE from "three";
import type { RetargetClipOptions } from "three/examples/jsm/utils/SkeletonUtils.js";

/** three 의 retargetClip 이 읽지만 타입에 빠진 칸까지 담은 설정 */
export interface RetargetSetup extends RetargetClipOptions {
  names: Record<string, string>;
  localOffsets: Record<string, THREE.Matrix4>;
  preserveBonePositions: boolean;
}

export function firstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let result: THREE.SkinnedMesh | null = null;
  root.traverse((object) => {
    if (!result && object instanceof THREE.SkinnedMesh) result = object;
  });
  return result;
}

function worldQuaternion(object: THREE.Object3D): THREE.Quaternion {
  object.updateMatrixWorld(true);
  return new THREE.Quaternion().setFromRotationMatrix(object.matrixWorld);
}

/** retargetClip 은 Object3D 소스의 `.skeleton` 을 읽는다 — 씬 뿌리에 그 뼈대를 달아 둔다. */
export function attachSkeleton(root: THREE.Object3D, skeleton: THREE.Skeleton) {
  Object.assign(root, { skeleton });
}

// 회전 트랙만 만들고 루트 이동은 게임이 맡는다(hip 은 어느 뼈와도 안 겹치는 이름).
export function retargetOptions(targetSkin: THREE.SkinnedMesh, sourceSkin: THREE.SkinnedMesh): RetargetSetup {
  targetSkin.skeleton.pose();
  sourceSkin.skeleton.pose();
  targetSkin.updateMatrixWorld(true);
  sourceSkin.updateMatrixWorld(true);
  const sourceNames = new Set(sourceSkin.skeleton.bones.map((bone) => bone.name));
  const names: Record<string, string> = {};
  const localOffsets: Record<string, THREE.Matrix4> = {};
  targetSkin.skeleton.bones.forEach((targetBone) => {
    const sourceName = targetBone.name === "head" ? "Head" : targetBone.name;
    if (!sourceNames.has(sourceName)) return;
    names[targetBone.name] = sourceName;
    const sourceBone = sourceSkin.skeleton.getBoneByName(sourceName);
    if (!sourceBone) return;
    const sourceRest = worldQuaternion(sourceBone);
    const targetRest = worldQuaternion(targetBone);
    localOffsets[targetBone.name] = new THREE.Matrix4().makeRotationFromQuaternion(
      sourceRest.invert().multiply(targetRest),
    );
  });
  return {
    names,
    localOffsets,
    hip: "__movedByGame__",
    preserveBoneMatrix: true,
    preserveBonePositions: true,
    useFirstFramePosition: false,
    fps: 30,
  };
}

// 이동 모션은 제자리 루프라, 게임 이동 속도와 클립 보폭 속도가 다르면 발이 미끄러진다.
// 디딘 발이 몸 기준으로 뒤로 밀려나는 거리를 재면 그 클립의 고유 이동 속도가 나온다.
export function strideSpeed(root: THREE.Object3D, skin: THREE.SkinnedMesh, clip: THREE.AnimationClip): number {
  const feet = ["foot_l", "foot_r"].map((name) => skin.skeleton.getBoneByName(name));
  const [leftFoot, rightFoot] = feet;
  if (!leftFoot || !rightFoot || !(clip.duration > 0)) return 0;
  const mixer = new THREE.AnimationMixer(skin);
  const action = mixer.clipAction(clip).play();
  const samples = 60;
  const positions = [new THREE.Vector3(), new THREE.Vector3()];
  let previous: { foot: number; x: number; z: number } | null = null;
  let total = 0;
  for (let i = 0; i <= samples; i += 1) {
    action.time = (clip.duration * i) / samples;
    mixer.update(0);
    root.updateMatrixWorld(true);
    positions[0].setFromMatrixPosition(leftFoot.matrixWorld);
    positions[1].setFromMatrixPosition(rightFoot.matrixWorld);
    const planted = positions[0].y <= positions[1].y ? 0 : 1;
    // 디딘 발이 바뀌는 구간은 건너뛴다(두 발 사이 거리는 보폭이 아니다).
    if (previous && previous.foot === planted) {
      total += Math.hypot(positions[planted].x - previous.x, positions[planted].z - previous.z);
    }
    previous = { foot: planted, x: positions[planted].x, z: positions[planted].z };
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(skin);
  skin.skeleton.pose();
  return total / clip.duration;
}

export function setMorph(mesh: THREE.Object3D, name: string, value: number) {
  if (!(mesh instanceof THREE.Mesh)) return;
  const index = mesh.morphTargetDictionary?.[name];
  if (index !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = value;
}
