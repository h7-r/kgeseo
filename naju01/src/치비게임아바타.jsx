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
import { 기본메시설정, 메시모델파일, 메시신발파일 } from "./메시외형옵션.js";
import { 기본툰, 툰적용 } from "./툰재질.js";
import { 기본외곽선, 외곽선적용 } from "./툰외곽선.js";
import { 진단등록 } from "./캐릭터진단.js";
import { 기본보정, 성별보정, 트리포보정, 트리포성별보정, 이동모션, 보정쿼터니언, 클립보정 } from "./모션보정.js";

// 몸체 종류: chibi = V4 몸체 시제품, meshy = Meshy 민머리 기본 모델(텍스처 원본 유지).
const 몸파일 = {
  chibi: { masculine: "/models/chibi-male.glb", feminine: "/models/chibi-female.glb" },
  meshy: { masculine: "/models/meshy-male.glb", feminine: "/models/meshy-female.glb" },
};
const 모션파일 = "/models/vendor/quaternius-universal-animation-library.glb";
// Tripo 동작(우리 몸체에 맞춰 만든 걷기·대기·달리기). 뼈 이름은 굽는 도구에서 우리 리그 이름으로 바꿔 둔다.
// 파일마다 리그가 다를 수 있다(Tripo 가 몸체마다 새로 리깅한다) — 클립은 제 리그로 리타게팅해야 한다.
const 트리포모션파일들 = ["/models/tripo-motions.glb?v=8", "/models/tripo-motions-fold.glb?v=1"];

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

// 따로 구운 파츠(신발)를 캐릭터 골격에 묶는다. 파츠 GLB 의 골격은 뼈 순서가 다를 수 있어
// skinIndex 를 뼈 이름으로 다시 매긴다. 쉴 때 자세가 같으므로 bind 행렬은 몸 것을 쓴다.
function 파츠붙이기(partsGLTF, targetSkin, 오류 = []) {
  const out = [];
  if (!partsGLTF) return out;
  partsGLTF.scene.traverse((object) => {
    if (!object.isSkinnedMesh) return;
    const geometry = object.geometry.clone();
    const 이름표 = targetSkin.skeleton.bones.map((bone) => bone.name);
    const 대응 = object.skeleton.bones.map((bone) => 이름표.indexOf(bone.name));
    // 몸 골격에 없는 뼈를 쓰는 파츠는 붙이지 않는다. 예전에는 0번(뿌리)으로 몰아 붙였는데,
    // 그러면 옷이 캐릭터 가운데에 뭉친 채 '그럭저럭 보이는' 상태로 넘어가 원인을 못 찾는다.
    const 없는뼈 = object.skeleton.bones.filter((bone) => !이름표.includes(bone.name)).map((bone) => bone.name);
    if (없는뼈.length) {
      오류.push({ 이름: object.name, 없는뼈 });
      return;
    }
    const index = geometry.getAttribute("skinIndex");
    for (let i = 0; i < index.count * index.itemSize; i += 1) index.array[i] = 대응[index.array[i]] ?? 0;
    index.needsUpdate = true;
    const material = Array.isArray(object.material) ? object.material.map((m) => m.clone()) : object.material.clone();
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = object.name;
    // 파츠 표식(slot·variant·side·foot_shrink)은 재질이 여럿이면 메시가 아니라 부모 그룹 노드에
    // 붙어 온다. 조상까지 훑어 모은다(가까운 쪽이 우선). 이걸 빠뜨리면 신발이 늘 보이고
    // 밑창 지면 맞춤·발 줄이기가 전부 죽는다(실제로 그랬다).
    for (let node = object; node && node !== partsGLTF.scene; node = node.parent) {
      Object.entries(node.userData).forEach(([k, v]) => { if (!(k in mesh.userData)) mesh.userData[k] = v; });
    }
    mesh.bind(targetSkin.skeleton, targetSkin.bindMatrix);
    targetSkin.parent.add(mesh);
    out.push(mesh);
  });
  return out;
}

