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
import { 기본메시설정, 메시모델파일 } from "./메시외형옵션.js";
import { 기본툰, 툰적용 } from "./툰재질.js";
import { 기본외곽선, 외곽선적용 } from "./툰외곽선.js";
import { 진단등록 } from "./캐릭터진단.js";
import { 기본보정, 이동모션, 보정쿼터니언, 클립보정 } from "./모션보정.js";

// 몸체 종류: chibi = V4 몸체 시제품, meshy = Meshy 민머리 기본 모델(텍스처 원본 유지).
const 몸파일 = {
  chibi: { masculine: "/models/chibi-male.glb", feminine: "/models/chibi-female.glb" },
  meshy: { masculine: "/models/meshy-male.glb", feminine: "/models/meshy-female.glb" },
};
const 모션파일 = "/models/vendor/quaternius-universal-animation-library.glb";

const 기본치비설정 = {
  motion: "자동",
  walkMotion: "Walk_Loop",
  runMotion: "Jog_Fwd_Loop",
  gender: "masculine",
  heightScale: 1,
  headScale: 1,
  skinColor: "#f3d2bd",
};

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

// 이동 모션은 제자리 루프라, 게임 이동 속도와 클립의 보폭 속도가 다르면 발이 미끄러진다.
// 클립을 훑어 디딘 발이 몸 기준으로 뒤로 밀려나는 거리를 재면 그 클립의 고유 이동 속도가 나온다.

function 보폭속도(root, skin, clip) {
  const 발 = ["foot_l", "foot_r"].map((name) => skin.skeleton.getBoneByName(name));
  if (!발[0] || !발[1] || !(clip.duration > 0)) return 0;
  const mixer = new THREE.AnimationMixer(skin);
  const action = mixer.clipAction(clip).play();
  const 표본 = 60;
  const 위치 = [new THREE.Vector3(), new THREE.Vector3()];
  let 이전 = null;
  let 합 = 0;
  for (let i = 0; i <= 표본; i += 1) {
    action.time = (clip.duration * i) / 표본;
    mixer.update(0);
    root.updateMatrixWorld(true);
    발.forEach((bone, j) => 위치[j].setFromMatrixPosition(bone.matrixWorld));
    const 디딤 = 위치[0].y <= 위치[1].y ? 0 : 1;
    // 디딘 발이 바뀌는 구간은 건너뛴다(두 발 사이를 잇는 거리는 보폭이 아니다).
    if (이전 && 이전.발 === 디딤) 합 += Math.hypot(위치[디딤].x - 이전.x, 위치[디딤].z - 이전.z);
    이전 = { 발: 디딤, x: 위치[디딤].x, z: 위치[디딤].z };
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(skin);
  skin.skeleton.pose();
  return 합 / clip.duration;
}

function 형태값(mesh, name, value) {
  const index = mesh.morphTargetDictionary?.[name];
  if (index !== undefined) mesh.morphTargetInfluences[index] = value;
}

function 몸준비(gltf, 모션GLTF, 보정값 = 기본보정) {
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
    object.material = object.material.clone();
    // GLB 노드 extras: slot(body/hair/top/bottom) + variant 번호
    let owner = object;
    while (owner && owner.userData.slot === undefined && owner.userData.chibi_part === undefined) owner = owner.parent;
    const data = owner?.userData ?? {};
    parts.push({ object, slot: data.slot ?? data.chibi_part ?? "body", variant: Number(data.variant ?? -1) });
    const part = object.userData.chibi_part;
    if (part === "body" || object.name.includes("Nose")) skinMaterials.push(object.material);
    if (part === "body") object.material.side = THREE.FrontSide;
    if (part === "body") {
      const position = object.geometry.getAttribute("position");
      const indices = [];
      for (let i = 0; i < position.count; i += 1) if (position.getY(i) < 0.02) indices.push(i);
      soles.push({ object, indices });
    }
  });

  const options = 리타게팅옵션(retargetSkin, sourceSkin);
  const 보정 = 보정쿼터니언(retargetSkin, 보정값);
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
    if (보정값.켬) 클립보정(result, 보정, name, 보정값);
    retargeted.set(name, result);
    return result;
  };
  const 보폭 = new Map();
  const 보폭For = (name) => {
    if (보폭.has(name)) return 보폭.get(name);
    const clip = clipFor(name);
    const speed = clip && 이동모션.has(name) ? 보폭속도(retargetModel, retargetSkin, clip) : 0;
    보폭.set(name, speed);
    return speed;
  };
  targetSkin.skeleton.pose();
  model.updateMatrixWorld(true);
  return {
    model,
    targetSkin,
    clipFor,
    보폭For,
    clipCount: sourceClips.size,
    mappedBones: Object.keys(options.names).length,
    skinMaterials,
    parts,
    soles,
    headBone: targetSkin.skeleton.getBoneByName("head"),
  };
}

