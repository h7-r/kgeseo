// Synty Sidekick 모듈 캐릭터 + Quaternius CC0 43개 모션 런타임.
// 외형은 하나의 공통 리그 위에서 머리·헤어·상의·하의·신발 메시를 교체하고,
// 체형은 Synty 원본 morph target을 움직인다. 모션은 원본 root motion을 빼고
// 게임 이동 좌표에 리타게팅한다.
// 현대 의상(4~11번)은 같은 스켈레톤에 스키닝된 실제 메시이고, 기본 몸 위에 겹쳐
// 입는다. 옷이 덮는 피부는 셰이더에서 숨겨 관통이 보이지 않게 한다.
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone, retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";
import { 미터 } from "./공간도면.js";
import { 기본사이드킥설정 } from "./사이드킥옵션.js";

const 캐릭터파일 = "/models/sidekick-customizer.glb";
const 모션파일 = "/models/vendor/quaternius-universal-animation-library.glb";
const 속옷색 = "#f7f7f3";
// build_sidekick_wardrobe.py의 SHOULDER_SHIFT와 같아야 한다.
// shoulderWidth morph는 "본 이동이 옮기지 않는 몸통 부분"만 담고 있으므로
// 본 이동과 morph를 항상 같은 비율로 함께 적용해야 어깨가 찢어지지 않는다.
const 어깨본이동 = 0.035;
const 어깨범위 = 0.25;
// 눈동자 기본 반지름(라디안). 안구 중심에서 정면 방향과 이루는 각도로 판정한다.
const 눈동자기본각 = 0.19;
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

// 원본 눈 메시 하나로 흰자와 중앙 눈동자를 함께 그린다. 판정은 스키닝·morph
// 이전의 bind 좌표(position)로 하므로 키·머리 크기·체형·모션이 바뀌어도
// 눈동자는 항상 안구 중앙에 붙어 있다. 흰자 영역(메시)은 건드리지 않는다.
function 눈셰이더준비(mesh) {
  if (mesh.userData.눈uniforms) return mesh.userData.눈uniforms;
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const radius = (box.max.x - box.min.x) / 2;
  const uniforms = {
    uEyeCenter: { value: new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z - radius) },
    uPupilColor: { value: new THREE.Color("#26364a") },
    uPupilRadius: { value: 눈동자기본각 },
  };
  const material = mesh.material;
  material.map = null;
  material.color?.set("#f7f4ee");
  if (material.emissive) {
    material.emissive.set("#ffffff");
    material.emissiveIntensity = 0.12;
  }
  if ("roughness" in material) material.roughness = 0.3;
  if ("metalness" in material) material.metalness = 0;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vEyeBind;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvEyeBind = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vEyeBind;\nuniform vec3 uEyeCenter;\nuniform vec3 uPupilColor;\nuniform float uPupilRadius;\nfloat eyeIris = 0.0;",
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 eyeDir = normalize(vEyeBind - uEyeCenter);
        float eyeAngle = acos(clamp(eyeDir.z, -1.0, 1.0));
        eyeIris = 1.0 - smoothstep(uPupilRadius - 0.03, uPupilRadius, eyeAngle);
        float eyeCore = 1.0 - smoothstep(uPupilRadius * 0.42 - 0.025, uPupilRadius * 0.42, eyeAngle);
        diffuseColor.rgb = mix(diffuseColor.rgb, uPupilColor, eyeIris);
        diffuseColor.rgb = mix(diffuseColor.rgb, uPupilColor * 0.2, eyeCore);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 1.0 - eyeIris;",
      );
  };
  material.needsUpdate = true;
  mesh.userData.눈uniforms = uniforms;
  return uniforms;
}

