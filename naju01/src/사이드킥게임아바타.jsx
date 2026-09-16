// Synty Sidekick 모듈 캐릭터 + Quaternius CC0 43개 모션 런타임.
// 외형은 하나의 공통 리그 위에서 머리·헤어·상의·하의·신발 메시를 교체하고,
// 체형은 Synty 원본 morph target을 움직인다. 모션은 원본 root motion을 빼고
// 게임 이동 좌표에 리타게팅한다.
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone, retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";
import { 미터 } from "./공간도면.js";
import { 기본사이드킥설정 } from "./사이드킥옵션.js";

const 캐릭터파일 = "/models/sidekick-customizer.glb";
const 모션파일 = "/models/vendor/quaternius-universal-animation-library.glb";
const 강제검증모션 =
  typeof location !== "undefined"
    ? new URLSearchParams(location.search).get("motion")
    : null;

function 첫스킨메시(root) {
  let result = null;
  root.traverse((object) => {
    if (!result && object.isSkinnedMesh) result = object;
  });
  return result;
}

function 월드회전(object) {
  object.updateMatrixWorld(true);
  return new THREE.Quaternion().setFromRotationMatrix(object.matrixWorld);
}

function 리타게팅옵션(targetSkin, sourceSkin) {
  targetSkin.skeleton.pose();
  sourceSkin.skeleton.pose();
  targetSkin.updateMatrixWorld(true);
  sourceSkin.updateMatrixWorld(true);
  const sourceNames = new Set(sourceSkin.skeleton.bones.map((bone) => bone.name));
  const names = {};
  const localOffsets = {};

  targetSkin.skeleton.bones.forEach((targetBone) => {
    const sourceName = targetBone.name === "head" ? "Head" : targetBone.name;
    if (!sourceNames.has(sourceName)) return;
    names[targetBone.name] = sourceName;
    const sourceRest = 월드회전(sourceSkin.skeleton.getBoneByName(sourceName));
    const targetRest = 월드회전(targetBone);
    localOffsets[targetBone.name] = new THREE.Matrix4().makeRotationFromQuaternion(
      sourceRest.invert().multiply(targetRest),
    );
  });

  return {
    names,
    localOffsets,
    hip: "__게임이동이담당__",
    preserveBoneMatrix: true,
    preserveBonePositions: true,
    useFirstFramePosition: false,
    fps: 30,
  };
}

function 부품정보(name) {
  const match = /^SKLIB__([A-Za-z]+)__(\d+)__/.exec(name);
  return match ? { slot: match[1], option: Number(match[2]) } : null;
}

// Starter Pack의 몇몇 헤어는 일부 정점이 `neutral_bone`에 묶여 있다.
// 원본 포즈에서는 머리 안에 겹쳐 보이지만 고개가 돌면 그 조각만 머리를
// 따라가지 않고 옆에 떠 보인다. 헤어에서만 중립 본 가중치를 head로 옮긴다.
function 헤어가중치고정(mesh) {
  if (!mesh.isSkinnedMesh) return 0;
  const neutral = mesh.skeleton.bones.findIndex((bone) => bone.name === "neutral_bone");
  const head = mesh.skeleton.bones.findIndex((bone) => bone.name === "head");
  const skinIndex = mesh.geometry.getAttribute("skinIndex");
  if (neutral < 0 || head < 0 || !skinIndex) return 0;

  mesh.geometry = mesh.geometry.clone();
  const clonedIndex = mesh.geometry.getAttribute("skinIndex");
  let fixed = 0;
  for (let i = 0; i < clonedIndex.count; i += 1) {
    const offset = i * clonedIndex.itemSize;
    for (let component = 0; component < clonedIndex.itemSize; component += 1) {
      if (clonedIndex.array[offset + component] !== neutral) continue;
      clonedIndex.array[offset + component] = head;
      fixed += 1;
    }
  }
  clonedIndex.needsUpdate = true;
  return fixed;
}

function 형태값(mesh, name, value) {
  const index = mesh.morphTargetDictionary?.[name];
  if (index !== undefined) mesh.morphTargetInfluences[index] = value;
}