function ChibiGameAvatar({ 보이기, 플레이어참조, 설정 = 기본치비설정, 크기 = 미터, 검증시각 = null, 몸체 = "chibi", 툰 = 기본툰, 외곽선 = 기본외곽선, 보정 = 기본보정 }) {
  const root = useRef();
  const meshy = 몸체 === "meshy";
  const 외형기본 = useMemo(() => ({ ...기본메시설정, ...설정 }), [설정]);
  const 모델경로 = meshy ? 메시모델파일(외형기본) : null;
  const 파일 = 몸파일[몸체] ?? 몸파일.chibi;
  const 남GLTF = useGLTF(meshy ? 모델경로 : 파일.masculine);
  const 여GLTF = useGLTF(meshy ? 모델경로 : 파일.feminine);
  const 모션GLTF = useGLTF(모션파일);
  const gender = 설정.gender === "feminine" ? "feminine" : "masculine";
  const 준비 = useMemo(
    () => 몸준비(!meshy && gender === "feminine" ? 여GLTF : 남GLTF, 모션GLTF, 보정),
    [meshy, gender, 남GLTF, 여GLTF, 모션GLTF, 보정],
  );

  // ── 애니메이션풍 재질 + 외곽선 ──────────────────────────────
  // 재질은 준비(모델)당 한 번만 갈아 끼우고, 세기 같은 값은 uniform 으로만 바꾼다.
  // 켜고 끄기는 원본 재질을 그대로 돌려놓는 방식이라 A/B 비교가 된다.
  const 갈래정하기 = useMemo(() => (object) => {
    let owner = object;
    while (owner && owner.userData.slot === undefined && owner.userData.chibi_part === undefined) owner = owner.parent;
    const slot = owner?.userData.slot ?? owner?.userData.chibi_part ?? "body";
    return slot === "hair" ? "hair" : slot === "body" ? "body" : "cloth";
  }, []);
  const 툰핸들 = useRef(null);
  const 외곽선핸들 = useRef(null);
  useEffect(() => {
    if (!툰.켬) return undefined;
    툰핸들.current = 툰적용(준비.model, 갈래정하기, 툰);
    return () => {
      툰핸들.current?.되돌리기();
      툰핸들.current = null;
    };
    // 단계·경계가 바뀌면 그라디언트 맵이 달라져 재질을 다시 만들어야 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [준비, 갈래정하기, 툰.켬, 툰.단계, 툰.경계]);
  useEffect(() => {
    툰핸들.current?.갱신(툰);
  }, [툰]);
  useEffect(() => {
    if (!외곽선.켬) return undefined;
    외곽선핸들.current = 외곽선적용(준비.model, 외곽선, 갈래정하기);
    return () => {
      외곽선핸들.current?.제거();
      외곽선핸들.current = null;
    };
    // 두께·색은 갱신으로만 바꾼다. 켬/끔이 아닌 값 변화로 껍데기를 다시 만들지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [준비, 갈래정하기, 외곽선.켬]);
  useEffect(() => {
    외곽선핸들.current?.갱신(외곽선);
  }, [외곽선]);
  useEffect(() => {
    진단등록(준비, { THREE, 클립이름: [...이동모션, "Idle_Loop", "Jump_Loop", "Punch_Cross"] });
  }, [준비]);

  // 파츠 표시·색: Meshy 파츠는 텍스처가 색을 담고 있어 선택 색을 곱한다.
  const 외형 = useMemo(
    () => ({ ...기본메시설정, ...설정 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [설정.hair, 설정.skinColor, 설정.hairColor, 설정.clothColor, 설정.shoulderWidth, 설정.hipWidth,
      설정.buff, 설정.heavy, 설정.skinny, 설정.armThickness, 설정.legThickness,
      설정.handScale, 설정.footScale, 설정.fistHands],
  );

  useEffect(() => {
    if (몸체 !== "meshy") {
      준비.skinMaterials.forEach((material) => material.color?.set(설정.skinColor ?? 기본치비설정.skinColor));
      return;
    }
    const 색 = { body: 외형.skinColor, hair: 외형.hairColor, top: 외형.clothColor, bottom: 외형.clothColor };
    // 슬라이더 → morph target. 어깨는 0.75~1.25를 -1~+1로 옮긴다.
    const 모프 = {
      heavy: 외형.heavy, skinny: 외형.skinny, buff: 외형.buff,
      shoulderWidth: THREE.MathUtils.clamp((외형.shoulderWidth - 1) / 0.25, -1, 1),
      hipWidth: (외형.hipWidth - 1) / 0.3,
      armThickness: (외형.armThickness - 1) / 0.3,
      legThickness: (외형.legThickness - 1) / 0.3,
      handScale: (외형.handScale - 1) / 0.3,
      footScale: (외형.footScale - 1) / 0.3,
      fistHands: 외형.fistHands,
    };
    // 몸과 옷은 한 메시라 재질 색으로는 못 가른다. 툰 재질일 때는 정점 표식으로
    // 피부·의상을 따로 칠하고, 원본 PBR 로 돌려놨을 때만 예전처럼 메시 단위로 칠한다.
    // 정점 표식이 있는 모델에서만 피부·의상을 따로 칠할 수 있다.
    const 툰켬 = Boolean(툰핸들.current?.표식있음);
    준비.parts.forEach(({ object, slot, variant }) => {
      if (slot === "hair") object.visible = variant === 외형.hair;
      Object.entries(모프).forEach(([key, value]) => 형태값(object, key, value));
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const 칠 = slot === "hair" || !툰켬 ? (색[slot] ?? "#ffffff") : "#ffffff";
      materials.forEach((material) => material.color?.set(칠));
    });
    툰핸들.current?.색칠({ 피부: 외형.skinColor, 의상: 외형.clothColor });
    // 툰 재질이 붙은 뒤에 색을 칠해야 하므로 툰 켬/끔도 의존성에 둔다.
  }, [준비, 외형, 몸체, 설정.skinColor, 툰.켬]);

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
    const avatarScale = 크기 * (설정.heightScale ?? 1);

    // 걷기는 언제나 걷기 클립이다. 달릴 때만 실제 속도에 보폭이 가장 가까운 클립을
    // 고른다(고르고 남은 차이는 재생 속도로 맞춘다).
    const 이동선택 = (지면, 후보) => {
      let best = 후보[0];
      let bestErr = Infinity;
      후보.forEach((name) => {
        const 고유 = 준비.보폭For(name) * avatarScale;
        if (고유 <= 1e-4) return;
        const err = Math.abs(Math.log(Math.max(1e-4, 지면) / 고유));
        if (err < bestErr) {
          bestErr = err;
          best = name;
        }
      });
      return best;
    };

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
      else if (state.moving) {
        next = state.running
          ? 이동선택(state.speed ?? 0, [설정.runMotion || "Jog_Fwd_Loop", "Sprint_Loop"])
          : (설정.walkMotion || "Walk_Loop");
      }
      else next = "Idle_Loop";
      공중모션중.current = confirmedAir;
    }
    재생(next);
    const action = actions.current.get(현재모션.current);
    // 발이 미끄러지지 않도록 걷기·달리기 재생 속도를 실제 이동 속도에 맞춘다.
    if (action && 검증시각 === null && 이동모션.has(next)) {
      const 고유 = 준비.보폭For(next) * avatarScale;
      const 지면 = state.speed ?? 0;
      action.setEffectiveTimeScale(고유 > 1e-4 ? THREE.MathUtils.clamp(지면 / 고유, 0.45, 2.0) : 1);
    }
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
        stride: Object.fromEntries([...이동모션].map((n) => [n, 준비.보폭For(n)])),
        timeScale: action?.getEffectiveTimeScale?.() ?? 1,
        speed: state.speed ?? 0,
      };
    }
  });

  return (
    <group name="NAJU-chibi-avatar" ref={root} visible={보이기}>
      <primitive object={준비.model} />
    </group>
  );
}

useGLTF.preload(몸파일.chibi.masculine);
useGLTF.preload(몸파일.chibi.feminine);
useGLTF.preload(모션파일);

export default ChibiGameAvatar;