// 기본 몸(피부) 파츠 — 옷이 덮는 bind 좌표 영역을 버린다. 옷 가장자리에서
// 여유(margin)만큼 안쪽만 숨기므로 소매·밑단 경계에서는 피부가 이어져 보인다.
// 속옷 복제본은 피부와 같은 면에 겹쳐 그린다. polygonOffset으로 앞세우면 비스듬한
// 각도에서 1cm 떨어진 치마까지 이겨 흰 얼룩이 보였다. 대신 속옷이 보이는 높이 띠의
// 피부를 버려 깊이 경쟁 자체를 없앤다. part: 1 = 몸통(가슴 띠), 2 = 골반(허리 아래 띠).
// Synty 기본 골반 메시에는 사각 속옷 밑단이 형상(z≈0.705 m에서 다리 둘레가 턱지게
// 커짐)으로 모델링되어 있다. 흰색 경계를 그 턱에 정확히 맞춰야 피부색 턱이 남지
// 않고, 그 아래 허벅지·무릎으로는 흰색이 번지지 않는다.
const 속옷띠 = { 1: [1.17, 1.36], 2: [0.702, 1.0] };
const 속옷선GLSL = (p, band) => `(${p}.y >= ${band}.y && ${p}.y <= ${band}.z)`;

function 속옷셰이더(shader, part) {
  const [low, high] = 속옷띠[part];
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vUnderwearBind;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvUnderwearBind = position;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\nvarying vec3 vUnderwearBind;\nconst vec3 uUnderwearBand = vec3(1.0, ${low.toFixed(3)}, ${high.toFixed(3)});`)
    .replace(
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>\nif (!${속옷선GLSL("vUnderwearBind", "uUnderwearBand")}) discard;`,
    );
}

function 피부가림준비(mesh, part = 0) {
  const band = 속옷띠[part] ?? [0, 0];
  const uniforms = {
    uUnderwearBand: { value: new THREE.Vector3(0, band[0], band[1]) },
    uTopCover: { value: new THREE.Vector4(0, 0, 0, 0) },
    uTopNeck: { value: new THREE.Vector2(0, 0) },
    uBottomCover: { value: new THREE.Vector3(0, 0, 0) },
  };
  mesh.material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCoverBind;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCoverBind = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vCoverBind;\nuniform vec4 uTopCover;\nuniform vec2 uTopNeck;\nuniform vec3 uUnderwearBand;\nuniform vec3 uBottomCover;",
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        if (uUnderwearBand.x > 0.5 && ${속옷선GLSL("vCoverBind", "uUnderwearBand")}) discard;
        if (uTopCover.x > 0.5
          && vCoverBind.y > uTopCover.y + 0.035
          && abs(vCoverBind.x) < uTopCover.z - 0.035
          && vCoverBind.y < uTopCover.w + uTopNeck.x * vCoverBind.z + uTopNeck.y * vCoverBind.x * vCoverBind.x - 0.02) discard;
        if (uBottomCover.x > 0.5
          && vCoverBind.y < uBottomCover.y - 0.03
          && vCoverBind.y > uBottomCover.z + 0.035
          && abs(vCoverBind.x) < 0.3) discard;`,
      );
  };
  mesh.material.needsUpdate = true;
  mesh.userData.가림uniforms = uniforms;
}

// 원단 느낌 — 색은 UI에서 바꾸므로 텍스처 대신 bind 좌표 기반의 아주 약한 명암만 준다.
function 원단준비(mesh, fabric) {
  const material = mesh.material;
  material.map = null;
  material.side = THREE.DoubleSide;
  if ("metalness" in material) material.metalness = 0;
  if ("roughness" in material) material.roughness = fabric === "nylon" ? 0.62 : 0.9;
  if (fabric !== "rib" && fabric !== "denim") return;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFabricBind;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFabricBind = position;");
    const pattern =
      fabric === "rib"
        ? "float fabricShade = 0.94 + 0.06 * smoothstep(-0.2, 0.6, sin(atan(vFabricBind.x, vFabricBind.z) * 110.0));"
        : "float fabricShade = 0.95 + 0.05 * sin((vFabricBind.y + vFabricBind.x * 0.7) * 520.0) * sin(vFabricBind.z * 180.0 + vFabricBind.y * 40.0);";
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFabricBind;")
      .replace("#include <color_fragment>", `#include <color_fragment>\n${pattern}\ndiffuseColor.rgb *= fabricShade;`);
  };
  material.needsUpdate = true;
}

function 어깨값(appearance) {
  return THREE.MathUtils.clamp(((appearance.shoulderWidth ?? 1) - 1) / 어깨범위, -1, 1);
}

