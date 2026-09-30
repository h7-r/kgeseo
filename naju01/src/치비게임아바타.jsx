// 치비 몸체 시제품 런타임 (1단계: 몸 + 모션 검증).
// V4 몸체를 Sidekick 뼈 이름·축으로 다시 묶은 GLB(chibi-male/female)에
// Sidekick 캐릭터와 같은 Quaternius 43개 모션을 같은 방식으로 리타게팅한다.
// 기존 사이드킥게임아바타.jsx는 건드리지 않고, 비교 검토용으로 따로 둔다.
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone, retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";
import { 미터 } from "./공간도면.js";
import { 기본메시설정, 메시모델파일, 메시신발파일 } from "./메시외형옵션.js";
import { 가슴반두께, 양손주먹중심 } from "./주먹중심.js";
import { 기본툰, 툰적용 } from "./툰재질.js";
import { 기본외곽선, 외곽선적용 } from "./툰외곽선.js";
import { 진단등록 } from "./캐릭터진단.js";
import { 기본보정, 성별보정, 트리포보정, 트리포성별보정, 이동모션, 보정쿼터니언, 클립보정 } from "./모션보정.js";

// 발바닥이 땅에 붙은 채 움직이지 않는 클립. 이 목록에 있을 때만 발바닥 최저점을 캐시한다
// — 「플레이어가 안 움직인다(state.moving)」와는 다른 말이다(아래 발바닥 캐시 주석).
// ※ 새 클립을 넣기 전에 반드시 재라. 실측 3초 진폭: Idle_Loop 0.10mm · Walk_Loop 38mm.
const 제자리모션 = new Set(["Idle_Loop"]);