function 몸준비(gltf, 모션GLTF, 보정값 = 기본보정, 신발GLTF = null, 트리포GLTFs = null, 트리포값 = 트리포보정) {
  const model = clone(gltf.scene);
  const retargetModel = clone(gltf.scene);
  const source = clone(모션GLTF.scene);
  const targetSkin = 첫스킨메시(model);
  const retargetSkin = 첫스킨메시(retargetModel);
  const sourceSkin = 첫스킨메시(source);
  // Tripo 동작 소스(파일 여러 개) — 같은 이름의 클립을 이쪽에서 먼저 찾는다. 클립마다 제 파일의 리그를 쓴다.
  const 트리포근원들 = (트리포GLTFs ?? []).map((g) => { const 씬 = clone(g.scene); const 스킨 = 첫스킨메시(씬); return { 씬, 스킨, 클립: g.animations }; }).filter((x) => x.스킨);
  const 트리포스킨 = 트리포근원들[0]?.스킨 ?? null;
  const 트리포클립 = new Map();
  트리포근원들.forEach((근원) => 근원.클립.forEach((clip) => { if (!트리포클립.has(clip.name)) 트리포클립.set(clip.name, { clip, 근원 }); }));
  const skinMaterials = [];
  const soles = [];
  const parts = [];
  const 파츠오류 = [];
  const 신발파츠 = 파츠붙이기(신발GLTF, targetSkin, 파츠오류);
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
      // 접지 IK 가 발마다 높이를 보므로 좌우(x 부호)로 나눠 둔다.
      const 왼발 = [];
      const 오른발 = [];
      for (let i = 0; i < position.count; i += 1) {
        if (position.getY(i) >= 0.02) continue;
        indices.push(i);
        (position.getX(i) >= 0 ? 왼발 : 오른발).push(i);
      }
      soles.push({ object, indices, 왼발, 오른발 });
    }
    // 신발은 밑창이 맨발보다 낮다. 신었을 때는 신발 바닥이 지면 기준이 된다(보이는 것만 센다).
    if (data.slot === "shoes") {
      const position = object.geometry.getAttribute("position");
      const indices = [];
      // 바닥 근처 정점 전부(가장 낮은 점 + 2cm). 0 미만으로 잡으면 밑창이 정확히 0 인 신발은 비어서
      // 맨발 정점이 지면 기준이 되고 신발이 땅에 묻힌다.
      let 최저 = Infinity;
      for (let i = 0; i < position.count; i += 1) 최저 = Math.min(최저, position.getY(i));
      // 5cm — 발이 앞뒤로 기울면(대기 -35°) 쉴 때 최저점이 아닌 뒤꿈치·앞코 가장자리가 최저가 된다.
      for (let i = 0; i < position.count; i += 1) if (position.getY(i) < 최저 + 0.05) indices.push(i);
      const 왼발 = data.side === "l" ? indices : [];
      const 오른발 = data.side === "r" ? indices : [];
      soles.push({ object, indices, 왼발, 오른발 });
    }
  });

  const options = 리타게팅옵션(retargetSkin, sourceSkin);
  트리포근원들.forEach((근원) => { 근원.옵션 = 리타게팅옵션(retargetSkin, 근원.스킨); 근원.씬.skeleton = 근원.스킨.skeleton; });
  const 보정 = 보정쿼터니언(retargetSkin, 보정값);
  const 트리포규칙 = 트리포스킨 ? 보정쿼터니언(retargetSkin, 트리포값) : null;
  // Tripo 팔짱 클립은 그대로가 제일 낫다 — 어깨·팔벌림·쇄골을 손대 봤더니 앞뒤 아래팔이 뒤바뀌고
  // 한쪽 손이 가슴 앞 11cm 허공에 떠 버렸다(원본은 두 아래팔이 가슴에 붙고 손이 반대팔에 얹힌다).
  // 원본에 남은 흠은 오른손이 왼팔을 파고드는 것뿐이라(손 정점 198개가 팔 속) 거기만 편다.
  const 팔짱값 = { ...트리포값, 팔벌림도: 0, 팔앞으로도: 0, 팔꿈치펴기도: 0, 쇄골앞으로도: 0, 팔꿈치펴기늘: true,
    // 오른 팔꿈치를 18° 펴면 파고든 정점이 198 → 45 개로 줄어 왼손(29개)과 같아진다.
    오른팔꿈치펴기도: 18, ...(트리포값.팔짱덧값 ?? {}) };
  const 팔짱규칙 = 트리포스킨 ? 보정쿼터니언(retargetSkin, 팔짱값) : null;
  // 그냥 서 있는 대기(Idle_Loop)만 따로 편다 — 걷기·달리기는 손대지 않는다.
  const 대기값 = { ...트리포값, ...(트리포값.대기덧값 ?? {}) };
  const 대기규칙 = 트리포스킨 ? 보정쿼터니언(retargetSkin, 대기값) : null;
  source.skeleton = sourceSkin.skeleton;
  const sourceClips = new Map(모션GLTF.animations.map((clip) => [clip.name, clip]));
  const retargeted = new Map();
  const clipFor = (name) => {
    if (retargeted.has(name)) return retargeted.get(name);
    // Tripo 클립은 우리 몸체에 맞춰 만든 것이라 자세 보정(모션보정.js)을 걸지 않는다.
    const 트리포것 = 트리포클립.get(name);
    const sourceClip = 트리포것?.clip ?? sourceClips.get(name);
    if (!sourceClip) return null;
    const 근원 = 트리포것 ? 트리포것.근원.씬 : source;
    const 근원스킨 = 트리포것 ? 트리포것.근원.스킨 : sourceSkin;
    retargetSkin.skeleton.pose();
    근원스킨.skeleton.pose();
    근원.updateMatrixWorld(true);
    retargetSkin.updateMatrixWorld(true);
    const result = retargetClip(retargetSkin, 근원, sourceClip, 트리포것 ? 트리포것.근원.옵션 : options);
    result.name = name;
    retargetSkin.skeleton.pose();
    // 클립마다 쓸 보정 — 팔짱·대기는 그 클립 전용 값이 있다.
    let [규칙, 값] = 트리포것 ? [트리포규칙, 트리포값] : [보정, 보정값];
    if (트리포것 && name === "Idle_Fold_Loop") [규칙, 값] = [팔짱규칙, 팔짱값];
    if (트리포것 && name === "Idle_Loop") [규칙, 값] = [대기규칙, 대기값];
    if (보정값.켬) 클립보정(result, 규칙, name, 값);
    retargeted.set(name, result);
    return result;
  };
  // 발마다 '접지 시각'(한 주기에서 발이 가장 낮은 순간, 0~1). 접지 IK 는 이 직전·직후에만 건다.
  // 높이만으로는 낮게 스윙하는 발과 디디려는 발을 못 가른다 — 창을 넓히면 스윙 다리를
  // 붙잡아 곧게 뻗어 버렸다(실제로 그랬다). 시각으로 고르면 그 문제가 없다.
  const 접지시각 = new Map();
  const 접지시각For = (name) => {
    if (접지시각.has(name)) return 접지시각.get(name);
    const clip = clipFor(name);
    let out = null;
    if (clip && 이동모션.has(name)) {
      const 발 = ["l", "r"].map((s) => [retargetSkin.skeleton.getBoneByName(`foot_${s}`), retargetSkin.skeleton.getBoneByName(`ball_${s}`)]);
      if (발.every(([f, b]) => f && b)) {
        const mixer = new THREE.AnimationMixer(retargetSkin);
        const action = mixer.clipAction(clip).play();
        const 표본 = 64;
        const 높이 = [new Float32Array(표본), new Float32Array(표본)];
        const p1 = new THREE.Vector3();
        const p2 = new THREE.Vector3();
        for (let i = 0; i < 표본; i += 1) {
          action.time = (clip.duration * i) / 표본;
          mixer.update(0);
          retargetModel.updateMatrixWorld(true);
          발.forEach(([f, b], k) => {
            높이[k][i] = Math.min(p1.setFromMatrixPosition(f.matrixWorld).y, p2.setFromMatrixPosition(b.matrixWorld).y);
          });
        }
        mixer.stopAllAction();
        mixer.uncacheRoot(retargetSkin);
        retargetSkin.skeleton.pose();
        // 접지 = 입각기가 **시작되는** 샘플. 최저점은 발이 이미 붙어 있는 한가운데라
        // 그 직전 창은 땅 위 구간이 된다 — 최저 높이의 15% 문턱 아래로 처음 내려오는
        // 순간(최저점에서 거꾸로 훑어 문턱을 넘는 곳)을 잡는다.
        const 시작 = 높이.map((h) => {
          let min = Infinity;
          let max = -Infinity;
          let imin = 0;
          h.forEach((y, i) => { if (y < min) { min = y; imin = i; } if (y > max) max = y; });
          const 문턱 = min + (max - min) * 0.15;
          let i = imin;
          for (let k = 0; k < 표본; k += 1) {
            const j = (imin - k + 표본) % 표본;
            if (h[j] > 문턱) break;
            i = j;
          }
          return i / 표본;
        });
        out = { l: 시작[0], r: 시작[1] };
      }
    }
    접지시각.set(name, out);
    return out;
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
  // 접지 IK 용 — 무릎(calf)의 쉴 때 회전과 다리 뼈. 굽힘은 '쉴 때 대비 회전'으로 재고 줄인다.
  targetSkin.skeleton.pose();
  const 다리 = ["l", "r"].map((s) => {
    const thigh = targetSkin.skeleton.getBoneByName(`thigh_${s}`);
    const calf = targetSkin.skeleton.getBoneByName(`calf_${s}`);
    const foot = targetSkin.skeleton.getBoneByName(`foot_${s}`);
    return thigh && calf && foot ? { s, thigh, calf, foot } : null;
  }).filter(Boolean);
  const 골반뼈 = targetSkin.skeleton.getBoneByName("pelvis");
  // 신발을 신으면 발볼 뼈를 줄여 발가락을 신발 안으로 접어 넣는다(신발은 발뼈에 통째로 붙는다).
  const 발볼뼈 = ["ball_l", "ball_r"].map((n) => targetSkin.skeleton.getBoneByName(n)).filter(Boolean);
  // 신발을 신으면 발뼈를 이 배율로 줄인다(신발 GLB 가 foot_shrink 로 알려 준다 — 그만큼 미리 키워
  // 구워져 있어 신발은 제 크기, 발만 작아져 뒤꿈치·발볼이 비치지 않는다).
  const 발뼈 = ["foot_l", "foot_r"].map((n) => targetSkin.skeleton.getBoneByName(n)).filter(Boolean);
  const 신발수축 = 신발파츠.find((m) => m.userData.foot_shrink)?.userData.foot_shrink ?? 1;
  // 팔·다리 길이 조절 — **뿌리 뼈(위팔·허벅지)를 통째로 배율**로 줄인다. 자식(아래팔·손,
  // 종아리·발)이 배율을 물려받아 관절 위치와 **살이 함께** 줄어든다.
  //   ※ 예전에는 아래팔·손 뼈의 위치만 당겼다. 그러면 뼈 사이 거리는 줄지만 위팔 살은 그대로라
  //     팔꿈치에서 살이 겹쳐 **팔이 끊어져 보였다**(사용자 지적). 위팔이 안 줄고 아래팔만 준 것처럼 보인 이유다.
  //   ※ 배율은 반드시 **균등**이어야 한다. 한 축만 줄이면 팔꿈치·무릎이 굽었을 때 자식이 기울어져 찌그러진다.
  //   ※ 손·발은 팔·다리 길이를 따라 줄면 안 되므로 역배율로 되돌린다(제 크기 조절은 따로 있다).
  const 길이뿌리 = (이름들) => 이름들.map((n) => targetSkin.skeleton.getBoneByName(n)).filter(Boolean);
  const 팔뿌리 = 길이뿌리(["upperarm_l", "upperarm_r"]);
  const 손뼈 = 길이뿌리(["hand_l", "hand_r"]);
  const 다리뿌리 = 길이뿌리(["thigh_l", "thigh_r"]);
  // 어깨 폭 — 위팔 뼈의 쉴 때 위치(쇄골 기준)에 배율을 곱한다. 어깨 관절이 옆으로 나가고 팔 전체가 따라간다.
  //   ※ shoulderWidth 모프는 쓰지 않는다. 모프는 팔 정점까지 옆으로 밀어서, 팔을 내리면 그 오프셋이
  //     팔뼈를 따라 돌아 어깨가 아래로 처졌다(실제로 그랬다).
  const 어깨뼈 = ["upperarm_l", "upperarm_r"].map((n) => targetSkin.skeleton.getBoneByName(n)).filter(Boolean)
    .map((bone) => ({ bone, 쉴때: bone.position.clone() }));
  return {
    // 몸 골격에 없는 뼈를 써서 못 붙인 파츠(신발 등). 비어 있어야 정상이다.
    파츠오류,
    팔뿌리,
    손뼈,
    다리뿌리,
    어깨뼈,
    발볼뼈,
    발뼈,
    신발수축,
    model,
    targetSkin,
    다리,
    골반뼈,
    clipFor,
    보폭For,
    접지시각For,
    보정값,
    clipCount: sourceClips.size,
    트리포클립: [...트리포클립.keys()],
    mappedBones: Object.keys(options.names).length,
    skinMaterials,
    parts,
    soles,
    headBone: targetSkin.skeleton.getBoneByName("head"),
  };
}