function 체형입히기(mesh, appearance) {
  형태값(mesh, "masculineFeminine", appearance.feminine);
  형태값(mesh, "defaultHeavy", appearance.heavy);
  형태값(mesh, "defaultBuff", appearance.buff);
  형태값(mesh, "defaultSkinny", appearance.skinny);
  형태값(mesh, "shoulderWidth", 어깨값(appearance));
}

function 여성속옷갱신(mesh, appearance) {
  mesh.visible = appearance.top === 1 && (appearance.gender ?? (appearance.feminine >= 0.5 ? "feminine" : "masculine")) === "feminine";
  체형입히기(mesh, appearance);
}

// 치마는 아래에서 보이므로 속옷 하의를 유지한다. 바지·반바지는 덮어서 숨긴다.
function 하의속옷갱신(mesh, appearance, 치마) {
  mesh.visible = appearance.bottom === 1 || 치마;
  체형입히기(mesh, appearance);
}

// 1번(기본 몸)은 속옷 상태이자 현대 의상 아래 몸이다. 2·3번 원본 세트만 몸을 대체한다.
function 기본몸보임(option) {
  return option !== 2 && option !== 3;
}

function SidekickGameAvatar({
  보이기,
  플레이어참조,
  설정 = 기본사이드킥설정,
  크기 = 미터,
  // QA 캡처 전용: 지정하면 모션을 페이드 없이 이 시각(초)에 고정한다.
  검증시각 = null,
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
        const garment = object.userData.wardrobe_garment ? object.userData : null;
        if (garment) 원단준비(object, garment.garment_fabric);
        const bodySkin =
          (info.slot === "top" || info.slot === "bottom") && info.option === 1;
        if (bodySkin) {
          const part = object.name.includes("10TORS") ? 1 : object.name.includes("17HIPS") ? 2 : 0;
          피부가림준비(object, part);
        }
        if (object.name.includes("EYEL") || object.name.includes("EYER")) 눈셰이더준비(object);
        parts.push({ object, ...info, garment });
      }
    });

    targetSkin.skeleton.pose();
    model.updateMatrixWorld(true);

    // 어깨 넓이 — upperarm·shoulderAttach 본을 부모(쇄골) 좌표계에서 옆으로 민다.
    // 리타게팅 클립은 회전 트랙만 가지므로 매 프레임 휴식 위치 + 보정값을 다시
    // 써 두면 어떤 모션을 재생해도 유지된다.
    const inverseRoot = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const shoulderBones = [];
    ["upperarm_l", "shoulderAttach_l", "upperarm_r", "shoulderAttach_r"].forEach((name) => {
      const bone = targetSkin.skeleton.getBoneByName(name);
      if (!bone?.parent) return;
      const parentInModel = new THREE.Matrix4().multiplyMatrices(inverseRoot, bone.parent.matrixWorld);
      const toParent = new THREE.Matrix3().setFromMatrix4(parentInModel).invert();
      const side = name.endsWith("_l") ? 1 : -1;
      shoulderBones.push({
        bone,
        rest: bone.position.clone(),
        direction: new THREE.Vector3(side, 0, 0).applyMatrix3(toParent),
      });
    });

    // 기본 상의를 벗은 여성 체형에서만 보이는 흰색 스포츠 브라. 기본 몸통의
    // 스킨 메시를 한 겹 복제하고 가슴 높이만 셰이더로 남긴다. 따라서 별도
    // 고정 장식과 달리 원본과 완전히 같은 본 가중치·체형 morph를 사용하며,
    // 걷기·달리기·펀치에서도 찢어지거나 몸에서 떨어질 수 없다.
    const baseTorso = parts.find(
      ({ object, slot, option }) =>
        slot === "top" && option === 1 && object.name.includes("10TORS"),
    )?.object;
    const chestUnderwear = baseTorso.clone();
    chestUnderwear.name = "SKLIB_female_chest_underwear";
    chestUnderwear.material = new THREE.MeshStandardMaterial({
      color: 속옷색,
      roughness: 0.82,
      metalness: 0,
    });
    chestUnderwear.material.onBeforeCompile = (shader) => 속옷셰이더(shader, 1);
    chestUnderwear.castShadow = true;
    chestUnderwear.receiveShadow = true;
    chestUnderwear.frustumCulled = false;
    baseTorso.parent.add(chestUnderwear);

    // HIPS 기본 파츠에는 골반뿐 아니라 허벅지 윗부분까지 한 메시로 들어 있다.
    // 파츠 전체를 흰색으로 바꾸면 무릎까지 흰 바지가 되므로, 피부색 원본 위에
    // 허리 바로 아래 높이만 남긴 복제 스킨을 얹어 실제 속옷 영역만 흰색으로 만든다.
    const baseHips = parts.find(
      ({ object, slot, option }) =>
        slot === "bottom" && option === 1 && object.name.includes("17HIPS"),
    )?.object;
    const lowerUnderwear = baseHips.clone();
    lowerUnderwear.name = "SKLIB_base_lower_underwear";
    lowerUnderwear.material = new THREE.MeshStandardMaterial({
      color: 속옷색,
      roughness: 0.82,
      metalness: 0,
    });
    lowerUnderwear.material.onBeforeCompile = (shader) => 속옷셰이더(shader, 2);
    lowerUnderwear.castShadow = true;
    lowerUnderwear.receiveShadow = true;
    lowerUnderwear.frustumCulled = false;
    baseHips.parent.add(lowerUnderwear);

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
    // 발끝을 세우는 달리기·점프 자세에서는 발 본보다 발가락 정점이 더 내려간다.
    // 신발(맨발 포함) 메시의 발바닥 정점만 골라 두었다가 실제 스키닝 위치로 접지한다.
    const soles = parts
      .filter(({ slot }) => slot === "shoes")
      .map(({ object, option }) => {
        const position = object.geometry.getAttribute("position");
        const indices = [];
        for (let i = 0; i < position.count; i += 1) {
          if (position.getY(i) < 0.035) indices.push(i);
        }
        return { object, option, indices };
      });
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
      shoulderBones,
      chestUnderwear,
      lowerUnderwear,
      headBone: targetSkin.skeleton.getBoneByName("head"),
      bottom,
      feet,
      soles,
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
      gender: 설정.gender,
      feminine: 설정.feminine,
      heavy: 설정.heavy,
      buff: 설정.buff,
      skinny: 설정.skinny,
      heightScale: 설정.heightScale,
      headScale: 설정.headScale,
      shoulderWidth: 설정.shoulderWidth,
      pupilScale: 설정.pupilScale,
      skinColor: 설정.skinColor,
      eyeColor: 설정.eyeColor,
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
      설정.heightScale, 설정.headScale, 설정.gender, 설정.shoulderWidth, 설정.pupilScale,
      설정.skinColor, 설정.eyeColor, 설정.hairColor, 설정.topColor, 설정.bottomColor,
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
  const 마지막공격 = useRef(0);
  const 공격끝 = useRef(0);
  const 역행렬 = useMemo(() => new THREE.Matrix4(), []);
  const 발좌표 = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const chosen = 외형설정;
    const 선택옷 = (slot) =>
      준비.parts.find(({ slot: s, option, garment }) => s === slot && option === chosen[slot] && garment)?.garment;
    const 상의 = 선택옷("top");
    const 하의 = 선택옷("bottom");
    const 치마 = 하의?.cover_kind === "skirt";
    준비.parts.forEach(({ object, slot, option }) => {
      if (slot === "fixed") object.visible = true;
      else if (option === 1 && (slot === "top" || slot === "bottom" || slot === "shoes")) {
        object.visible = option === chosen[slot] || (slot !== "shoes" && 기본몸보임(chosen[slot]));
      } else object.visible = option === chosen[slot];
      체형입히기(object, 외형설정);

      const eye = object.name.includes("EYEL") || object.name.includes("EYER");
      let color = null;
      if (eye) color = 외형설정.eyeColor;
      else if (slot === "hair" || slot === "brows" || slot === "facialHair") color = 외형설정.hairColor;
      else if (slot === "head" || slot === "ears" || slot === "nose") color = 외형설정.skinColor;
      else if (slot === "top") color = option === 1 ? 외형설정.skinColor : 외형설정.topColor;
      else if (slot === "bottom") color = option === 1 ? 외형설정.skinColor : 외형설정.bottomColor;
      else if (slot === "shoes") color = option === 1 ? 외형설정.skinColor : 외형설정.shoesColor;
      else if (slot !== "fixed" && slot !== "teeth") color = 외형설정.accessoryColor;
      else if (object.name.includes("EBR")) color = 외형설정.hairColor;
      else if (object.name.includes("EAR") || object.name.includes("NOSE")) color = 외형설정.skinColor;
      if (eye) {
        const uniforms = object.userData.눈uniforms;
        uniforms.uPupilColor.value.set(외형설정.eyeColor);
        uniforms.uPupilRadius.value = 눈동자기본각 * THREE.MathUtils.clamp(외형설정.pupilScale ?? 1, 0.55, 1.45);
      } else 색입히기(object, color);

      const cover = object.userData.가림uniforms;
      if (cover) {
        cover.uTopCover.value.set(
          상의 ? 1 : 0,
          상의?.cover_hem_y ?? 0,
          상의?.cover_sleeve_x ?? 0,
          상의?.cover_neck_y0 ?? 0,
        );
        cover.uTopNeck.value.set(상의?.cover_neck_slope_z ?? 0, 상의?.cover_neck_curve ?? 0);
        cover.uBottomCover.value.set(
          하의 && !치마 ? 1 : 0,
          하의?.cover_waist_y ?? 0,
          하의?.cover_leg_y ?? 0,
        );
      }
    });
    여성속옷갱신(준비.chestUnderwear, 외형설정);
    하의속옷갱신(준비.lowerUnderwear, 외형설정, 치마);
    준비.parts.forEach(({ object }) => {
      const cover = object.userData.가림uniforms;
      if (!cover) return;
      const part = object.name.includes("10TORS") ? 준비.chestUnderwear : object.name.includes("17HIPS") ? 준비.lowerUnderwear : null;
      cover.uUnderwearBand.value.x = part?.visible ? 1 : 0;
    });
  }, [
    준비.parts,
    준비.chestUnderwear,
    준비.lowerUnderwear,
    외형설정,
  ]);

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
      // React StrictMode는 개발 중 effect를 setup → cleanup → setup 순서로
      // 한 번 더 검증한다. 액션만 비우고 이름을 남기면 다음 프레임이
      // 이미 재생 중이라고 오판해 T 포즈에 멈춘다.
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
    if ((state.attackSerial ?? 0) !== 마지막공격.current) {
      마지막공격.current = state.attackSerial ?? 0;
      const attackClip = 준비.clipFor(state.attackMotion);
      공격끝.current =
        now + THREE.MathUtils.clamp((attackClip?.duration ?? 0.62) / 1.2, 0.45, 0.82);
    }
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
      if (now < 공격끝.current && state.attackMotion) {
        next = state.attackMotion;
      } else if (confirmedAir) {
        if (!공중모션중.current) 점프시작끝.current = now + 0.22;
        next = now < 점프시작끝.current ? "Jump_Start" : "Jump_Loop";
      } else if (공중모션중.current && state.grounded) {
        착지끝.current = now + 0.28;
        next = "Jump_Land";
      } else if (now < 착지끝.current) next = "Jump_Land";
      else if (state.crouching) next = state.moving ? "Crouch_Fwd_Loop" : "Crouch_Idle_Loop";
      else if (state.moving) {
        next = state.running
          ? (설정.runMotion || "Jog_Fwd_Loop")
          : (설정.walkMotion || "Walk_Loop");
      }
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
    const shoulder = 어깨값(설정) * 어깨본이동;
    준비.shoulderBones.forEach(({ bone, rest, direction }) => {
      bone.position.copy(rest).addScaledVector(direction, shoulder);
    });

    group.position.set(state.position.x, state.footY, state.position.z);
    group.rotation.set(0, state.facing, 0);
    const avatarScale = 크기 * (설정.heightScale ?? 1);
    group.scale.setScalar(avatarScale);
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
    let soleY = Infinity;
    준비.soles.forEach(({ object, option, indices }) => {
      if (option !== (설정.shoes ?? 1)) return;
      indices.forEach((index) => {
        object.getVertexPosition(index, 발좌표);
        object.localToWorld(발좌표).applyMatrix4(역행렬);
        soleY = Math.min(soleY, 발좌표.y);
      });
    });
    const animatedBottom = Number.isFinite(soleY)
      ? soleY
      : Number.isFinite(animatedFootY)
        ? animatedFootY + 준비.soleOffset
        : 준비.bottom;
    group.position.y = state.footY - animatedBottom * avatarScale;

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
