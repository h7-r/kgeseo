// 치비 몸체 시제품 런타임 (1단계: 몸 + 모션 검증).
// V4 몸체를 Sidekick 뼈 이름·축으로 다시 묶은 GLB(chibi-male/female)에
// Sidekick 캐릭터와 같은 Quaternius 43개 모션을 같은 방식으로 리타게팅한다.
// 기존 사이드킥게임아바타.jsx는 건드리지 않고, 비교 검토용으로 따로 둔다.
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone, retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";
import { 미터 } from "./공간도면.js";
import { 기본치비설정 } from "./치비옵션.js";

const 몸파일 = {
  masculine: "/models/chibi-male.glb",
  feminine: "/models/chibi-female.glb",
};
const 모션파일 = "/models/vendor/quaternius-universal-animation-library.glb";

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

// Sidekick 아바타와 같은 리타게팅 설정: 회전 트랙만 만들고 루트 이동은 게임이 담당한다.
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

function 형태값(mesh, name, value) {
  const index = mesh.morphTargetDictionary?.[name];
  if (index !== undefined) mesh.morphTargetInfluences[index] = value;
}

// 몸 피부는 선택한 옷이 완전히 덮는 정점만 그리지 않는다. 빌드에서 옷마다 비트
// 하나(_cover)를 구워 두었고, 선택된 옷의 비트 마스크와 맞으면 버린다.
function 피부가림준비(mesh) {
  const uniforms = { uCoverMask: { value: 0 } };
  const material = mesh.material;
  material.customProgramCacheKey = () => "chibi-skin-cover";
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float _cover;\nvarying float vCoverHidden;\nuniform float uCoverMask;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vCoverHidden = 0.0;
        for (int bit = 0; bit < 12; bit++) {
          float place = pow(2.0, float(bit));
          if (mod(floor(uCoverMask / place), 2.0) > 0.5 && mod(floor(_cover / place), 2.0) > 0.5) vCoverHidden = 1.0;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vCoverHidden;")
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vCoverHidden > 0.999) discard;");
  };
  material.needsUpdate = true;
  mesh.userData.가림uniforms = uniforms;
}

function 몸준비(gltf, 모션GLTF) {
  const model = clone(gltf.scene);
  const retargetModel = clone(gltf.scene);
  const source = clone(모션GLTF.scene);
  const targetSkin = 첫스킨메시(model);
  const retargetSkin = 첫스킨메시(retargetModel);
  const sourceSkin = 첫스킨메시(source);
  const skinMaterials = [];
  const soles = [];
  const parts = [];
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material.clone();
    // 여러 재질로 나뉜 파츠는 GLTFLoader가 부모 Group에 extras를 붙인다.
    let owner = object;
    while (owner && owner.userData.chibi_part === undefined) owner = owner.parent;
    const data = owner?.userData ?? {};
    const part = data.chibi_part;
    parts.push({ object, data });
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (/^Skin_/.test(material.name)) skinMaterials.push(material);
    });
    if (part === "body") {
      피부가림준비(object);
      const position = object.geometry.getAttribute("position");
      const indices = [];
      for (let i = 0; i < position.count; i += 1) if (position.getY(i) < 0.02) indices.push(i);
      soles.push({ object, indices });
    }
  });

  const options = 리타게팅옵션(retargetSkin, sourceSkin);
  source.skeleton = sourceSkin.skeleton;
  const sourceClips = new Map(모션GLTF.animations.map((clip) => [clip.name, clip]));
  const retargeted = new Map();
  const clipFor = (name) => {
    if (retargeted.has(name)) return retargeted.get(name);
    const sourceClip = sourceClips.get(name);
    if (!sourceClip) return null;
    retargetSkin.skeleton.pose();
    sourceSkin.skeleton.pose();
    source.updateMatrixWorld(true);
    retargetSkin.updateMatrixWorld(true);
    const result = retargetClip(retargetSkin, source, sourceClip, options);
    result.name = name;
    retargetSkin.skeleton.pose();
    retargeted.set(name, result);
    return result;
  };
  targetSkin.skeleton.pose();
  model.updateMatrixWorld(true);
  return {
    model,
    targetSkin,
    clipFor,
    clipCount: sourceClips.size,
    mappedBones: Object.keys(options.names).length,
    skinMaterials,
    parts,
    soles,
    headBone: targetSkin.skeleton.getBoneByName("head"),
  };
}

