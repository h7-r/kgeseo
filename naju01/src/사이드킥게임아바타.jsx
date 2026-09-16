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
    const source = clone(모션GLTF.scene);
    const targetSkin = 첫스킨메시(model);
    const sourceSkin = 첫스킨메시(source);
    if (!targetSkin || !sourceSkin) {
      throw new Error("Sidekick 또는 모션 파일에서 스킨 리그를 찾지 못했습니다.");
    }

    const parts = [];
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => material.clone())
        : object.material.clone();
      const info = 부품정보(object.name);
      if (info) parts.push({ object, ...info });
    });

    const options = 리타게팅옵션(targetSkin, sourceSkin);
    source.skeleton = sourceSkin.skeleton;
    const sourceClips = new Map(
      모션GLTF.animations.map((clip) => [clip.name, clip]),
    );
    const retargetedClips = new Map();
    const clipFor = (name) => {
      if (retargetedClips.has(name)) return retargetedClips.get(name);
      const sourceClip = sourceClips.get(name);
      if (!sourceClip) return null;
      targetSkin.skeleton.pose();
      sourceSkin.skeleton.pose();
      source.updateMatrixWorld(true);
      targetSkin.updateMatrixWorld(true);
      const result = retargetClip(targetSkin, source, sourceClip, options);
      result.name = name;
      retargetedClips.set(name, result);
      return result;
    };

    targetSkin.skeleton.pose();
    model.updateMatrixWorld(true);
    const bottom = new THREE.Box3().setFromObject(model).min.y;
    return {
      model,
      targetSkin,
      clipFor,
      clipCount: sourceClips.size,
      parts,
      bottom,
      mappedBones: Object.keys(options.names).length,
    };
  }, [캐릭터GLTF.scene, 모션GLTF.scene, 모션GLTF.animations]);

  const mixer = useMemo(
    () => new THREE.AnimationMixer(준비.targetSkin),
    [준비.targetSkin],
  );
  const actions = useRef(new Map());
  const 현재모션 = useRef(null);
  const 이전접지 = useRef(true);
  const 점프시작끝 = useRef(0);
  const 착지끝 = useRef(0);

  useEffect(() => {
    const chosen = {
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
    };
    준비.parts.forEach(({ object, slot, option }) => {
      object.visible = slot === "fixed" || option === chosen[slot];
      형태값(object, "masculineFeminine", 설정.feminine);
      형태값(object, "defaultHeavy", 설정.heavy);
      형태값(object, "defaultBuff", 설정.buff);
      형태값(object, "defaultSkinny", 설정.skinny);

      let color = null;
      if (slot === "hair" || slot === "brows" || slot === "facialHair") color = 설정.hairColor;
      else if (slot === "head" || slot === "ears" || slot === "nose") color = 설정.skinColor;
      else if (slot === "top") color = option === 1 ? 설정.skinColor : 설정.topColor;
      else if (slot === "bottom") color = option === 1 ? 설정.skinColor : 설정.bottomColor;
      else if (slot === "shoes") color = option === 1 ? 설정.skinColor : 설정.shoesColor;
      else if (slot !== "fixed" && slot !== "teeth") color = 설정.accessoryColor;
      else if (object.name.includes("EBR")) color = 설정.hairColor;
      else if (object.name.includes("EAR") || object.name.includes("NOSE")) color = 설정.skinColor;
      색입히기(object, color);
    });
  }, [준비.parts, 설정]);

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
    const loop = name.endsWith("_Loop") || name === "A_TPose";
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
      if (!state.grounded) {
        if (이전접지.current) 점프시작끝.current = now + 0.22;
        next = now < 점프시작끝.current ? "Jump_Start" : "Jump_Loop";
      } else if (!이전접지.current) {
        착지끝.current = now + 0.28;
        next = "Jump_Land";
      } else if (now < 착지끝.current) next = "Jump_Land";
      else if (state.crouching) next = state.moving ? "Crouch_Fwd_Loop" : "Crouch_Idle_Loop";
      else if (state.moving) next = state.running ? "Sprint_Loop" : "Walk_Loop";
      else next = "Idle_Loop";
    }
    이전접지.current = state.grounded;
    재생(next);
    mixer.update(delta);

    group.position.set(
      state.position.x,
      state.footY - 준비.bottom * 크기,
      state.position.z,
    );
    group.rotation.set(0, state.facing, 0);
    group.scale.setScalar(크기);

    if (import.meta.env.DEV) {
      window.__SIDEKICK_DEBUG = {
        visible: true,
        motion: next,
        motionCount: 준비.clipCount,
        mappedBones: 준비.mappedBones,
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
