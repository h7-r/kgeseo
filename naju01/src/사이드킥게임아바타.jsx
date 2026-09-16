// Synty Sidekick 캐릭터 + Quaternius CC0 모션 런타임.
// 캐릭터 부품·스킨은 Synty 원본 리그를 유지하고, 손으로 관절을 흔들던 임시
// 코드는 제거했다. Idle / Walk / Sprint 모션을 같은 UE 계열 본 이름으로
// 리타게팅해 게임에서 교차 재생한다.
import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  clone,
  retargetClip,
} from "three/examples/jsm/utils/SkeletonUtils.js";
import { 미터 } from "./공간도면.js";

const 캐릭터파일 = "/models/sidekick-naju-test.glb";
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
    // Sidekick은 head, Quaternius는 Head 한 글자만 다르다.
    const sourceName = targetBone.name === "head" ? "Head" : targetBone.name;
    if (!sourceNames.has(sourceName)) return;
    names[targetBone.name] = sourceName;

    const sourceBone = sourceSkin.skeleton.getBoneByName(sourceName);
    const sourceRest = 월드회전(sourceBone);
    const targetRest = 월드회전(targetBone);
    const offset = sourceRest.invert().multiply(targetRest);
    localOffsets[targetBone.name] = new THREE.Matrix4().makeRotationFromQuaternion(offset);
  });

  return {
    names,
    localOffsets,
    // 원본 모션의 전진(root motion)은 게임 이동과 중복된다. 골반 위치 트랙은
    // 빼고 관절 회전만 옮겨 발이 두 번 전진하는 현상을 막는다.
    hip: "__게임이동이담당__",
    preserveBoneMatrix: true,
    preserveBonePositions: true,
    useFirstFramePosition: false,
    fps: 30,
  };
}

function SidekickGameAvatar({ 보이기, 플레이어참조, 크기 = 미터 }) {
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

    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
    });

    const options = 리타게팅옵션(targetSkin, sourceSkin);
    // 모션 원본 씬을 믹서 루트로 쓰면서 같은 스켈레톤을 공개한다.
    // 그러면 glTF 트랙의 계층 경로와 retargetClip 양쪽이 모두 본을 찾는다.
    source.skeleton = sourceSkin.skeleton;
    const 선택 = [
      ["Idle", "Idle_Loop"],
      ["Walk", "Walk_Loop"],
      ["Run", "Sprint_Loop"],
    ];
    const clips = 선택.map(([name, sourceName]) => {
      const clip = 모션GLTF.animations.find((item) => item.name === sourceName);
      if (!clip) throw new Error(`필수 모션을 찾지 못했습니다: ${sourceName}`);
      const result = retargetClip(targetSkin, source, clip, options);
      result.name = name;
      return result;
    });

    targetSkin.skeleton.pose();
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);

    return {
      model,
      targetSkin,
      clips,
      bottom: bounds.min.y,
      mappedBones: Object.keys(options.names).length,
    };
  }, [캐릭터GLTF.scene, 모션GLTF.scene, 모션GLTF.animations]);

  const { actions } = useAnimations(준비.clips, 준비.targetSkin);
  const 현재모션 = useRef(null);

  useEffect(() => {
    if (!보이기) {
      Object.values(actions).forEach((action) => action?.stop());
      현재모션.current = null;
      return;
    }
    actions.Idle?.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    현재모션.current = "Idle";
  }, [actions, 보이기]);

  useFrame(() => {
    const group = root.current;
    const state = 플레이어참조?.current;
    if (!group || !state) return;
    group.visible = 보이기;
    if (!보이기) return;

    // ?motion=walk / run은 개발 검증용이다. 실제 게임에서는 플레이어 속도만 쓴다.
    const forced = { idle: "Idle", walk: "Walk", run: "Run" }[강제검증모션];
    const next = forced ?? (state.moving ? (state.running ? "Run" : "Walk") : "Idle");
    if (next !== 현재모션.current) {
      actions[현재모션.current]?.fadeOut(0.16);
      actions[next]?.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.16).play();
      현재모션.current = next;
    }

    // 눈/카메라가 아니라 실제 충돌 플레이어의 발 좌표에 놓는다. 점프 중에는
    // footY가 지면보다 높아지므로 캐릭터도 함께 뜨고, 착지하면 정확히 0 오차다.
    group.position.set(
      state.position.x,
      state.footY - 준비.bottom * 크기,
      state.position.z,
    );
    group.rotation.set(0, state.facing, 0);
    group.scale.setScalar(크기);

    if (import.meta.env.DEV) {
      window.__SIDEKICK_DEBUG = {
        motion: next,
        mappedBones: 준비.mappedBones,
        grounded: state.grounded,
        groundError: state.footY - state.groundY,
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