function ChibiGameAvatar({ 보이기, 플레이어참조, 설정 = 기본치비설정, 크기 = 미터, 검증시각 = null }) {
  const root = useRef();
  const 남GLTF = useGLTF(몸파일.masculine);
  const 여GLTF = useGLTF(몸파일.feminine);
  const 모션GLTF = useGLTF(모션파일);
  const gender = 설정.gender === "feminine" ? "feminine" : "masculine";
  const 준비 = useMemo(
    () => 몸준비(gender === "feminine" ? 여GLTF : 남GLTF, 모션GLTF),
    [gender, 남GLTF, 여GLTF, 모션GLTF],
  );

  const 외형 = useMemo(
    () => ({ ...기본치비설정, ...설정 }),
    // 모션 값만 바뀔 때는 파츠를 다시 칠하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [설정.hair, 설정.top, 설정.bottom, 설정.shoes, 설정.skinny, 설정.heavy, 설정.buff, 설정.pupilScale,
      설정.skinColor, 설정.eyeColor, 설정.hairColor, 설정.topColor, 설정.bottomColor, 설정.shoesColor],
  );

  useEffect(() => {
    const 선택 = { hair: 외형.hair, top: 외형.top, bottom: 외형.bottom, shoes: 외형.shoes };
    const 색 = { hair: 외형.hairColor, top: 외형.topColor, bottom: 외형.bottomColor, shoes: 외형.shoesColor };
    const 큰눈 = Math.max(0, (외형.pupilScale - 1) / 0.45);
    const 작은눈 = Math.max(0, (1 - 외형.pupilScale) / 0.45);
    준비.parts.forEach(({ object, data }) => {
      const slot = data.slot;
      if (slot in 선택) object.visible = Number(data.variant) === 선택[slot];
      else if (slot === "underwear") object.visible = 선택.bottom < 0;
      else if (slot === "underweartop" || object.name.includes("UnderwearTop")) object.visible = 선택.top < 0;
      형태값(object, "heavy", 외형.heavy);
      형태값(object, "skinny", 외형.skinny);
      형태값(object, "buff", 외형.buff);
      if (/_(Iris|Pupil|Highlight)_/.test(object.name)) {
        형태값(object, "pupilLarge", 큰눈);
        형태값(object, "pupilSmall", 작은눈);
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (/^Skin_/.test(material.name)) material.color.set(외형.skinColor);
        else if (/^Iris_/.test(material.name)) material.color.set(외형.eyeColor);
        else if (/^Brow_/.test(material.name) && object.name.includes("_Brow_")) material.color.set(외형.hairColor);
        else if (slot === "hair") material.color.set(색.hair);
        else if (색[slot] && material.name === data.primary_color_material) material.color.set(색[slot]);
      });
    });
    let mask = 0;
    [["top", 0], ["bottom", 4], ["shoes", 8]].forEach(([slot, base]) => {
      if (선택[slot] >= 0) mask += 2 ** (base + 선택[slot]);
    });
    준비.parts.forEach(({ object }) => {
      if (object.userData.가림uniforms) object.userData.가림uniforms.uCoverMask.value = mask;
    });
  }, [준비, 외형]);

  const mixer = useMemo(() => new THREE.AnimationMixer(준비.targetSkin), [준비.targetSkin]);
  const actions = useRef(new Map());
  const 현재모션 = useRef(null);
  const 공중시작 = useRef(null);
  const 공중모션중 = useRef(false);
  const 점프시작끝 = useRef(0);
  const 착지끝 = useRef(0);
  const 마지막공격 = useRef(0);
  const 공격끝 = useRef(0);
  const 역행렬 = useMemo(() => new THREE.Matrix4(), []);
  const 점 = useMemo(() => new THREE.Vector3(), []);

  useEffect(
    () => () => {
      mixer.stopAllAction();
      actions.current.clear();
      // StrictMode 재실행 뒤에도 T포즈에 멈추지 않게 이름까지 비운다.
      현재모션.current = null;
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
    action.reset().setEffectiveTimeScale(name.startsWith("Punch_") ? 1.2 : 1).fadeIn(0.16);
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
    if (!보이기) return;

    const now = clock.elapsedTime;
    if ((state.attackSerial ?? 0) !== 마지막공격.current) {
      마지막공격.current = state.attackSerial ?? 0;
      const attackClip = 준비.clipFor(state.attackMotion);
      공격끝.current = now + THREE.MathUtils.clamp((attackClip?.duration ?? 0.62) / 1.2, 0.45, 0.82);
    }
    let next = 설정.motion;
    if (!next || next === "자동") {
      if (!state.grounded && 공중시작.current === null) 공중시작.current = now;
      if (state.grounded) 공중시작.current = null;
      const confirmedAir =
        state.jumping || (!state.grounded && 공중시작.current !== null && now - 공중시작.current > 0.12);
      if (now < 공격끝.current && state.attackMotion) next = state.attackMotion;
      else if (confirmedAir) {
        if (!공중모션중.current) 점프시작끝.current = now + 0.22;
        next = now < 점프시작끝.current ? "Jump_Start" : "Jump_Loop";
      } else if (공중모션중.current && state.grounded) {
        착지끝.current = now + 0.28;
        next = "Jump_Land";
      } else if (now < 착지끝.current) next = "Jump_Land";
      else if (state.crouching) next = state.moving ? "Crouch_Fwd_Loop" : "Crouch_Idle_Loop";
      else if (state.moving) next = state.running ? (설정.runMotion || "Jog_Fwd_Loop") : (설정.walkMotion || "Walk_Loop");
      else next = "Idle_Loop";
      공중모션중.current = confirmedAir;
    }
    재생(next);
    const action = actions.current.get(현재모션.current);
    if (검증시각 !== null && action) {
      actions.current.forEach((other) => {
        if (other !== action) other.stop();
      });
      action.stopFading().setEffectiveWeight(1).play();
      action.time = 검증시각 % Math.max(0.001, action.getClip().duration);
      mixer.update(0);
    } else mixer.update(delta);
    준비.headBone?.scale.setScalar(설정.headScale ?? 1);

    group.position.set(state.position.x, state.footY, state.position.z);
    group.rotation.set(0, state.facing, 0);
    const avatarScale = 크기 * (설정.heightScale ?? 1);
    group.scale.setScalar(avatarScale);
    group.updateMatrixWorld(true);

    // 발바닥 정점 중 가장 낮은 점을 지면에 맞춘다(발끝을 세우는 동작 포함).
    역행렬.copy(준비.model.matrixWorld).invert();
    let soleY = Infinity;
    준비.soles.forEach(({ object, indices }) => {
      for (let i = 0; i < indices.length; i += 4) {
        object.getVertexPosition(indices[i], 점);
        object.localToWorld(점).applyMatrix4(역행렬);
        soleY = Math.min(soleY, 점.y);
      }
    });
    if (Number.isFinite(soleY)) group.position.y = state.footY - soleY * avatarScale;

    if (import.meta.env.DEV) {
      window.__CHIBI_DEBUG = {
        visible: true,
        motion: next,
        motionCount: 준비.clipCount,
        mappedBones: 준비.mappedBones,
        gender,
      };
    }
  });

  return (
    <group name="NAJU-chibi-avatar" ref={root} visible={보이기}>
      <primitive object={준비.model} />
    </group>
  );
}

useGLTF.preload(몸파일.masculine);
useGLTF.preload(몸파일.feminine);
useGLTF.preload(모션파일);

export default ChibiGameAvatar;