function 색입히기(mesh, color) {
  if (!color) return;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material) => material?.color?.set(color));
}

function SidekickGameAvatar({
  보이기,
  플레이어참조,
  설정 = 기본사이드킥설정,
  크기 = 미터,
}) {
  const root = useRef();
  const 캐릭터GLTF = useGLTF(캐릭터파일);
  const 모션GLTF = useGLTF(모션파일);

  const 준비 = useMemo(() => {
    const model = clone(캐릭터GLTF.scene);
    // 화면에 보이는 model은 인게임 미터 배율로 크게 스케일된다. 그 골격을
    // retargetClip에 직접 넘기면 두 번째로 생성하는 모션부터 부모 스케일이
    // 본 스케일에 흡수되어 전체가 1/3로 줄어든다. 변환 전용 복제본은
    // 항상 scale 1로 두고, 생성된 회전 트랙만 화면용 골격에 재생한다.
    const retargetModel = clone(캐릭터GLTF.scene);
    const source = clone(모션GLTF.scene);
    const targetSkin = 첫스킨메시(model);
    const retargetSkin = 첫스킨메시(retargetModel);
    const sourceSkin = 첫스킨메시(source);
    if (!targetSkin || !retargetSkin || !sourceSkin) {
      throw new Error("Sidekick 또는 모션 파일에서 스킨 리그를 찾지 못했습니다.");
    }

    const parts = [];
    let fixedHairWeights = 0;
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => material.clone())
        : object.material.clone();
      const info = 부품정보(object.name);
      if (info) {
        if (info.slot === "hair") fixedHairWeights += 헤어가중치고정(object);
        parts.push({ object, ...info });
      }
    });

    const options = 리타게팅옵션(retargetSkin, sourceSkin);
    source.skeleton = sourceSkin.skeleton;
    const sourceClips = new Map(
      모션GLTF.animations.map((clip) => [clip.name, clip]),
    );
    const retargetedClips = new Map();
    const clipFor = (name) => {
      if (retargetedClips.has(name)) return retargetedClips.get(name);
      const sourceClip = sourceClips.get(name);
      if (!sourceClip) return null;
      retargetSkin.skeleton.pose();
      sourceSkin.skeleton.pose();
      source.updateMatrixWorld(true);
      retargetSkin.updateMatrixWorld(true);
      const result = retargetClip(retargetSkin, source, sourceClip, options);
      result.name = name;
      retargetSkin.skeleton.pose();
      retargetedClips.set(name, result);
      return result;
    };

    targetSkin.skeleton.pose();
    model.updateMatrixWorld(true);
    const bottom = new THREE.Box3().setFromObject(model).min.y;
    const feet = ["foot_l", "ball_l", "foot_r", "ball_r"]
      .map((name) => targetSkin.skeleton.getBoneByName(name))
      .filter(Boolean);
    const inverseModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const footPoint = new THREE.Vector3();
    let restFootY = Infinity;
    feet.forEach((bone) => {
      bone.getWorldPosition(footPoint).applyMatrix4(inverseModel);
      restFootY = Math.min(restFootY, footPoint.y);
    });
    return {
      model,
      targetSkin,
      clipFor,
      clipCount: sourceClips.size,
      parts,
      bottom,
      feet,
      soleOffset: Number.isFinite(restFootY) ? bottom - restFootY : 0,
      fixedHairWeights,
      mappedBones: Object.keys(options.names).length,
    };
  }, [캐릭터GLTF.scene, 모션GLTF.scene, 모션GLTF.animations]);

  // 모션만 바꾸어도 모든 파츠의 visible·morph·material을 다시 쓰면
  // 크고 복잡한 스킨 메시가 한 프레임 통채로 사라질 수 있다. 외형과
  // 동작 상태를 분리해 실제 외형 값이 바뀌 때만 파츠를 갱신한다.
  const 외형설정 = useMemo(
    () => ({
      head: 설정.head,
      hair: 설정.hair,
      brows: 설정.brows,
      ears: 설정.ears,
      facialHair: 설정.facialHair,
      nose: 설정.nose,
      teeth: 설정.teeth,
      top: 설정.top,
      bottom: 설정.bottom,
      shoes: 설정.shoes,
      headwear: 설정.headwear,
      faceAccessory: 설정.faceAccessory,
      backAccessory: 설정.backAccessory,
      hipFront: 설정.hipFront,
      hipBack: 설정.hipBack,
      hipSide: 설정.hipSide,
      shoulderAccessory: 설정.shoulderAccessory,
      elbowAccessory: 설정.elbowAccessory,
      kneeAccessory: 설정.kneeAccessory,
      feminine: 설정.feminine,
      heavy: 설정.heavy,
      buff: 설정.buff,
      skinny: 설정.skinny,
      skinColor: 설정.skinColor,
      hairColor: 설정.hairColor,
      topColor: 설정.topColor,
      bottomColor: 설정.bottomColor,
      shoesColor: 설정.shoesColor,
      accessoryColor: 설정.accessoryColor,
    }),
    [
      설정.head, 설정.hair, 설정.brows, 설정.ears, 설정.facialHair,
      설정.nose, 설정.teeth, 설정.top, 설정.bottom, 설정.shoes,
      설정.headwear, 설정.faceAccessory, 설정.backAccessory, 설정.hipFront,
      설정.hipBack, 설정.hipSide, 설정.shoulderAccessory, 설정.elbowAccessory,
      설정.kneeAccessory, 설정.feminine, 설정.heavy, 설정.buff, 설정.skinny,
      설정.skinColor, 설정.hairColor, 설정.topColor, 설정.bottomColor,
      설정.shoesColor, 설정.accessoryColor,
    ],
  );

  const mixer = useMemo(
    () => new THREE.AnimationMixer(준비.targetSkin),
    [준비.targetSkin],
  );
  const actions = useRef(new Map());
  const 현재모션 = useRef(null);
  const 공중시작 = useRef(null);
  const 공중모션중 = useRef(false);
  const 점프시작끝 = useRef(0);
  const 착지끝 = useRef(0);
  const 역행렬 = useMemo(() => new THREE.Matrix4(), []);
  const 발좌표 = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const chosen = 외형설정;
    준비.parts.forEach(({ object, slot, option }) => {
      object.visible = slot === "fixed" || option === chosen[slot];
      형태값(object, "masculineFeminine", 외형설정.feminine);
      형태값(object, "defaultHeavy", 외형설정.heavy);
      형태값(object, "defaultBuff", 외형설정.buff);
      형태값(object, "defaultSkinny", 외형설정.skinny);

      let color = null;
      if (slot === "hair" || slot === "brows" || slot === "facialHair") color = 외형설정.hairColor;
      else if (slot === "head" || slot === "ears" || slot === "nose") color = 외형설정.skinColor;
      else if (slot === "top") color = option === 1 ? 외형설정.skinColor : 외형설정.topColor;
      else if (slot === "bottom") color = option === 1 ? 외형설정.skinColor : 외형설정.bottomColor;
      else if (slot === "shoes") color = option === 1 ? 외형설정.skinColor : 외형설정.shoesColor;
      else if (slot !== "fixed" && slot !== "teeth") color = 외형설정.accessoryColor;
      else if (object.name.includes("EBR")) color = 외형설정.hairColor;
      else if (object.name.includes("EAR") || object.name.includes("NOSE")) color = 외형설정.skinColor;
      색입히기(object, color);
    });
  }, [준비.parts, 외형설정]);

  useEffect(() => {
    if (!보이기) {
      mixer.stopAllAction();
      현재모션.current = null;
    }
  }, [mixer, 보이기]);

  useEffect(
    () => () => {
      mixer.stopAllAction();
      actions.current.clear();
      mixer.uncacheRoot(준비.targetSkin);
    },
    [mixer, 준비.targetSkin],
  );

  const 재생 = (name) => {
    if (name === 현재모션.current) return;
    let action = actions.current.get(name);
    if (!action) {
      const clip = 준비.clipFor(name);
      if (!clip) return;
      action = mixer.clipAction(clip, 준비.targetSkin);
      actions.current.set(name, action);
    }
    actions.current.get(현재모션.current)?.fadeOut(0.16);
    action.reset().fadeIn(0.16);
    const loop = name.endsWith("_Loop") || name === "A_TPose" || name === "Sword_Idle";
    action.clampWhenFinished = !loop;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1).play();
    현재모션.current = name;
  };

  useFrame(({ clock }, delta) => {
    const group = root.current;
    const state = 플레이어참조?.current;
    if (!group || !state) return;
    group.visible = 보이기;
    if (!보이기) {
      if (import.meta.env.DEV) {
        window.__SIDEKICK_DEBUG = {
          visible: false,
          motionCount: 준비.clipCount,
          mappedBones: 준비.mappedBones,
          appearance: 설정,
        };
      }
      return;
    }

    const now = clock.elapsedTime;
    let next = 설정.motion;
    if (강제검증모션) next = 강제검증모션;
    if (!next || next === "자동") {
      if (!state.grounded && 공중시작.current === null) 공중시작.current = now;
      if (state.grounded) 공중시작.current = null;
      // Space로 시작한 점프는 즉시, 절벽 추락은 0.12초 후에만
      // 공중 모션으로 보여 준다. 경사 보행의 한두 프레임 접지 오차는 무시된다.
      const confirmedAir =
        state.jumping ||
        (!state.grounded &&
          공중시작.current !== null &&
          now - 공중시작.current > 0.12);
      if (confirmedAir) {
        if (!공중모션중.current) 점프시작끝.current = now + 0.22;
        next = now < 점프시작끝.current ? "Jump_Start" : "Jump_Loop";
      } else if (공중모션중.current && state.grounded) {
        착지끝.current = now + 0.28;
        next = "Jump_Land";
      } else if (now < 착지끝.current) next = "Jump_Land";
      else if (state.crouching) next = state.moving ? "Crouch_Fwd_Loop" : "Crouch_Idle_Loop";
      else if (state.moving) next = state.running ? "Sprint_Loop" : "Walk_Loop";
      else next = "Idle_Loop";
      공중모션중.current = confirmedAir;
    }
    재생(next);
    mixer.update(delta);

    group.position.set(state.position.x, state.footY, state.position.z);
    group.rotation.set(0, state.facing, 0);
    group.scale.setScalar(크기);
    group.updateMatrixWorld(true);

    // 원본 달리기는 두 발이 동시에 올라가는 프레임이 있다. root motion을
    // 제거한 상태에서 그대로 재생하면 모델이 공중에 뜬 듯 보인다. 가장
    // 낮은 발 본을 실제 지면에 고정하고, 점프 높이는 게임 이동 좌표가 담당한다.
    let animatedFootY = Infinity;
    역행렬.copy(준비.model.matrixWorld).invert();
    준비.feet.forEach((bone) => {
      bone.getWorldPosition(발좌표).applyMatrix4(역행렬);
      animatedFootY = Math.min(animatedFootY, 발좌표.y);
    });
    const animatedBottom = Number.isFinite(animatedFootY)
      ? animatedFootY + 준비.soleOffset
      : 준비.bottom;
    group.position.y = state.footY - animatedBottom * 크기;

    if (import.meta.env.DEV) {
      window.__SIDEKICK_DEBUG = {
        visible: true,
        motion: next,
        motionCount: 준비.clipCount,
        mappedBones: 준비.mappedBones,
        fixedHairWeights: 준비.fixedHairWeights,
        grounded: state.grounded,
        groundError: state.footY - state.groundY,
        appearance: 설정,
        position: state.position.toArray(),
      };
    }
  });

  return (
    <group name="NAJU-sidekick-avatar" ref={root} visible={보이기}>
      <primitive object={준비.model} />
    </group>
  );
}

useGLTF.preload(캐릭터파일);
useGLTF.preload(모션파일);

export default SidekickGameAvatar;