// 몸체 종류: chibi = V4 몸체 시제품, meshy = Meshy 민머리 기본 모델(텍스처 원본 유지).
const 몸파일 = {
  chibi: { masculine: "/models/chibi-male.glb", feminine: "/models/chibi-female.glb" },
  // meshy 몸체는 착장마다 파일이 달라 여기서 고르지 않는다 — 메시모델파일(설정) 이 만든다.
  //   ※ 예전에는 여기에 /models/meshy-male.glb 가 적혀 있었는데 그 파일은 없다(404 가 될 뻔했다).
  //     지금 코드가 meshy 일 때 이 값을 안 읽어서 드러나지 않았을 뿐이다.
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
function 파츠붙이기(partsGLTF, targetSkin, 오류 = [], 버릴것 = null) {
  const out = [];
  if (!partsGLTF) return out;
  partsGLTF.scene.traverse((object) => {
    if (!object.isSkinnedMesh) return;
    const geometry = object.geometry.clone();
    // 이 지오메트리는 **우리가 만든 것**이다(원본을 복제해 skinIndex 를 다시 매긴다).
    //   몸이 다시 만들어질 때 반납해야 한다 — 안 그러면 갈아입을 때마다 쌓인다.
    버릴것?.지오.push(geometry);
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
    // ★ 재질은 **여기서 복제하지 않는다.**
    //   이 메시는 곧바로 몸(model) 아래로 들어가고, 바로 뒤 `몸준비` 의
    //   model.traverse 가 **모든 메시의 재질을 한 번 더 복제해 덮어쓴다.**
    //   그래서 여기서 만든 복제본은 그 자리에서 주인을 잃고 GPU 에만 남았다
    //   (실측: 갈아입을 때마다 신발 재질 4개가 그렇게 샜다).
    //   원본을 그대로 넘겨도 바로 뒤에서 메시마다 따로 복제되므로 결과는 같다.
    const mesh = new THREE.SkinnedMesh(geometry, object.material);
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

// ── 리타깃·보폭·접지 표본은 **뼈대가 같으면 값이 같다** ────────────────────
// [무엇이 문제였나]
//   옷을 갈아입으면 몸 GLB 가 바뀌어 `몸준비` 가 처음부터 다시 돈다. 그런데 이
//   함수가 하는 일 중 비싼 셋 — 클립 리타깃(`clipFor`), 보폭 재기(`보폭For`),
//   접지 시각 찾기(`접지시각For`) — 은 **뼈대와 동작 파일만 보고** 정해진다.
//   옷은 껍데기(메시)라 뼈가 움직이는 방식과 아무 상관이 없다. 그런데도 갈아입을
//   때마다 클립을 다시 리타깃하고, 걷기 클립을 60~64번씩 되감으며 발 높이를
//   다시 쟀다. 실측: 리타깃 180ms + 표본 훑기 300ms — 멈춤 1초의 절반이었다.
// [어떻게 고쳤나]
//   **뼈대 서명**(뼈 이름 + 쉴 때 자리·회전)과 보정값으로 열쇠를 만들어 결과를
//   모듈에 들고 있는다. 옷만 바뀌면 서명이 같으니 그대로 꺼내 쓴다.
//   서명이 조금이라도 다르면(다른 리그·다른 보정) 새로 계산한다 — 틀린 값을
//   물려받을 길이 없다.
// ★ 리타깃한 클립의 트랙 이름은 **뼈 이름**이다(객체가 아니다). 그래서 같은 이름
//   뼈대라면 다른 몸에도 그대로 붙는다 — three 의 믹서가 이름으로 묶는다.
const 리그캐시 = new Map();
const 리그캐시최대 = 6;
function 리그서명(skin) {
  const 줄 = [];
  skin.skeleton.bones.forEach((b) => {
    줄.push(
      b.name,
      b.position.x.toFixed(3), b.position.y.toFixed(3), b.position.z.toFixed(3),
      b.quaternion.x.toFixed(3), b.quaternion.y.toFixed(3), b.quaternion.z.toFixed(3), b.quaternion.w.toFixed(3),
    );
  });
  return 줄.join(",");
}
function 리그곳간(열쇠) {
  let 곳 = 리그캐시.get(열쇠);
  if (!곳) {
    곳 = { retargeted: new Map(), 접지시각: new Map(), 보폭: new Map() };
    리그캐시.set(열쇠, 곳);
    // 오래된 것부터 버린다 — 성별·보정 조합이 몇 개뿐이라 넉넉하다.
    while (리그캐시.size > 리그캐시최대) 리그캐시.delete(리그캐시.keys().next().value);
  }
  return 곳;
}

function 몸준비(gltf, 모션GLTF, 보정값 = 기본보정, 신발GLTF = null, 트리포GLTFs = null, 트리포값 = 트리포보정, 바깥열쇠 = "") {
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
  // ── 이 준비가 **직접 만든** GPU 자원 ─────────────────────────────
  // [왜 모아 두나]
  //   옷·성별을 바꾸면 몸 GLB 가 통째로 바뀌고 이 함수가 처음부터 다시 돈다.
  //   그때 옛 것을 안 버리면 **갈아입을 때마다** 신발 지오메트리 4개와 재질
  //   여남은 개가 GPU 에 그대로 쌓인다(실측: 한 번 오갈 때마다 지오 +4 · 텍스 +2,
  //   같은 옷으로 되돌아와도 줄지 않았다). 오래 만질수록 무거워지던 이유다.
  // ★ **GLB 가 준 지오메트리·텍스처는 여기 담지 않는다.**
  //   그건 useGLTF 캐시가 들고 있는 공용 자원이라, 버리면 같은 옷으로 돌아올 때
  //   수십 MB 를 다시 올려야 한다(모프 텍스처 올리는 데만 627ms — 실측).
  //   **우리가 복제해 만든 것만** 반납한다.
  const 버릴것 = { 지오: [], 재질: [] };
  const 신발파츠 = 파츠붙이기(신발GLTF, targetSkin, 파츠오류, 버릴것);
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
    object.material = object.material.clone();
    버릴것.재질.push(object.material);
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
  // 옷만 바뀐 것이라면 앞서 계산해 둔 리타깃·보폭·접지를 그대로 쓴다(위 「뼈대가 같으면」).
  const 곳간 = 리그곳간(`${바깥열쇠}|${리그서명(retargetSkin)}`);
  const retargeted = 곳간.retargeted;
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
  const 접지시각 = 곳간.접지시각;
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
  const 보폭 = 곳간.보폭;
  const 보폭For = (name) => {
    if (보폭.has(name)) return 보폭.get(name);
    // (값은 리그곳간 이 들고 있다 — 옷을 갈아입어도 다시 재지 않는다)
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
  // ── 팔 2본 IK 용 — 좌우 한 벌씩 묶어 둔다(접지 IK 의 `다리` 와 같은 꼴) ──
  //   ※ 아래팔은 반드시 **이름으로** 찾는다. children 중 첫 뼈를 집으면 리그에
  //     따라 쇄골·트위스트 뼈가 먼저 잡혀 엉뚱한 관절을 굽힌다(실제로 겪었다).
  //   ※ 예전에는 useFrame 안에서 `getBoneByName("lowerarm_r")` 를 매 프레임 불렀다.
  //     이름이 오른쪽으로 **박혀 있어서** 왼팔을 얹을 자리가 아예 없었다 —
  //     두 손으로 드는 물건(상자·서류)이 막혀 있던 게 여기서 풀린다.
  // 손목 → 주먹 한가운데. 리그에서 재 오되 **모델당 한 번만** 돈다
  //   (정점 5만 개 × 손 둘 = 40만 회. 여기서 그냥 돌렸더니 Leva 를 만질 때마다
  //    `몸준비` 가 다시 돌면서 같이 돌아 화면이 느려졌다 — 주먹중심.js 주석 참고)
  const 손바닥 = 양손주먹중심(targetSkin);

  // ── 물건을 매다는 **소켓 뼈** ──────────────────────────────────
  // [이게 있는 줄 몰랐다]
  //   이 리그(Synty Sidekick 88조인트)에는 `prop_l` · `prop_r` 이라는
  //   **물건 전용 뼈**가 원래 들어 있다. 스킨 웨이트가 0 이라 살에는 영향이
  //   없고, 모션 소스(Quaternius)에는 이 뼈가 없어서 `retargetClip` 이
  //   `if (boneTo)` 로 건너뛴다 — 즉 **어떤 클립에도 덮이지 않고** bind 오프셋을
  //   유지하며 손을 따라다닌다. 소켓의 정의 그대로다.
  //   (Synty 공식 표기: "Bow Combat animations make use of a prop bone,
  //    an extra bone added to the hand.")
  // [무엇이 해결되나]
  //   ① 손목 → 주먹 중심 보정을 **눈대중으로 만들 필요가 없다**(소켓이 이미 거기다)
  //   ② `hand_r` 의 로컬 +Y 가 세계 **아래**를 봐서 물건이 뒤집히던 문제 —
  //      그래서 물건마다 128° 를 얹어야 했던 그 리그 상수가 사라진다.
  //      prop_r 기준에서는 `[-90, 0, 0]` 하나면 +Y-up 모델이 똑바로 선다.
  //   실측: hand_r 기준 prop_r 로컬 [-0.0522, 0.0180, 0.0005](0.184 유닛)
  const 쥠소켓 = {
    hand_l: targetSkin.skeleton.getBoneByName("prop_l") ?? null,
    hand_r: targetSkin.skeleton.getBoneByName("prop_r") ?? null,
  };

  // ── 주먹 쥐기 모프가 **실제로 붙어 있는 메시**를 미리 모아 둔다 ──────
  //   매 프레임 사전(morphTargetDictionary)을 뒤지지 않으려고 여기서 한 번만 찾는다.
  //   ★ 이름을 코드에 못 박지 않고 **있으면 쓰고 없으면 조용히 건너뛴다.**
  //     실제로 몸체마다 다르다(런타임에 세어 확인했다):
  //       meshy-*.glb → Body·Hair0·Hair1 **그리고 외곽선 메시**까지 넷, 모프 10개
  //       shoes-*.glb · chibi-*.glb → 모프 0개
  //     빈 배열이면 아래 useFrame 이 아무 일도 안 한다 — 몸체를 바꿔도 안 터진다.
  //   ★ `parts` 가 아니라 **모델 전체를 훑는다.** 외곽선은 나중에 따로 붙는 메시라
  //     parts 에 없는데, 거기에 같은 값을 안 넣으면 **외곽선만 편 손 모양으로 남아**
  //     손 둘레에 유령선이 생긴다.
  //   ★ 좌우 공용 모프다. 하나가 양손을 같이 감는다(도구/build_chibi_body.py 가
  //     "l"·"r" 을 한 델타에 함께 굽는다). 한 손만 펴 두려면 GLB 를 다시 구워야 한다.
  const 주먹모프 = [];
  model.traverse((o) => {
    const i = o.morphTargetDictionary?.fistHands;
    if (i !== undefined && o.morphTargetInfluences) 주먹모프.push({ mesh: o, i });
  });

  const 팔 = ["l", "r"]
    .map((s) => {
      const upper = targetSkin.skeleton.getBoneByName(`upperarm_${s}`);
      const lower = targetSkin.skeleton.getBoneByName(`lowerarm_${s}`);
      const hand = targetSkin.skeleton.getBoneByName(`hand_${s}`);
      return upper && lower && hand ? { s, upper, lower, hand } : null;
    })
    .filter(Boolean);
  return {
    // 몸 골격에 없는 뼈를 써서 못 붙인 파츠(신발 등). 비어 있어야 정상이다.
    파츠오류,
    팔뿌리,
    팔,
    주먹모프,
    손바닥,
    쥠소켓,
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
    // 이 준비가 밀려났을 때 **자기가 만든 것만** 반납한다(위 「버릴것」 주석).
    //   두 번 불러도 안전하다 — 목록을 비우고 끝낸다.
    버리기: () => {
      버릴것.지오.forEach((g) => g.dispose());
      버릴것.재질.forEach((m) => m.dispose());
      버릴것.지오.length = 0;
      버릴것.재질.length = 0;
      // ── 뼈대가 들고 있는 뼈 텍스처도 반납한다 ────────────────────
      //   three 는 스키닝할 때 뼈 행렬을 텍스처 한 장에 담는다. 뼈대마다 한 장이고
      //   아무도 안 버렸다 — 갈아입을 때마다 텍스처가 2장씩 늘던 것이 이것이다
      //   (실측: 여섯 번 오가니 12장). 뼈대는 이 몸 전용이라 같이 버리면 된다.
      const 뼈대들 = new Set();
      [model, retargetModel].forEach((뿌리) =>
        뿌리?.traverse((o) => {
          if (o.isSkinnedMesh && o.skeleton) 뼈대들.add(o.skeleton);
        }),
      );
      뼈대들.forEach((s) => s.dispose?.());
    },
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

// 일인칭몸 = 1인칭에서 **내 몸만** 보여 주는 모드.
//   아래를 내려다보면 배·다리가 보여야 "내가 거기 서 있다"가 된다.
//
// ── 머리를 「접는」 것만으로는 부족했다 ─────────────────────────
// [무엇이 보였나]
//   예전에는 머리뼈 배율만 1e-4 로 접었다. 그런데 목·어깨·가슴은 그대로
//   남아서, 물건을 들거나 [E] 를 누를 때 **머리가 잘려 나간 몸통**이 화면에
//   비쳤다. 1인칭에서 제 목 단면을 보는 것만큼 몰입을 깨는 게 없다.
// [어떻게 고치나 — 1인칭 게임이 하는 것]
//   상용 1인칭은 몸을 **카메라 앞쪽만** 그린다. 손·팔뚝은 카메라 앞에 있어
//   남고, 머리·목·가슴은 카메라 뒤에 있어 사라진다. 아래를 내려다보면
//   앞쪽이 배·다리가 되므로 그때는 몸이 보인다 — 원하는 그림 그대로다.
//   three.js 에 그 기능이 그대로 있다(재질의 clippingPlanes · 세계 좌표).
// [왜 가로선(높이)으로 안 자르나]
//   눈높이 아래로 자르면 **위로 뻗은 손이 같이 잘린다.** 높은 선반을 짚을 때
//   손이 사라진다. 시선축 기준으로 자르면 손은 늘 앞쪽이라 안 잘린다.
// [머리 접기는 남겨 둔다]
//   위를 올려다보면 머리가 카메라 **앞**이 되어 이 평면에 안 걸린다.
//   그때를 위해 접기도 같이 둔다(둘 다 싸다).
// ※ 그림자는 안 자른다(clipShadows 기본 false) — 몸은 실제로 거기 있으니
//   바닥 그림자는 온전해야 맞다.
const 앞자르기 = 0.21; // m. 카메라에서 이만큼 앞부터 그린다(머리 반지름보다 크게)
const _잘림면 = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);
const 잘림면목록 = [_잘림면];
const _잘림앞 = new THREE.Vector3();
const _잘림점 = new THREE.Vector3();
// 팔 IK 가 쓰는 그릇들 — 매 프레임 새로 만들지 않는다
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _W = new THREE.Vector3();
const _W2 = new THREE.Vector3();
const _T = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _pq = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
// 뼈 회전 보정용 임시 그릇.
//   ★ 예전에는 `_pq.clone()` 으로 매번 새로 만들었다. 팔 IK 2회×2팔 +
//     접지 IK 최대 3회×3시도×2다리 = **프레임당 10~20개**가 쓰레기가 된다.
//     걷는 내내 그러면 청소(GC)가 도는 프레임이 그대로 끊김으로 보인다.
//     식이 `pq⁻¹ · wq · pq` 라 결과를 받을 그릇 하나만 있으면 된다.
const _보정q = new THREE.Quaternion();
const _축 = new THREE.Vector3();
const _폴 = new THREE.Vector3();
const _고정 = new THREE.Vector3();
const _E목표 = new THREE.Vector3();
const _W목표 = new THREE.Vector3();
const _손q = new THREE.Quaternion();
const _부모q = new THREE.Quaternion();
const _아래팔q = new THREE.Quaternion();
const _쉴때q = new THREE.Quaternion();
const _목표q = new THREE.Quaternion();
const _몸v = new THREE.Vector3();
const _몸s = new THREE.Vector3();

// 팔꿈치가 어느 쪽으로 빠지나(폴 벡터) 기본값 — **꺼진 채**로 들어간다.
//   게임이 state.팔폴 로 내려 주면 그 값이 이긴다. naju01 단독 구동에서는 이게 산다.
//   숫자는 '방향 성분'이지 거리가 아니다 — 아래 팔풀기폴 주석 참고.
// 주먹을 감았다 펴는 속도(1/초). 0.1초 남짓에 다 감긴다 — 물건이 손에 붙는
//   순간에는 이미 쥐어져 있어야 해서 집는 동작보다 조금 빠르게 둔다.
const 쥠감는속도 = 12;
// 손목이 **클립 자세에서** 벗어날 수 있는 최대 각(도).
//   ★ 아래팔 기준이 아니다 — 이 리그의 hand bind 가 이미 아래팔에서 90° 꺾여
//     있어서, 아래팔 기준으로 자르면 평상시에도 손이 끌려간다(겪었다).
//   사람 손목 실용 가동범위는 굽힘·젖힘 각 40°, 요척 합 40° 다
//   (Ryu et al. 1991, 일상 과제 70% 기준). 해부학적 최대는 굽힘 80·젖힘 70.
//   축을 나누지 않고 하나로 뭉뚱그리므로 실용값 쪽에 둔다.
const 손목한계 = 40;
const 기본팔폴 = { 켬: false, 뒤: 1, 아래: 1, 바깥: 0.35, 세기: 1 };
function ChibiGameAvatar({ 보이기, 일인칭몸 = false, 플레이어참조, 설정 = 기본치비설정, 크기 = 미터, 검증시각 = null, 몸체 = "chibi", 툰 = 기본툰, 외곽선 = 기본외곽선, 보정 = 기본보정, 프레임순서 = -20 }) {
  const root = useRef();
  // 1인칭 잘림면은 **세계 좌표**라 카메라 자리·방향이 필요하다. 그리고 three 는
  //   `localClippingEnabled` 를 켜야 재질의 clippingPlanes 를 본다.
  const { gl, camera: 카메라 } = useThree();
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
  // 옷이 바뀌어도 값이 같은 것들(리타깃·보폭·접지)을 찾아 쓸 열쇠.
  //   **몸 GLB 경로는 일부러 안 넣는다** — 그게 이 캐시의 요점이다(위 「뼈대가 같으면」).
  const 리그열쇠 = useMemo(
    () => `${몸체}|${gender}|${트리포씀 ? "t" : "s"}|${JSON.stringify(보정값)}|${JSON.stringify(트리포값)}`,
    [몸체, gender, 트리포씀, 보정값, 트리포값],
  );
  const 준비 = useMemo(
    () => 몸준비(!meshy && gender === "feminine" ? 여GLTF : 남GLTF, 모션GLTF, 보정값, meshy ? 신발GLTF : null, 트리포씀 ? 트리포GLTF : null, 트리포값, 리그열쇠),
    [meshy, gender, 남GLTF, 여GLTF, 모션GLTF, 보정값, 신발GLTF, 트리포GLTF, 트리포씀, 트리포값, 리그열쇠],
  );

  // ── 밀려난 몸은 제 GPU 자원을 반납한다 ────────────────────────────
  // [왜 필요한가] 옷을 갈아입으면 위 useMemo 가 새 몸을 만든다. 옛 몸이 만든
  //   신발 지오메트리·복제 재질은 아무도 안 버려서 **갈아입을 때마다 쌓였다**
  //   (실측: 한 번 오갈 때마다 지오 +4 · 텍스 +2, 여섯 번 오가니 24개가 남았다).
  //   오래 만질수록 화면이 무거워지던 원인이다.
  // [왜 정리 함수(return () => …)가 아닌가]
  //   StrictMode 는 효과를 「실행 → 정리 → 다시 실행」 으로 두 번 돌린다. 정리
  //   함수로 버리면 그 사이에 **지금 쓰고 있는 몸**을 버리게 되어 화면이 빈다.
  //   그래서 '바로 앞의 것'을 손에 들고 있다가, 새것이 오면 그때 앞것만 버린다.
  //   마지막 하나는 안 버리지만, 그때는 캔버스가 통째로 사라지는 순간이다.
  // ── 반납은 **두 프레임 미룬다** ──────────────────────────────────
  // [무엇이 문제였나]
  //   옷을 갈아입을 때 멈추는 1초 중 **0.66초가 셰이더 링크**였다(실측:
  //   getProgramInfoLog 378ms + getProgram 284ms). 새 재질을 만들어서가 아니라,
  //   **옛 재질을 먼저 버려서**다. three 는 같은 셰이더를 쓰는 재질끼리 프로그램을
  //   돌려쓰고 쓰는 수를 센다. 리액트는 「옛 효과 정리 → 새 효과 실행」 순서라,
  //   옛 재질을 그 자리에서 버리면 쓰는 수가 0 이 되어 **프로그램이 삭제되고**,
  //   곧바로 만들어진 새 재질이 똑같은 셰이더를 **처음부터 다시 링크**했다.
  //   링크는 드라이버가 끝낼 때까지 화면이 멈춘다.
  // [어떻게 고쳤나]
  //   옛것을 붙잡고 있다가 새 재질이 **한 번 그려진 뒤에** 버린다. 그 사이
  //   쓰는 수가 0 으로 안 떨어지므로 새 재질이 옛 프로그램을 그대로 물려받는다.
  //   두 프레임을 기다리는 이유 — 한 프레임은 R3F 가 아직 안 그렸을 수 있다.
  // ★ 미룬 사이의 옛 몸은 이미 화면 밖이다(새 몸이 자리를 가져갔다). 그래서
  //   늦게 버려도 보이는 것은 아무것도 달라지지 않는다.
  const 미룬반납 = useRef([]);
  const 미루기 = useCallback((일) => {
    미룬반납.current.push(일);
    if (미룬반납.current.length > 1) return; // 이미 예약돼 있다
    const 흘리기 = () => {
      const 목록 = 미룬반납.current;
      미룬반납.current = [];
      목록.forEach((f) => {
        try {
          f();
        } catch {
          /* 반납이 실패해도 화면은 그대로 돈다 */
        }
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(흘리기));
  }, []);

  // ── 밀려난 몸은 제 GPU 자원을 반납한다 ────────────────────────────
  // [왜 필요한가] 옷을 갈아입으면 위 useMemo 가 새 몸을 만든다. 옛 몸이 만든
  //   신발 지오메트리·복제 재질은 아무도 안 버려서 **갈아입을 때마다 쌓였다**
  //   (실측: 한 번 오갈 때마다 지오 +4 · 텍스 +2, 여섯 번 오가니 24개가 남았다).
  //   오래 만질수록 화면이 무거워지던 원인이다.
  // [왜 정리 함수(return () => …)가 아닌가]
  //   StrictMode 는 효과를 「실행 → 정리 → 다시 실행」 으로 두 번 돌린다. 정리
  //   함수로 버리면 그 사이에 **지금 쓰고 있는 몸**을 버리게 되어 화면이 빈다.
  //   그래서 '바로 앞의 것'을 손에 들고 있다가, 새것이 오면 그때 앞것만 버린다.
  //   마지막 하나는 안 버리지만, 그때는 캔버스가 통째로 사라지는 순간이다.
  const 앞준비 = useRef(null);
  useEffect(() => {
    const 앞 = 앞준비.current;
    앞준비.current = 준비;
    if (앞 && 앞 !== 준비) 미루기(() => 앞.버리기?.());
  }, [준비, 미루기]);

  // ── 1인칭 잘림면을 **화면에 실제로 그려지는 재질**에 붙인다 ───────────
  // [두 번 헛짚었다 — 기록해 둔다]
  //   ① 재질 복제 자리(`object.material.clone()`)에 붙였다 → 0개 붙음.
  //   ② `준비.model` 을 훑었다 → 역시 0개.
   //  이 아바타는 GLB 를 그대로 쓰지 않고 **조각 메시로 다시 그린다**
  //   (외곽선을 붙이려면 `<primitive>` 가 아니라 `<mesh>` 여야 한다).
  //   그래서 화면의 재질은 JSX 에서 새로 만들어지고, 위 둘에는 없다.
  //   결국 **그려진 그룹(root)** 을 훑어야 한다.
  // [왜 프레임마다 안 훑나]
  //   clippingPlanes 의 **개수**가 바뀌면 셰이더가 다시 컴파일된다. 한 번
  //   붙여 두고 평면의 자리만 옮기면(아래 useFrame) 컴파일이 없다.
  //   그래서 첫 프레임에 한 번만 붙이고 깃발을 세운다. 몸이 다시 만들어지면
  //   (설정·성별·몸체가 바뀌면) 깃발을 내려 다시 붙인다.
  const 잘림붙임 = useRef(false);
  useEffect(() => {
    gl.localClippingEnabled = true; // 안 켜면 재질의 clippingPlanes 를 무시한다
    잘림붙임.current = false;
  }, [gl, 준비, 설정, 몸체]);

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
  // ★ **그리기 전에** 붙여야 한다(useEffect 가 아니라 useLayoutEffect).
  //   [무엇이 문제였나] 옷을 갈아입으면 새 몸이 렌더에서 만들어지는데, 툰 재질과
  //   외곽선은 useEffect 라 **화면을 한 번 그린 뒤에** 붙었다. R3F 는 제 rAF 에서
  //   그리므로 그 사이에 한 프레임이 나가고, 그 프레임은 **외곽선도 툰도 없는
  //   반쪽 몸**이다. 게다가 바로 다음 프레임이 새 모델을 GPU 에 올리느라 1.9초
  //   멈춰서, 그 반쪽 그림이 2초 가까이 화면에 굳어 있었다(실측 — 사용자가 말한
  //   "누를 때 깨진다"가 이것이다).
  //   레이아웃 효과는 커밋 직후·그리기 전에 돌아서 그 한 프레임이 아예 없어진다.
  //   드는 시간은 같다(재질 만들기는 몇 ms 다) — 순서만 앞당긴다.
  useLayoutEffect(() => {
    if (!툰.켬) return undefined;
    const 핸들 = 툰적용(준비.model, 갈래정하기, 툰);
    툰핸들.current = 핸들;
    return () => {
      툰핸들.current = null;
      // 곧바로 버리면 셰이더를 다시 링크한다 — 위 「반납은 두 프레임 미룬다」.
      미루기(() => 핸들.되돌리기());
    };
    // 단계·경계가 바뀌면 그라디언트 맵이 달라져 재질을 다시 만들어야 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [준비, 갈래정하기, 툰.켬, 툰.단계, 툰.경계, 미루기]);
  useEffect(() => {
    툰핸들.current?.갱신(툰);
  }, [툰]);
  // 외곽선도 같은 이유로 **그리기 전에** 붙인다(위 「그리기 전에」 주석).
  useLayoutEffect(() => {
    if (!외곽선.켬) return undefined;
    const 핸들 = 외곽선적용(준비.model, 외곽선, 갈래정하기);
    외곽선핸들.current = 핸들;
    return () => {
      외곽선핸들.current = null;
      // 껍데기는 이미 화면 밖(옛 몸)에 있다 — 늦게 걷어도 보이는 것은 같다.
      미루기(() => 핸들.제거());
    };
    // 두께·색은 갱신으로만 바꾼다. 켬/끔이 아닌 값 변화로 껍데기를 다시 만들지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [준비, 갈래정하기, 외곽선.켬, 미루기]);
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
      // 평소 손 모양(옷장 슬라이더). 물건을 들 때 감는 건 **useFrame 이 이 값
      //   위에 얹는다** — 두 곳이 같은 모프를 쓰지만 useFrame 이 언제나 나중이라
      //   다투지 않는다. 여기를 지우면 옷장 미리보기에서 손이 안 바뀐다.
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
  // 발바닥 최저점 캐시 — 정점 7731 개를 매 프레임 훑는 값이 아바타당 3.0ms 다(실측).
  const 바닥높이캐시 = useRef(null);
  const 발지문 = useRef("");
  const 전환끝 = useRef(0);
  // 주먹 쥠의 지난 프레임 값. 모프는 믹서의 블렌드를 못 탄다(클립은 회전 트랙만
  //   굽는다). 그래서 여기서 시간으로 직접 푼다 — 안 그러면 물건을 드는 프레임에
  //   손 모양이 **툭** 바뀐다.
  const 쥠양 = useRef(0);

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

  // ★ priority 는 **순서**다(값이 작을수록 먼저). 기본 -20 —
  //   손 목표를 정하는 쪽(-30)보다 늦고, 든 물건을 손뼈에 붙이는 쪽(-10)보다 빠르다.
  //   이 순서가 뒤집히면 물건이 **직전 프레임의 손**을 따라가 걸을 때 헤엄친다.
  //   음수라서 R3F 의 자동 렌더는 그대로 돈다(`priority > 0` 일 때만 꺼진다).
  //   본편은 src/공용.jsx 의 `프레임순서.아바타` 를 넘겨 준다 — naju01 단독으로도
  //   돌아야 해서 여기선 기본값만 두고 import 는 걸지 않는다.
  // [lint] react-hooks/immutability 를 이 블록에서만 끈다 — 이유:
  //   `플레이어참조.current` 는 **일부러 양방향으로 쓰는 상자**다.
  //   공용.jsx 의 use이동 이 position·facing·moving 을 적고, 아바타가 그걸 읽어
  //   몸을 놓은 뒤 **손뼈·어깨 자리·팔 길이**를 되적어 게임에 알려 준다.
  //   (본편이 naju01 을 import 하지 나오는 길은 없다 — 고리가 생긴다. 그래서
  //    이 ref 가 두 패키지를 잇는 유일한 통로다.)
  //   react-compiler 규칙은 "렌더 뒤에 prop 을 바꾸지 마라"고 하지만, 이건
  //   렌더 결과가 아니라 **프레임마다 갱신되는 런타임 상태**라 state 로 올리면
  //   매 프레임 리렌더가 난다. 규칙이 잡아내려는 버그와는 다른 종류다.
  // eslint-disable-next-line react-hooks/immutability
  useFrame(({ clock }, delta) => {
    const group = root.current;
    const state = 플레이어참조?.current;
    if (!group || !state) return;
    // ── 1인칭 손 — 게임이 프레임마다 내려 주는 「몸만 그려라」 ──────────
    //   [무엇] `state.일인칭손` 이 참이면 `보이기` 가 꺼져 있어도(1인칭) 몸을
    //     그리되 머리는 접는다(아래 headBone). 본편의 손붙이기(−30)가 물건을
    //     들고 있거나 [E] 로 뻗는 동안만 켠다.
    //   [왜 prop 이 아니라 state 인가] 켜고 끄는 조건이 프레임마다 바뀌는
    //     런타임 값이라 prop 으로 올리면 집을 때마다 리렌더가 난다. `일인칭몸`
    //     prop(Leva 「1인칭 몸」)은 그대로 살아 있다 — 둘 중 하나면 몸을 그린다.
    //   naju01 단독 구동에서는 이 값이 없어서(undefined) 예전과 똑같이 돈다.
    // 잘림면 붙이기 — 위 「잘림붙임」 참고. 마운트 뒤 한 프레임만 돈다.
    if (!잘림붙임.current) {
      잘림붙임.current = true;
      group.traverse((o) => {
        const m = o.material;
        if (!m) return;
        if (Array.isArray(m)) m.forEach((한) => (한.clippingPlanes = 잘림면목록));
        else m.clippingPlanes = 잘림면목록;
      });
    }
    const 몸만 = 일인칭몸 || (!보이기 && !!state.일인칭손);
    const 그릴까 = 보이기 || 몸만;
    group.visible = 그릴까;
    // ★ 오른손 뼈를 상태에 얹어 둔다.
    //   본편(kgeseo)에서 들고 있는 물건이 이 뼈를 따라가야 **캐릭터가 쥔 것**으로
    //   보인다. 안 그러면 동전이 카메라 앞 허공에 혼자 떠 있다.
    //   여기서 내보내기만 하고, 쓰는 쪽은 본편이 정한다(이 파일은 본편을 모른다).
    // eslint-disable-next-line react-hooks/immutability
    state.오른손 = 준비.손뼈?.[1] ?? 준비.손뼈?.[0] ?? null;
    state.왼손 = 준비.손뼈?.[0] ?? null;
    // 손목 → 주먹 한가운데(그 뼈의 **로컬** 좌표). 쓰는 쪽에서
    //   `뼈.localToWorld(v.copy(이것))` 하면 세계 자리가 나온다. 위 「손바닥」 주석 참고.
    state.오른손바닥 = 준비.손바닥?.hand_r ?? null;
    state.왼손바닥 = 준비.손바닥?.hand_l ?? null;
    // 물건 전용 소켓 뼈(있으면). 위 「쥠소켓」 주석 참고.
    state.오른쥠소켓 = 준비.쥠소켓?.hand_r ?? null;
    state.왼쥠소켓 = 준비.쥠소켓?.hand_l ?? null;
    if (!그릴까) return;
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
    const 이전모션 = 현재모션.current;
    재생(next);
    // 크로스페이드(0.16초) 중에는 두 클립이 섞여 발이 옮겨 간다 — 그동안은 캐시를 쓰지 않는다.
    if (현재모션.current !== 이전모션) 전환끝.current = now + 0.2;
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

    // ★ 1인칭이면 머리를 없앤다 — 카메라가 머리 **안**에 있어서 그대로 두면
    //   화면이 통째로 살덩이로 막힌다. 0 을 주면 행렬이 뒤집혀 경고가 나므로
    //   아주 작은 값으로 접는다.
    //   `몸만`(1인칭 손 포함)일 때 접는다 — 3인칭(보이기)에서는 그대로다.
    준비.headBone?.scale.setScalar(몸만 ? 1e-4 : (설정.headScale ?? 1));
    // ── 1인칭: 카메라 앞쪽만 남긴다 (위 「잘림면」) ────────────────
    //   시선축에 수직인 평면을 카메라 앞 `앞자르기` 에 세우고 그 **뒤를 버린다.**
    //   머리·목·가슴은 뒤라 사라지고, 손·팔뚝은 앞이라 남는다.
    if (몸만) {
      카메라.getWorldDirection(_잘림앞);
      _잘림점.copy(카메라.position).addScaledVector(_잘림앞, 앞자르기 * 크기);
      _잘림면.normal.copy(_잘림앞);
      // 평면식 n·p + c = 0. c = −n·q 면 q 뒤(n·p + c < 0)가 잘린다.
      _잘림면.constant = -_잘림앞.dot(_잘림점);
    } else {
      // 3인칭·평소 — 아무것도 안 자른다(상수를 크게 두면 늘 앞쪽이다).
      _잘림면.constant = 1e6;
    }
    // 팔·다리 길이 — 믹서가 쓴 뒤에 덮어야 한다(클립에 위치·배율 트랙이 있을 수 있다).
    const 팔길이 = 설정.armLength ?? 1;
    const 다리길이 = 설정.legLength ?? 1;
    준비.팔뿌리.forEach((bone) => bone.scale.setScalar(팔길이));
    준비.다리뿌리.forEach((bone) => bone.scale.setScalar(다리길이));
    // 손은 팔 배율을 물려받으므로 되돌린다(손 크기는 모프로 따로 조절한다).
    준비.손뼈.forEach((bone) => bone.scale.setScalar(1 / 팔길이));

    // ── 주먹 쥐기 — 물건을 들면 손가락을 감는다 ──────────────────
    // [왜 useEffect 가 아니라 여기인가]
    //   예전에는 꾸미기 값이 바뀔 때만 도는 useEffect 에서만 이 모프를 썼다.
    //   그건 '옷장에서 고른 평소 손 모양'이라, 물건을 들어도 손은 **펴진 그대로**
    //   였다 — 머그가 손잡이에 걸리지 않고 **손바닥에 얹혀 보이던** 원인이다.
    //   들었다 놓는 건 매 프레임 바뀌는 상태라 여기가 맞는 자리다.
    // [왜 모프인가] 이 리그는 hand_l/r 이 끝이라 **손가락 뼈가 아예 없다.**
    //   굽힐 뼈가 없으니 GLB 에 구워 둔 fistHands 가 유일한 손잡이다.
    // [왜 믹서 뒤인가] 팔·다리 배율과 같은 이유 — 클립이 덮어쓸 수 있는 자리
    //   뒤여야 한다(지금 클립에 모프 트랙은 없지만 생기면 여기가 맞다).
    // [기본값이 왜 안전한가] 게임이 안 보내면 섞기 0 → 예전 useEffect 가 쓰던 값과
    //   **정확히 같은 수**가 나온다. naju01 단독 구동도 화면이 그대로다.
    if (준비.주먹모프.length) {
      const 섞기 = Math.max(0, Math.min(1, state.쥠섞기 ?? 0));
      쥠양.current += (섞기 - 쥠양.current) * (1 - Math.exp(-delta * 쥠감는속도));
      const 평소 = 외형.fistHands ?? 0; // 가만히 있을 때(옷장 값)
      // ★ 쥘 때 값은 **절대값**이다. `평소 + (1-평소)*양` 으로 하면 언제나 평소보다
      //   더 감기기만 해서, **상자를 받치는 펴진 손**을 만들 수가 없다.
      //   절대값이면 쥠세기 0.15 < 평소 0.6 일 때 손이 오히려 펴진다.
      const 쥘때 = Math.max(0, Math.min(1, state.쥠세기 ?? 평소));
      const 주먹 = 평소 + (쥘때 - 평소) * 쥠양.current;
      준비.주먹모프.forEach(({ mesh, i }) => {
        mesh.morphTargetInfluences[i] = 주먹;
      });
    }
    // ── 팔 뻗기 — [E] 로 무언가를 만질 때 오른팔이 잠깐 나간다 ──────
    //   믹서가 클립을 쓴 **뒤에** 덮어야 한다(안 그러면 걷기 클립이 도로 덮는다).
    //   양이 0 이면 아무것도 안 한다 — 평소 동작은 조금도 안 바뀐다.
    //   각도는 게임 쪽 Leva 「팔 뻗기」가 정해서 상태로 내려 준다(리그마다 축이
    //   달라 코드에 못 박으면 팔이 엉뚱한 데로 꺾인다).

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

    // ★ 팔 IK 는 **몸 변환을 맞춘 뒤에** 푼다.
    //   전에는 위(팔 길이 배율 근처)에서 풀었는데, 거기는 group.position /
    //   rotation 이 **이번 프레임 값으로 아직 안 바뀐** 자리다. 그래서 IK 는
    //   지난 프레임 몸 자리를 기준으로 푸는데 목표는 이번 프레임 값이라,
    //   걸을 때마다 한 프레임치씩 어긋났다 — 손이 물건을 놓친 듯 보이던 원인.
    //   접지 IK 도 같은 이유로 여기 아래에 있다.
    // ── 팔 2본 IK — 손을 **정해진 자리로** 보낸다 ────────────────
    // [왜 각도를 찍지 않고 IK 인가]
    //   위팔을 오일러 각으로 돌리는 방식은 리그가 바뀌면 그대로 깨진다.
    //   실제로 X 축 −75° 를 넣었더니 이 리그에서는 팔이 **등 뒤로** 뻗었다.
    //   상용 엔진이 전부 2본 IK 를 쓰는 이유가 이것이다 — 각이 아니라
    //   **손이 갈 자리**를 주면, 팔 길이가 달라도 리그가 달라도 그 자리로 간다.
    //   (Unity Animation Rigging 의 Two Bone IK · UE 의 Two Bone IK 와 같은 것)
    // [왜 새로 쓰나]
    //   이 파일 아래에 이미 같은 코사인 법칙 2본 IK 가 있다(접지 IK).
    //   그건 발 높이에 맞춰 오래 다듬은 코드라 손대지 않고, 팔은 따로 둔다.
    // [팔꿈치 방향]
    //   무릎이 반드시 몸 **앞**으로 나와야 하듯, 팔꿈치는 몸 **뒤·아래**로
    //   빠져야 한다. 거리만 맞추면 팔이 새 날개처럼 위로 꺾인 채 통과한다.
    const 팔요청 = {
      r: { 힘: Math.max(0, Math.min(1, state.손IK ?? 0)), 점: state.손목표 },
      l: { 힘: Math.max(0, Math.min(1, state.왼손IK ?? 0)), 점: state.왼손목표 },
    };
    // 폴 값은 게임이 상태로 내려 준다 — 화면을 봐야 맞출 수 있는 값이라 코드에
    //   못 박지 않는다. 안 내려오면 기본값(꺼짐)이라 예전 방식 그대로 돈다.
    const 폴 = state.팔폴 ?? 기본팔폴;
    // 콘솔 확인용 — IK 가 **정말 도는지**, 무엇에 막혔는지 숫자로 본다.
    //   추측으로 값을 고치다 세 번 망가뜨렸다. 이제는 보고 고친다.
    const 계 = (typeof window !== "undefined"
      ? (window.__팔IK = window.__팔IK ?? {})
      : {});
    계.힘 = 팔요청.r.힘;
    계.왼힘 = 팔요청.l.힘;
    계.목표있나 = !!팔요청.r.점;
    계.왼목표있나 = !!팔요청.l.점;
    계.팔수 = 준비.팔.length;
    // 콘솔 확인용 — 든 물건을 몸에서 얼마나 띄울지의 근거 값.
    //   물건을 안 들고 있어도 보여야 해서 여기(IK 분기 밖)에 둔다.
    계.몸통반두께 = state.몸통반두께 ?? null;
    계.손회전세기 = state.손회전세기 ?? null;
    계.손회전있나 = !!state.손회전;
    계.소켓 = !!state.오른쥠소켓;
    계.방식 = 폴.켬 ? "폴벡터" : "옛(부호시험)";

    // 몸 변환이 방금 바뀌었다 — 뼈 세계 행렬을 여기서 한 번만 굽는다.
    group.updateMatrixWorld(true);

    // 어깨 자리·팔 길이는 **IK 를 걸든 안 걸든** 게임에 알려 준다.
    //   예전에는 IK 안에서만 적었다. 그러면 아직 아무것도 안 든 프레임에는 값이
    //   없어서 게임이 어림값(눈높이 −0.7)으로 첫 목표를 잡고, 그 한 프레임만
    //   팔이 엉뚱한 데로 튀었다. 뼈 사이 거리는 자세와 무관하니 언제 재도 같다.
    //   품에 안는 자리(가슴 앞)가 **두 어깨의 한가운데**라서 왼어깨도 함께 낸다.
    준비.팔.forEach(({ s, upper, lower, hand }) => {
      _S.setFromMatrixPosition(upper.matrixWorld);
      _E.setFromMatrixPosition(lower.matrixWorld);
      _W.setFromMatrixPosition(hand.matrixWorld);
      if (s === "r") {
        state.어깨자리 = { x: _S.x, y: _S.y, z: _S.z };
        state.어깨높이 = _S.y;
        state.팔길이 = _S.distanceTo(_E) + _E.distanceTo(_W);
        // 가슴이 얼마나 두꺼운가 — 게임이 든 물건을 몸에서 얼마나 띄울지 정한다.
        //   모델 좌표로 재서 세계 배율을 곱한다(캐시라 모델당 한 번만 돈다).
        //   어깨 뼈의 **모델 로컬** y·z 가 기준이라, 그 자리를 같이 넘긴다.
        if (state.몸통반두께 === undefined) {
          const 살 = 준비.targetSkin;
          const 어깨뼈r = 준비.팔.find((a) => a.s === "r")?.upper;
          if (살 && 어깨뼈r) {
            _몸v.setFromMatrixPosition(어깨뼈r.matrixWorld);
            준비.model.worldToLocal(_몸v);
            const 두께 = 가슴반두께(살, _몸v.y, _몸v.z);
            state.몸통반두께 = 두께 == null ? null : 두께 * (준비.model.getWorldScale(_몸s).x || 1);
          } else state.몸통반두께 = null;
        }
      } else {
        state.왼어깨자리 = { x: _S.x, y: _S.y, z: _S.z };
      }
    });

    // 뼈를 **관절 기준으로** 돌려 `지금` 점이 `목표` 점을 향하게 한다.
    //   세계 회전을 만들어 부모 공간으로 옮겨 곱한다(접지 IK 의 `회전` 과 같은 꼴).
    const 팔돌리기 = (bone, 지금, 목표, 관절) => {
      _u.copy(지금).sub(관절);
      _v.copy(목표).sub(관절);
      if (_u.lengthSq() < 1e-10 || _v.lengthSq() < 1e-10) return;
      _wq.setFromUnitVectors(_u.normalize(), _v.normalize());
      bone.parent.getWorldQuaternion(_pq);
      bone.quaternion.premultiply(_보정q.copy(_pq).invert().multiply(_wq).multiply(_pq));
      bone.updateMatrixWorld(true);
    };

    const 계적기 = (s, L1, L2) => {
      if (s !== "r") return;
      // ★ 콘솔(`__팔IK`) 확인용이다 — **개발 중에만** 적는다.
      //   `[x,y,z].map(v => +v.toFixed(2))` 는 프레임마다 배열 4개 + 문자열
      //   12개를 만든다. 배포본에서는 아무도 안 보는 값이라 그냥 낭비다.
      //   (`준비.팔.find(...)` 도 프레임마다 도는 선형 탐색이었다)
      if (!import.meta.env.DEV) return;
      _W2.setFromMatrixPosition((준비.팔.find((a) => a.s === "r")).hand.matrixWorld);
      계.어깨 = [_S.x, _S.y, _S.z].map((v) => +v.toFixed(2));
      계.목표 = [_T.x, _T.y, _T.z].map((v) => +v.toFixed(2));
      계.손끝 = [_W2.x, _W2.y, _W2.z].map((v) => +v.toFixed(2));
      계.남은거리 = +_W2.distanceTo(_T).toFixed(3);
      계.어깨목표거리 = +_S.distanceTo(_T).toFixed(3);
      if (L1 != null) 계.팔길이 = +(L1 + L2).toFixed(3);
    };

    // ── 새 방식: 팔 평면을 **먼저** 정하고 한 번에 푼다 ──────────────
    // [왜 바꾸나]
    //   2본 IK 의 해는 어깨–손 축을 도는 **원뿔 전체**다. 거리만 맞추면 팔꿈치가
    //   어디로든 갈 수 있다. 예전 코드는 팔꿈치를 굽혀 놓고 "−z 쪽인가"를
    //   **사후에** 보고 부호를 뒤집었다. 그러면 팔꿈치가 그 경계(몸 옆)를 스칠 때
    //   프레임마다 다른 해가 뽑혀 **딸깍거린다.** 무릎은 늘 몸 앞이라 경계를 안
    //   밟지만, 손목표는 옆·뒤로도 가서 경계 위에 앉는다 — 팔에서만 난 이유다.
    //   상용은 전부 폴(힌트) 타깃으로 평면을 **먼저** 정한다. 답이 하나뿐이라
    //   뒤집을 일이 아예 없다(Unity TwoBoneIKConstraint 의 Hint · UE Two Bone IK).
    const 팔풀기폴 = ({ s, upper, lower, hand }, 힘, 목표) => {
      _S.setFromMatrixPosition(upper.matrixWorld);
      _E.setFromMatrixPosition(lower.matrixWorld);
      _W.setFromMatrixPosition(hand.matrixWorld);
      const L1 = _S.distanceTo(_E);
      const L2 = _E.distanceTo(_W);
      if (L1 < 1e-5 || L2 < 1e-5) return;
      // 가중치만큼만 당긴다 — 0 이면 클립 자세 그대로, 1 이면 목표에 딱.
      _T.set(목표.x, 목표.y, 목표.z).sub(_W).multiplyScalar(힘).add(_W);
      _축.copy(_T).sub(_S);
      if (_축.lengthSq() < 1e-10) return;
      const d = THREE.MathUtils.clamp(
        _축.length(),
        Math.abs(L1 - L2) + 1e-4,
        L1 + L2 - 1e-4,
      );
      _축.normalize();
      // ① 지금(클립) 팔꿈치가 가리키는 쪽. 어깨→목표 축에 **수직인 성분만** 남긴다.
      _폴.copy(_E).sub(_S);
      _폴.addScaledVector(_축, -_폴.dot(_축));
      // ② 몸에 고정된 폴 타깃 쪽(뒤·아래·바깥). 이것이 팔 평면을 못 박는다.
      //    ※ 모델 로컬 **+x 가 왼쪽**이다 — 발바닥 정점을 x 부호로 좌우 가르는
      //      곳과 같은 규약이다. 팔꿈치는 몸 바깥으로 빠지므로 왼팔 +x · 오른팔 −x.
      //    ※ 모델 앞은 로컬 **+z** 다(접지 IK 의 무릎 앞이 (0,0,1)을 쓴다).
      //      팔꿈치는 뒤로 빠져야 하니 −z.
      //    ※ 폴 '타깃까지의 거리'는 결과에 안 들어간다 — 축에 수직인 **방향**만
      //      쓰기 때문이다. 그래서 자리가 아니라 방향을 준다(길이를 맞출 필요가 없다).
      if (폴.켬) {
        _고정
          .set((s === "l" ? 1 : -1) * 폴.바깥, -폴.아래, -폴.뒤)
          .applyQuaternion(group.quaternion);
        _고정.addScaledVector(_축, -_고정.dot(_축));
        // 클립 쪽 → 고정 쪽으로 섞는다. 곧장 고정으로 못 박으면 물건을 드는
        //   순간(힘 0 → 0.85) 팔꿈치가 한 프레임에 홱 돈다.
        const 섞 = THREE.MathUtils.clamp(폴.세기 * 힘, 0, 1);
        if (_고정.lengthSq() > 1e-8) {
          _고정.normalize();
          if (_폴.lengthSq() < 1e-8) _폴.copy(_고정);
          else _폴.normalize().multiplyScalar(1 - 섞).addScaledVector(_고정, 섞);
        }
      }
      // 축과 폴이 겹쳤다(팔이 곧게 펴져 평면이 안 정해진다) — 이번 프레임은
      //   안 건드린다. 억지로 아무 평면이나 고르면 거기서 딸깍이 다시 생긴다.
      if (_폴.lengthSq() < 1e-8) return;
      _폴.normalize();
      // ③ 팔꿈치가 있어야 할 **자리** — 코사인 법칙을 각이 아니라 자리로 푼다.
      //    어깨에서 축 방향으로 a, 거기서 폴 방향으로 h 만큼 간 곳이 팔꿈치다.
      const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      _E목표.copy(_S).addScaledVector(_축, a).addScaledVector(_폴, h);
      // 손이 닿을 수 있는 가장 가까운 자리. 목표가 멀면 위에서 d 로 잘려 있다.
      _W목표.copy(_S).addScaledVector(_축, d);
      // ④ 뼈 둘을 그 자리에 **한 번씩** 맞춘다. 되풀이도, 부호 시험도 없다.
      //    위팔을 팔꿈치 자리로 돌리면 |어깨−팔꿈치| 는 L1 그대로라 정확히 겹치고,
      //    이어서 아래팔을 손 자리로 돌리면 |팔꿈치−손| 이 L2 라 또 정확히 겹친다.
      팔돌리기(upper, _E, _E목표, _S);
      _E.setFromMatrixPosition(lower.matrixWorld);
      _W.setFromMatrixPosition(hand.matrixWorld);
      팔돌리기(lower, _W, _W목표, _E);
      if (s === "r") {
        계적기(s, L1, L2);
        if (import.meta.env.DEV)
          계.팔꿈치 = [_E목표.x, _E목표.y, _E목표.z].map((v) => +v.toFixed(2));
      }
    };

    // ── 옛 방식(폴 벡터 없음) — 폴.켬 이 꺼져 있을 때 그대로 돈다 ──────
    //   ★ 지우지 않는다. 오른팔은 이 방식으로 화면을 보며 맞춰 둔 상태다.
    //     새 방식이 화면에서 더 낫다고 **눈으로 확인하기 전까지** 이쪽이 기본이다.
    //     바뀐 것은 뼈를 인자로 받는 것뿐이다(그래서 왼팔에도 그대로 걸린다).
    const 팔풀기옛 = ({ s, upper, lower, hand }, 힘, 목표) => {
      _S.setFromMatrixPosition(upper.matrixWorld);
      _W.setFromMatrixPosition(hand.matrixWorld);
      _T.set(목표.x, 목표.y, 목표.z).sub(_W).multiplyScalar(힘).add(_W);
      let L1 = 0;
      let L2 = 0;
      for (let 회 = 0; 회 < 2; 회 += 1) {
        _S.setFromMatrixPosition(upper.matrixWorld);
        _E.setFromMatrixPosition(lower.matrixWorld);
        _W.setFromMatrixPosition(hand.matrixWorld);
        L1 = _S.distanceTo(_E);
        L2 = _E.distanceTo(_W);
        if (L1 < 1e-5 || L2 < 1e-5) break;
        const d = THREE.MathUtils.clamp(
          _S.distanceTo(_T),
          Math.abs(L1 - L2) + 1e-4,
          L1 + L2 - 1e-4,
        );
        // 코사인 법칙 — 팔꿈치 안쪽 각
        const 목표각 = Math.acos(
          THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1),
        );
        _u.copy(_S).sub(_E).normalize();
        _v.copy(_W).sub(_E).normalize();
        const 지금각 = Math.acos(THREE.MathUtils.clamp(_u.dot(_v), -1, 1));
        _n.crossVectors(_u, _v);
        if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0).applyQuaternion(group.quaternion);
        _n.normalize();
        const 팔회전 = (bone, axis, angle) => {
          bone.parent.getWorldQuaternion(_pq);
          _wq.setFromAxisAngle(axis, angle);
          bone.quaternion.premultiply(
            _보정q.copy(_pq).invert().multiply(_wq).multiply(_pq),
          );
          bone.updateMatrixWorld(true);
        };
        // 팔꿈치가 몸 뒤로 빠졌나 — 어깨·손 중점에서 팔꿈치로 가는 벡터의 −z 성분
        const 팔꿈치뒤 = () => {
          _E.setFromMatrixPosition(lower.matrixWorld);
          _W2.setFromMatrixPosition(hand.matrixWorld);
          _u.copy(_E).sub(_v.copy(_S).add(_W2).multiplyScalar(0.5));
          _v.set(0, 0, -1).applyQuaternion(group.quaternion);
          return _u.dot(_v);
        };
        팔회전(lower, _n, 목표각 - 지금각);
        _W2.setFromMatrixPosition(hand.matrixWorld);
        if (Math.abs(_S.distanceTo(_W2) - d) > 1e-3 || 팔꿈치뒤() < 0) {
          팔회전(lower, _n, -2 * (목표각 - 지금각));
          _W2.setFromMatrixPosition(hand.matrixWorld);
          if (Math.abs(_S.distanceTo(_W2) - d) > 1e-3 && 팔꿈치뒤() < 0) {
            팔회전(lower, _n, 목표각 - 지금각); // 어느 쪽도 아니면 원래대로
            _W2.setFromMatrixPosition(hand.matrixWorld);
          }
        }
        // 어깨 — 손이 목표를 향하도록 팔 전체를 돌린다
        _u.copy(_W2).sub(_S).normalize();
        _v.copy(_T).sub(_S).normalize();
        _wq.setFromUnitVectors(_u, _v);
        upper.parent.getWorldQuaternion(_pq);
        upper.quaternion.premultiply(
          _보정q.copy(_pq).invert().multiply(_wq).multiply(_pq),
        );
        upper.updateMatrixWorld(true);
      }
      계적기(s, L1, L2);
    };

    // 좌우 한 벌씩 푼다.
    //   왼팔은 게임이 왼손목표 를 줄 때만 돈다 — 안 주면 예전과 한 픽셀도 안 다르다.
    준비.팔.forEach((한팔) => {
      const { 힘, 점 } = 팔요청[한팔.s];
      if (!(힘 > 0.001) || !점) return;
      (폴.켬 ? 팔풀기폴 : 팔풀기옛)(한팔, 힘, 점);
    });

    // ── 손목을 물건에 맞춘다 ─────────────────────────────────
    // [왜 필요한가]
    //   위 2본 IK 는 손이 갈 **자리**만 푼다. 손목이 어떻게 꺾이는지는 클립이
    //   정한 그대로다. 그래서 컵을 들든 서류를 들든 **손목 각이 똑같았고**,
    //   물건에 따라 손등이 위로 가야 할 때도 옆으로 누운 채였다.
    //   상용 엔진은 hand IK 에 위치와 **회전**을 같이 준다
    //   (UE Two Bone IK 의 Effector Rotation, Unity TwoBoneIK 의 targetRotationWeight).
    // [왜 게임이 각을 주나]
    //   "이 물건은 손등이 어디를 봐야 하나"는 물건 쪽 사실이다(쥠표의 손각).
    //   아바타는 리그 좌표계만 알고 물건은 모른다 — 그래서 완성된 **세계 회전**을
    //   받아서 부모 공간으로 옮겨 넣기만 한다.
    // [왜 꺾임을 자른다] 사람 손목은 아래팔 축으로 무한정 돌지 않는다.
    //   목표를 그대로 쓰면 손이 180° 뒤집힌 채 붙어 **부러진 것처럼** 보인다.
    //   아래팔 축 기준으로 목표 회전을 잰 뒤 한계 안으로 줄인다.
    const 손목맞춤 = (한팔, 목표, 세기) => {
      const { hand } = 한팔;
      if (!hand || !(세기 > 0.001) || !목표) return;
      // ★ 기준은 **지금 클립이 만든 손 자세**다. 아래팔이 아니다.
      //   예전에는 `목표.angleTo(아래팔세계)` 를 재서 75° 로 잘랐는데,
      //   이 리그의 hand_r bind 로컬 회전이 **정확히 X축 −90°** 라
      //   아무것도 안 해도 그 각이 90° 로 나온다. 그래서 목표가 클립 자세와
      //   똑같아도 매 프레임 손이 15° 씩 끌려갔다 — 켜면 오히려 나빠졌다.
      //   (실제 클립의 손목 변화폭은 5.3~26.1° 뿐이다)
      //   클립 자세에서 **목표 쪽으로 한계만큼만** 돌리면 그 함정이 없다.
      _쉴때q.copy(hand.getWorldQuaternion(_아래팔q));
      // ★★ 목표를 **다른 그릇**에 담아야 한다.
      //   `_손q.slerpQuaternions(_쉴때q, _손q, t)` 로 썼다가 손목이 한 번도
      //   안 움직였다. three 의 구현이 `this.copy(qa).slerp(qb, t)` 인데
      //   여기서 `this === qb` 라, copy 가 **목표를 먼저 덮어써** 결과가 늘
      //   현재 자세(qa)가 된다. 손각을 어떤 값으로 바꿔도 손바닥 y 가
      //   −0.68 로 고정이던 것이 이것이다(실측으로 잡았다).
      _목표q.set(목표.x, 목표.y, 목표.z, 목표.w);
      // 세기만큼만 간다(툭 바뀌지 않게) → 그다음 한계로 자른다
      _손q.copy(_쉴때q).slerp(_목표q, Math.min(1, 세기));
      // rotateTowards 는 목표를 **넘어가지 않는다**(three 문서 그대로).
      _쉴때q.rotateTowards(_손q, (손목한계 * Math.PI) / 180);
      hand.parent.getWorldQuaternion(_부모q);
      hand.quaternion.copy(_부모q.invert().multiply(_쉴때q));
      hand.updateMatrixWorld(true);
    };
    const 손회전세기 = Math.max(0, Math.min(1, state.손회전세기 ?? 0));
    if (손회전세기 > 0.001) {
      const 오팔 = 준비.팔.find((a) => a.s === "r");
      const 왼팔 = 준비.팔.find((a) => a.s === "l");
      if (오팔 && state.손회전 && 팔요청.r.힘 > 0.001) 손목맞춤(오팔, state.손회전, 손회전세기);
      if (왼팔 && state.왼손회전 && 팔요청.l.힘 > 0.001) 손목맞춤(왼팔, state.왼손회전, 손회전세기);
    }

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
              bone.quaternion.premultiply(_보정q.copy(pq).invert().multiply(wq).multiply(pq));
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
            thigh.quaternion.premultiply(_보정q.copy(pq).invert().multiply(wq).multiply(pq));
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
    //
    // ── 왜 캐시하나 ────────────────────────────────────────
    //   정점 7731 개를 훑으며 스키닝 위치를 CPU 로 구한다(정점마다 뼈 4 개 가중 곱).
    //   실측(Apple M5 Max, 실제 GPU): **아바타당 프레임당 3.0ms** — 60fps 예산의 1/5 이다.
    //   제자리 클립에서는 최저점이 사실상 고정이라(Idle_Loop 3초 진폭 0.10mm) 다시 안 구해도 된다.
    //
    // ── 무엇을 기준으로 「고정」이라 하나 ──────────────────
    //   **플레이어의 이동 플래그(state.moving)가 아니라 지금 도는 클립과 설정이다.**
    //   생성 화면 미리보기·검증 모드는 moving=false 를 고정해 둔 채 걷기 클립을 돌린다.
    //   그때 최저점은 38mm 움직인다 — moving 으로 판정하면 캐릭터가 2.5cm 묻혔다 튄다(실측).
    //   그래서 ① 제자리 클립이고 ② 크로스페이드가 끝났고 ③ 외형 설정이 그대로일 때만 쓴다.
    //   ③ 은 항목을 골라 적지 않고 `설정` 전체를 지문으로 쓴다 — 다리 길이·발 크기·신발만
    //   아니라 체형 모프도 발바닥 메시를 건드릴 수 있고, 항목을 늘릴 때마다 여기를 고치는 걸
    //   잊으면 조용히 틀린다. 설정은 값 십여 개짜리 납작한 객체라 훑는 값이 3.0ms 에 비해 없다
    //   (생성 화면에서 슬라이더를 끄는 동안 캐시가 물리면 발이 땅에 묻힌다).
    const 지문 = `${next}|${몸체}|${JSON.stringify(설정)}`;
    const 캐시가능 =
      제자리모션.has(next) &&
      next === 현재모션.current &&
      now >= 전환끝.current &&
      now >= 공격끝.current &&
      state.grounded &&
      지문 === 발지문.current &&
      바닥높이캐시.current !== null;
    발지문.current = 지문;
    if (!캐시가능) {
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
      바닥높이캐시.current = Number.isFinite(soleY) ? soleY : null;
    }
    if (바닥높이캐시.current !== null) group.position.y = state.footY - 바닥높이캐시.current * avatarScale;

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
  }, 프레임순서);

  return (
    <group name="NAJU-chibi-avatar" ref={root} visible={보이기 || 일인칭몸}>
      <primitive object={준비.model} />
    </group>
  );
}

// 모듈을 읽기만 해도 받아 오는 예열은 **정말 늘 쓰는 것만** 둔다.
//   chibi 몸체 두 벌(6.5MB)을 예열하고 있었는데, 나주·로비는 몸체="meshy" 라 한 번도 안 쓴다.
//   chibi 로 쓸 때는 컴포넌트의 useGLTF 가 그때 읽으므로 잃는 것이 없다(실측: 진입 시 6.5MB 덜 받음).
useGLTF.preload(모션파일);
useGLTF.preload(트리포모션파일들);

export default ChibiGameAvatar;