// 개발용: 주소의 ?이름=키:값,키:값 을 덧값 객체로 만든다(DEV 에서만).
//   보기) gait.html?fold=왼팔꿈치펴기도:-20,왼팔앞으로도:-10
// 값 이름을 그대로 적으므로 자리를 세지 않아도 되고, 새 보정 키가 늘어도 고칠 데가 없다.
function 개발덧값(이름) {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search).get(이름);
  if (!q) return null;
  const out = {};
  q.split(",").forEach((쌍) => {
    const [k, v] = 쌍.split(":");
    const n = Number(v);
    if (k && Number.isFinite(n)) out[k.trim()] = n;
  });
  return Object.keys(out).length ? out : null;
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
  const 신발GLTF = useGLTF(meshy ? 메시신발파일(외형기본) : 몸파일.chibi.masculine);
  const 트리포GLTF = useGLTF(트리포모션파일들);
  const 트리포씀 = (설정.motionSource ?? 기본메시설정.motionSource) === "tripo";
  const gender = 설정.gender === "feminine" ? "feminine" : "masculine";
  // 기본값 → 성별별 값 → 호출자 덧값 순으로 합친다. 호출자는 바꿀 것만 넘긴다.
  const 보정값 = useMemo(() => ({ ...기본보정, ...(성별보정[gender] ?? {}), ...(보정 ?? {}) }), [gender, 보정]);
  const 트리포값 = useMemo(() => {
    const v = { ...트리포보정, ...(트리포성별보정[gender] ?? {}) };

    // 개발용 덧값 — gait.html?walk=…&fold=…&idle=… 로 값을 바로 바꿔 본다.
    // 덧값은 성별값에 이미 있을 수 있으니, 주소로 넘어온 키만 덮어쓴다.
    Object.assign(v, 개발덧값("walk") ?? {});
    const 팔짱 = 개발덧값("fold");
    if (팔짱) v.팔짱덧값 = { ...(v.팔짱덧값 ?? {}), ...팔짱 };
    const 대기 = 개발덧값("idle");
    if (대기) v.대기덧값 = { ...(v.대기덧값 ?? {}), ...대기 };
    return v;
  }, [gender]);
  const 준비 = useMemo(
    () => 몸준비(!meshy && gender === "feminine" ? 여GLTF : 남GLTF, 모션GLTF, 보정값, meshy ? 신발GLTF : null, 트리포씀 ? 트리포GLTF : null, 트리포값),
    [meshy, gender, 남GLTF, 여GLTF, 모션GLTF, 보정값, 신발GLTF, 트리포GLTF, 트리포씀, 트리포값],
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
    [설정.hair, 설정.shoes, 설정.skinColor, 설정.hairColor, 설정.clothColor, 설정.shoulderWidth, 설정.hipWidth,
      설정.buff, 설정.heavy, 설정.skinny, 설정.armThickness, 설정.legThickness,
      설정.handScale, 설정.footScale, 설정.fistHands],
  );

  useEffect(() => {
    if (몸체 !== "meshy") {
      준비.skinMaterials.forEach((material) => material.color?.set(설정.skinColor ?? 기본치비설정.skinColor));
      return;
    }
    const 색 = { body: 외형.skinColor, hair: 외형.hairColor, top: 외형.clothColor, bottom: 외형.clothColor };
    const 신었나 = (외형.shoes ?? -1) >= 0;
    // 슬라이더 → morph target. 어깨는 0.75~1.25를 -1~+1로 옮긴다.
    const 모프 = {
      heavy: 외형.heavy, skinny: 외형.skinny, buff: 외형.buff,
      shoulderWidth: 0, // 뼈로 넓힌다(useFrame 의 어깨뼈). 모프는 팔이 처져서 안 쓴다.
      hipWidth: (외형.hipWidth - 1) / 0.3,
      armThickness: (외형.armThickness - 1) / 0.3,
      legThickness: (외형.legThickness - 1) / 0.3,
      handScale: (외형.handScale - 1) / 0.3,
      // 신발을 신으면 발 모프 대신 발뼈 배율로 신발과 함께 키운다(useFrame 의 발뼈).
      footScale: 신었나 ? 0 : (외형.footScale - 1) / 0.3,
      fistHands: 외형.fistHands,
    };
    // 몸과 옷은 한 메시라 재질 색으로는 못 가른다. 툰 재질일 때는 정점 표식으로
    // 피부·의상을 따로 칠하고, 원본 PBR 로 돌려놨을 때만 예전처럼 메시 단위로 칠한다.
    // 정점 표식이 있는 모델에서만 피부·의상을 따로 칠할 수 있다.
    const 툰켬 = Boolean(툰핸들.current?.표식있음);
    준비.parts.forEach(({ object, slot, variant }) => {
      if (slot === "hair" || slot === "shoes") object.visible = variant === 외형[slot];
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
  const [H, K, F, F2, T, u, v, n] = useMemo(() => Array.from({ length: 8 }, () => new THREE.Vector3()), []);
  const pq = useMemo(() => new THREE.Quaternion(), []);
  const wq = useMemo(() => new THREE.Quaternion(), []);
  const 옆세계 = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const 접지상태 = useRef(null);
  // IK 가 만진 다리 뼈의 '클립 자세' 보관함. 믹서는 값이 지난 프레임과 같으면 본에
  // 쓰지 않으므로(정지 화면·검증시각), 안 쓴 프레임엔 우리가 되돌려야 IK 가 누적되지
  // 않는다 — 실측: 0.7cm 요청이 몇 프레임 뒤 3.6cm, 결국 최대 뻗음 14cm 에서 포화.
  const 다리보관 = useRef(new Map());
  // IK 양(올림·내림)의 지난 프레임 값 — 시간 평활용. 발마다 { 올림, 내림 }.
  const 접지평활 = useRef({ l: { 올림: 0, 내림: 0 }, r: { 올림: 0, 내림: 0 } });

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
    // 대기는 남녀 같은 클립(Tripo Idle_Loop — 허리에 손)을 쓴다.
    //   ※ 남성은 팔짱 클립(Idle_Fold_Loop)을 쓰던 때가 있었는데, 어깨가 22cm 벌어진 Tripo 리그로 만든
    //     자세라 우리 몸(13cm)에 얹으면 손이 반대팔을 뚫거나 허공에 떴다. 여러 번 손봐도 자연스럽지
    //     않아 걷어냈다. 남자다움은 다리를 벌려 낸다(모션보정 트리포성별보정.masculine 대기덧값).
    //     클립 자체는 파일에 남아 있으니 되살리려면 이 줄을 되돌리면 된다.
    재생(next);
    const action = actions.current.get(현재모션.current);
    // 발이 미끄러지지 않도록 걷기·달리기 재생 속도를 실제 이동 속도에 맞춘다.
    if (action && 검증시각 === null && 이동모션.has(next)) {
      const 고유 = 준비.보폭For(next) * avatarScale;
      const 지면 = state.speed ?? 0;
      action.setEffectiveTimeScale(고유 > 1e-4 ? THREE.MathUtils.clamp(지면 / 고유, 0.45, 2.2) : 1);
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
    // 팔·다리 길이 — 믹서가 쓴 뒤에 덮어야 한다(클립에 위치·배율 트랙이 있을 수 있다).
    const 팔길이 = 설정.armLength ?? 1;
    const 다리길이 = 설정.legLength ?? 1;
    준비.팔뿌리.forEach((bone) => bone.scale.setScalar(팔길이));
    준비.다리뿌리.forEach((bone) => bone.scale.setScalar(다리길이));
    // 손은 팔 배율을 물려받으므로 되돌린다(손 크기는 모프로 따로 조절한다).
    준비.손뼈.forEach((bone) => bone.scale.setScalar(1 / 팔길이));
    const 어깨폭 = 설정.shoulderWidth ?? 1;
    준비.어깨뼈.forEach(({ bone, 쉴때 }) => bone.position.copy(쉴때).multiplyScalar(어깨폭));
    const 신발신음 = meshy && (설정.shoes ?? -1) >= 0;
    // 발 크기: 맨발은 몸 모프(footScale)가 바꾸지만 **신발 GLB 에는 모프가 없다**.
    // 신발은 발뼈에 통째로 묶여 있으므로, 신었을 때는 발뼈 배율로 신발째 키우고 줄인다
    // (그때 몸 모프는 0 으로 둔다 — 둘 다 걸면 발이 두 번 커진다).
    // 다리 배율도 물려받으니 함께 되돌린다 — 발은 다리 길이를 따라 커지면 안 된다.
    준비.발뼈.forEach((bone) => bone.scale.setScalar((신발신음 ? 준비.신발수축 * (설정.footScale ?? 1) : 1) / 다리길이));
    // 발볼은 발뼈의 자식이라 위 배율까지 물려받는다. 신발 안에서 접히기만 하면 되니 그대로 둔다.
    준비.발볼뼈.forEach((bone) => bone.scale.setScalar(신발신음 ? 0.02 : 1));

    group.position.set(state.position.x, state.footY, state.position.z);
    group.rotation.set(0, state.facing, 0);
    group.scale.setScalar(avatarScale);
    group.updateMatrixWorld(true);

    // 발마다 발바닥 최저점(모델 좌표). 스키닝 결과를 읽어야 하므로 뼈 행렬을 먼저 굽는다.
    역행렬.copy(준비.model.matrixWorld).invert();
    const 발바닥높이 = (측) => {
      let y = Infinity;
      준비.soles.forEach(({ object, 왼발, 오른발 }) => {
        if (!object.visible) return;
        const 목록 = 측 === "l" ? 왼발 : 오른발;
        for (let i = 0; i < 목록.length; i += 3) {
          object.getVertexPosition(목록[i], 점);
          object.localToWorld(점).applyMatrix4(역행렬);
          y = Math.min(y, 점.y);
        }
      });
      return y;
    };

    // 접지 IK — 낮은 발은 땅에 붙는다(아래 지면 맞추기). 다른 발이 **접지 직전**이면
    // (골반보다 앞에 있고 땅에서 접지창 안) 그 다리를 엉덩이+무릎 2본 IK 로 풀어
    // 발을 제자리에서 수직으로 땅까지 내린다. 리타게팅한 클립은 몸 비율이 달라
    // 앞발이 땅에 못 닿은 채 딛는데, 그게 '앞발이 높은 곳을 딛는' 것과 '다리가
    // 끝내 안 펴지는' 두 증상의 같은 원인이다.
    //   ※ 무릎만 펴서는 안 된다 — 허벅지가 앞으로 나간 상태에서 무릎을 펴면 발은
    //     앞·위로 간다(실측 발끝 높이 0.077 → 0.183). 그래서 엉덩이까지 같이 푼다.
    //   ※ 스윙 중인 발은 건드리면 안 된다 — 창을 넓게 잡았더니 공중의 다리를 붙잡아
    //     곧게 뻗어 버렸다. 골반 앞쪽 + 좁은 창으로 접지 직전만 고른다.
    // Tripo 클립은 접지 IK 를 걸지 않는다(트리포보정.접지켬).
    const 접지쓰기 = 준비.트리포클립.includes(next) ? 트리포보정.접지켬 !== false : 준비.보정값?.접지켬 !== false;
    if (접지쓰기 && 준비.다리.length === 2 && 준비.골반뼈) {
      // 믹서가 이번 프레임에 뼈를 썼으면(우리가 남긴 IK 값과 다르면) 그게 클립 자세다.
      // 안 썼으면(IK 값 그대로면) 보관해 둔 클립 자세로 되돌린 뒤 IK 를 새로 건다.
      준비.다리.forEach((d) => [d.thigh, d.calf].forEach((bone) => {
        let 칸 = 다리보관.current.get(bone);
        if (!칸) {
          칸 = { 클립: bone.quaternion.clone(), ik: null };
          다리보관.current.set(bone, 칸);
        } else if (칸.ik && bone.quaternion.equals(칸.ik)) bone.quaternion.copy(칸.클립);
        else 칸.클립.copy(bone.quaternion);
      }));
      준비.다리.forEach((d) => { d.thigh.updateMatrixWorld(true); });
      준비.targetSkin.skeleton.update();
      const 높이 = 준비.다리.map((d) => 발바닥높이(d.s));
      const 낮은 = 높이[0] <= 높이[1] ? 0 : 1;
      const 다른 = 1 - 낮은;
      const 틈 = 높이[다른] - 높이[낮은]; // 모델 단위
      const 창 = (준비.보정값?.접지창 ?? 0.045) * 1.45;
      const 다리 = 준비.다리[다른];
      // 뒤에서 떼는 발은 제외 — 골반보다 앞에 있는(다가오는) 발만 접지 대상이다.
      // 이 조건을 뺐더니 떼는 뒷발이 창에 걸려 뒷다리가 70° 로 꺾였다.
      점.setFromMatrixPosition(다리.foot.matrixWorld).applyMatrix4(역행렬);
      const 발앞뒤 = 점.z;
      점.setFromMatrixPosition(준비.골반뼈.matrixWorld).applyMatrix4(역행렬);
      // 문턱은 전부 부드러운 가중치로 건다. 딱딱한 on/off(골반 앞 2cm, 틈 4mm~창, 2mm 하한)로
      // 걸었더니 양발 지지 구간에서 틈이 문턱 근처를 오가며 프레임마다 IK 가 켜졌다 꺼져
      // 몸 높이가 3~4mm 씩 12Hz 로 떨렸다(실측 — 바들바들 떠는 것처럼 보인 원인).
      const 앞가중 = THREE.MathUtils.smoothstep(발앞뒤 - 점.z, 0.01, 0.03);
      const 앞에있음 = 앞가중 > 0.001;
      const 틈가중 = THREE.MathUtils.smoothstep(틈, 0.002, 0.008) * (1 - THREE.MathUtils.smoothstep(틈, 창 * 0.7, 창));
      // 접지 시각 창: 그 발이 평평하게 붙는 시각의 25% 전 ~ 3% 후. 뒤꿈치가 닿아도
      // 발목·발볼 뼈는 아직 높아 '붙는 시각'이 뒤꿈치 접지보다 ~0.2 주기 늦게 잡히므로,
      // 그만큼 앞을 덮어야 뒤꿈치 접근 구간이 들어온다. 스윙 중간은 높이 조건이 거른다.
      // 창 안에서 가중치를 0→1→0 으로 매끄럽게 올렸다 내린다. 온/오프로 걸면 발이
      // 닿는 순간 다리가 '탁' 펴져 힘줘 뻗는 것처럼 경직돼 보였다.
      // 두 단계로 나눈다. 뒤꿈치가 닿는 순간(붙는 시각 ~0.2 전)까지는 '접근' — 뻗는 다리가
      // 엉덩이 회전으로 발을 내린다. 그 뒤 '하중' — 닿은 다리는 무릎을 굽히며 체중을
      // 받아야 하므로(원본 11°→42°) 더 펴면 안 되고, 뒤에서 미는 다리를 굽혀 골반을
      // 내리는 것으로만 발을 땅에 둔다. 접근 구간까지 뻗는 다리를 펴게 뒀더니 하중
      // 구간 내내 다리가 반듯해 힘줘 뻗는 듯 경직돼 보였다.
      let 접지가중 = 0;
      let 앞다리몫 = 0; // 접근 1 → 하중 0
      if (action && 이동모션.has(next)) {
        const 시각표 = 준비.접지시각For(next);
        const 길이 = action.getClip().duration || 1;
        if (시각표) {
          const 위상 = ((action.time % 길이) + 길이) % 길이 / 길이;
          const 차 = ((위상 - 시각표[다리.s]) % 1 + 1) % 1; // 붙는 시각 기준 0~1
          if (차 >= 0.72) {
            접지가중 = THREE.MathUtils.smoothstep(차, 0.72, 0.82);
            앞다리몫 = 1 - THREE.MathUtils.smoothstep(차, 0.8, 0.9);
          } else if (차 <= 0.06) {
            접지가중 = 1 - THREE.MathUtils.smoothstep(차, 0.0, 0.06);
            앞다리몫 = 0;
          }
        }
      }
      const 접지구간 = 접지가중 > 0.001;
      if (import.meta.env.DEV) 접지상태.current = { 다른: 다리.s, 틈: +틈.toFixed(4), 가중: +접지가중.toFixed(2), 앞다리몫: +앞다리몫.toFixed(2), 앞에있음 };
      // 이번 프레임 목표량. 조건 밖이면 0 — 아래 평활이 0 으로 미끄러져 내려간다.
      const 목표 = { l: { 올림: 0, 내림: 0 }, r: { 올림: 0, 내림: 0 } };
      if (접지구간 && 앞에있음 && 틈 > 0) {
        // 틈을 두 다리가 나눠 맡는다. 앞다리만 내리면 다리가 짧아 무릎이 주기 절반 동안
        // 2° 로 잠기고, 디딘 다리만 올리면 밀어내는 다리가 이미 뻗어 있어 무릎이 80° 로
        // 꺾인다(둘 다 실측). 반씩 나누면 앞다리는 엉덩이 회전으로 닿고, 디딘 다리는
        // 조금 더 굽어 몸이 살짝 내려앉는다 — 원본의 양발 지지 자세가 그렇다.
        // 앞다리 몫에는 따로 낮은 상한을 둔다(접지앞상한) — 앞다리가 다 메우면 무릎이
        // 2° 까지 펴져 반듯해진다. 남는 틈은 그대로 둔다(원본도 뒤꿈치 접지 때 1cm 떠 있다).
        const 가중 = 접지가중 * 앞가중 * 틈가중;
        const 상한 = (준비.보정값?.접지내림 ?? 0.03) * 1.45 * 가중;
        const 앞상한 = (준비.보정값?.접지앞상한 ?? 0.015) * 1.45 * 가중 * 앞다리몫;
        // 접근: 앞다리가 상한까지 먼저 맡고 나머지를 디딘 다리가 맡는다. 하중: 앞다리 몫 0.
        목표[다리.s].내림 = Math.min(틈, 앞상한);
        목표[준비.다리[낮은].s].올림 = Math.min(틈 - 목표[다리.s].내림, 상한);
      }
      // 시간 평활(시정수 40ms). 남은 프레임 단위 꺾임(무릎 2~5°)을 눌러 준다.
      // 정지 화면·검증시각에서도 몇 프레임 안에 목표에 붙는다.
      const 평활 = 접지평활.current;
      const 비율 = 1 - Math.exp(-Math.max(0, delta) / 0.04);
      준비.다리.forEach((d) => {
        평활[d.s].올림 += (목표[d.s].올림 - 평활[d.s].올림) * 비율;
        평활[d.s].내림 += (목표[d.s].내림 - 평활[d.s].내림) * 비율;
      });
      {
        const 풀기 = (다리, 세계이동) => {
          const { thigh, calf, foot } = 다리;
          for (let 회 = 0; 회 < 3; 회 += 1) {
            H.setFromMatrixPosition(thigh.matrixWorld);
            K.setFromMatrixPosition(calf.matrixWorld);
            F.setFromMatrixPosition(foot.matrixWorld);
            if (회 === 0) T.copy(F).setY(F.y + 세계이동);
            const L1 = H.distanceTo(K);
            const L2 = K.distanceTo(F);
            const d = THREE.MathUtils.clamp(H.distanceTo(T), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
            // 무릎 안쪽 각: 목표 거리에 맞는 값과 지금 값의 차이만큼 무릎을 돌린다.
            const 목표각 = Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
            u.copy(H).sub(K).normalize();
            v.copy(F).sub(K).normalize();
            const 지금각 = Math.acos(THREE.MathUtils.clamp(u.dot(v), -1, 1));
            n.crossVectors(u, v);
            if (n.lengthSq() < 1e-8) n.copy(옆세계).applyQuaternion(group.quaternion);
            n.normalize();
            const 회전 = (bone, axis, angle) => {
              bone.parent.getWorldQuaternion(pq);
              wq.setFromAxisAngle(axis, angle);
              bone.quaternion.premultiply(pq.clone().invert().multiply(wq).multiply(pq));
              bone.updateMatrixWorld(true);
            };
            // 부호는 시험해 정하되, 거리만 보면 안 된다 — 거의 뻗은 다리는 앞으로 굽히나
            // 뒤로 꺾으나 엉덩이-발 거리가 같아서 새 다리처럼 뒤로 꺾인 채 통과했다
            // (실측: 무릎 6°→81°, 발이 15cm 솟음). 무릎은 반드시 몸 앞(+z)으로 나와야 한다.
            const 무릎앞 = () => {
              K.setFromMatrixPosition(calf.matrixWorld);
              F2.setFromMatrixPosition(foot.matrixWorld);
              // 엉덩이-발 선의 중점에서 무릎으로 가는 벡터의, 모델 앞 방향 성분
              u.copy(K).sub(v.copy(H).add(F2).multiplyScalar(0.5));
              v.set(0, 0, 1).applyQuaternion(group.quaternion);
              return u.dot(v);
            };
            회전(calf, n, 목표각 - 지금각);
            F2.setFromMatrixPosition(foot.matrixWorld);
            if (Math.abs(H.distanceTo(F2) - d) > 1e-3 || 무릎앞() < 0) {
              회전(calf, n, -2 * (목표각 - 지금각));
              F2.setFromMatrixPosition(foot.matrixWorld);
              if (Math.abs(H.distanceTo(F2) - d) > 1e-3 && 무릎앞() < 0) {
                // 어느 쪽으로도 앞무릎이 안 나오면(축이 어긋남) 원래대로 두고 포기한다.
                회전(calf, n, 목표각 - 지금각);
                F2.setFromMatrixPosition(foot.matrixWorld);
              }
            }
            // 엉덩이: 발이 목표를 향하도록 다리 전체를 돌린다.
            u.copy(F2).sub(H).normalize();
            v.copy(T).sub(H).normalize();
            wq.setFromUnitVectors(u, v);
            thigh.parent.getWorldQuaternion(pq);
            thigh.quaternion.premultiply(pq.clone().invert().multiply(wq).multiply(pq));
            thigh.updateMatrixWorld(true);
          }
        };
        준비.다리.forEach((d) => {
          if (평활[d.s].올림 > 1e-5) 풀기(d, 평활[d.s].올림 * avatarScale);
          if (평활[d.s].내림 > 1e-5) 풀기(d, -평활[d.s].내림 * avatarScale);
        });
        준비.targetSkin.skeleton.update();
      }
      // IK 결과를 남겨 두어 다음 프레임에 믹서가 썼는지 판별한다.
      준비.다리.forEach((d) => [d.thigh, d.calf].forEach((bone) => {
        const 칸 = 다리보관.current.get(bone);
        if (칸) 칸.ik = (칸.ik ?? new THREE.Quaternion()).copy(bone.quaternion);
      }));
    }

    // 발바닥 정점 중 가장 낮은 점을 지면에 맞춘다(발끝을 세우는 동작 포함).
    let soleY = Infinity;
    준비.soles.forEach(({ object, indices }) => {
      if (!object.visible) return;
      // 전부 본다. 넷 중 하나만 보면 진짜 최저점을 놓쳐 몇 mm 씩 묻히고 자세 따라 깜빡였다.
      for (let i = 0; i < indices.length; i += 1) {
        object.getVertexPosition(indices[i], 점);
        object.localToWorld(점).applyMatrix4(역행렬);
        soleY = Math.min(soleY, 점.y);
      }
    });
    if (Number.isFinite(soleY)) group.position.y = state.footY - soleY * avatarScale;

    if (import.meta.env.DEV) {
      (window.__CHIBI_DEBUG_BY_GENDER ??= {})[gender] = { motion: next, current: 현재모션.current };
      window.__CHIBI_DEBUG = {
        visible: true,
        motion: next,
        motionCount: 준비.clipCount,
        mappedBones: 준비.mappedBones,
        gender,
        stride: Object.fromEntries([...이동모션].map((n) => [n, 준비.보폭For(n)])),
        contact: 준비.접지시각For(next),
        ik: 접지상태.current,
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
useGLTF.preload(트리포모션파일들);

export default ChibiGameAvatar;
