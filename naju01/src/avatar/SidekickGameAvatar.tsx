// Synty Sidekick 모듈 캐릭터 + Quaternius CC0 43개 모션 런타임.
//   하나의 공통 리그 위에서 머리·헤어·상의·하의·신발 메시를 바꾸고, 체형은 Synty morph target 으로 움직인다.
//   모션은 root motion 을 빼고 게임 이동 좌표에 리타게팅한다. 현대 의상(4~11번)은 같은 뼈대에 스키닝된
//   실제 메시라 기본 몸 위에 겹쳐 입고, 옷이 덮는 피부는 셰이더에서 버려 관통이 안 보이게 한다.
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone, retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";

import { exposeDevHook } from "@/debug/devHooks";
import type { AvatarLink } from "@/engine/avatarLink";

import { FORCED_MOTION } from "../app/runtimeFlags";
import { UNITS_PER_METER } from "../plan/sitePlan";
import { computeFistCenters } from "./fistCenter";
import { LOCOMOTION_CLIPS } from "./motionCorrection";
import { attachSkeleton, findFirstSkinnedMesh, computeRetargetOptions, setMorph, measureStrideSpeed } from "./rig";
import { AUTO_MOTION, DEFAULT_SIDEKICK_CONFIG, type SidekickConfig } from "./sidekickOptions";

const CHARACTER_URL = "/models/sidekick-customizer.glb";
const MOTION_LIBRARY_URL = "/models/vendor/quaternius-universal-animation-library.glb";
const UNDERWEAR_COLOR = "#f7f7f3";
// build_sidekick_wardrobe.py 의 SHOULDER_SHIFT 와 같아야 한다. shoulderWidth morph 는 본 이동이 옮기지 않는
// 몸통만 담고 있어, 본 이동과 morph 를 늘 같은 비율로 걸어야 어깨가 안 찢어진다.
const SHOULDER_BONE_SHIFT = 0.035;
const SHOULDER_RANGE = 0.25;
// 눈동자 기본 반지름(라디안) — 안구 중심에서 정면과 이루는 각으로 판정한다.
const PUPIL_BASE_ANGLE = 0.19;

interface PartIdentity {
  slot: string;
  option: number;
}

/** 옷 GLB extras(wardrobe_garment) — 덮는 영역을 bind 좌표로 알려 준다 */
interface Garment {
  wardrobe_garment?: unknown;
  garment_fabric?: string;
  cover_kind?: string;
  cover_hem_y?: number;
  cover_sleeve_x?: number;
  cover_neck_y0?: number;
  cover_neck_slope_z?: number;
  cover_neck_curve?: number;
  cover_waist_y?: number;
  cover_leg_y?: number;
}

interface SidekickPart extends PartIdentity {
  object: THREE.Mesh;
  garment: Garment | null;
}

interface EyeUniforms {
  uEyeCenter: THREE.IUniform<THREE.Vector3>;
  uPupilColor: THREE.IUniform<THREE.Color>;
  uPupilRadius: THREE.IUniform<number>;
}

interface CoverUniforms {
  uUnderwearBand: THREE.IUniform<THREE.Vector3>;
  uTopCover: THREE.IUniform<THREE.Vector4>;
  uTopNeck: THREE.IUniform<THREE.Vector2>;
  uBottomCover: THREE.IUniform<THREE.Vector3>;
}

interface HemUniforms {
  uUnderTopHem: THREE.IUniform<THREE.Vector2>;
}

// 셰이더 덧칠이 메시에 남기는 uniform 묶음. 외형이 바뀔 때 값만 바꾼다.
const eyeUniformsOf = new WeakMap<THREE.Object3D, EyeUniforms>();
const coverUniformsOf = new WeakMap<THREE.Object3D, CoverUniforms>();
const fabricUniformsOf = new WeakMap<THREE.Object3D, HemUniforms>();
const underwearUniformsOf = new WeakMap<THREE.Object3D, HemUniforms>();

/** 꾸미기 값이 쓰는 PBR 필드 — Sidekick 재질은 MeshStandardMaterial 이다 */
type SidekickMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
};

function getSingleMaterial(mesh: THREE.Mesh): SidekickMaterial {
  return (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as SidekickMaterial;
}

function parsePartName(name: string): PartIdentity | null {
  const match = /^SKLIB__([A-Za-z]+)__(\d+)__/.exec(name);
  return match ? { slot: match[1], option: Number(match[2]) } : null;
}

// Starter Pack 의 몇몇 헤어는 일부 정점이 neutral_bone 에 묶여 고개가 돌면 그 조각만 옆에 떠 보인다.
// 헤어에서만 중립 본 가중치를 head 로 옮긴다.
function applyHairWeightFix(mesh: THREE.Mesh): number {
  if (!(mesh instanceof THREE.SkinnedMesh)) return 0;
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

function applyMeshColor(mesh: THREE.Mesh, color: string | null) {
  if (!color) return;
  const materials: THREE.Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material) => {
    if (material && "color" in material && material.color instanceof THREE.Color) material.color.set(color);
  });
}

// 원본 눈 메시 하나로 흰자와 가운데 눈동자를 함께 그린다. bind 좌표로 판정해 키·머리 크기·체형·모션이
// 바뀌어도 눈동자는 안구 가운데에 붙어 있다.
function prepareEyeShader(mesh: THREE.Mesh): EyeUniforms {
  const existing = eyeUniformsOf.get(mesh);
  if (existing) return existing;
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox ?? new THREE.Box3();
  const radius = (box.max.x - box.min.x) / 2;
  const uniforms: EyeUniforms = {
    uEyeCenter: {
      value: new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z - radius),
    },
    uPupilColor: { value: new THREE.Color("#26364a") },
    uPupilRadius: { value: PUPIL_BASE_ANGLE },
  };
  const material = getSingleMaterial(mesh);
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
  eyeUniformsOf.set(mesh, uniforms);
  return uniforms;
}

// 속옷 복제본은 피부와 같은 면에 겹쳐 그린다. polygonOffset 으로 앞세우면 비스듬히 볼 때 1cm 떨어진 치마까지
// 이겨 흰 얼룩이 보인다. 대신 속옷이 보이는 높이 띠의 피부를 버려 깊이 경쟁 자체를 없앤다.
// part: 1 = 몸통(가슴 띠), 2 = 골반(허리 아래 띠). 골반 띠 아래 끝은 원본 메시의 사각 속옷 밑단 턱(z≈0.705 m)에
// 맞춰야 피부색 턱이 안 남고 허벅지로 흰색이 안 번진다.
const UNDERWEAR_BANDS: Record<number, [number, number]> = { 1: [1.17, 1.36], 2: [0.702, 1.0] };
const underwearBandGlsl = (p: string, band: string) => `(${p}.y >= ${band}.y && ${p}.y <= ${band}.z)`;

// 속옷 복제본도 상의 밑단 안쪽(허리)에서는 안 그린다 — 옷 위로 비치지 않게 하는 마지막 안전장치.
function applyUnderwearShader(shader: THREE.WebGLProgramParametersWithUniforms, part: number, uniforms: HemUniforms) {
  const [low, high] = UNDERWEAR_BANDS[part];
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vUnderwearBind;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvUnderwearBind = position;");
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>\nvarying vec3 vUnderwearBind;\nuniform vec2 uUnderTopHem;\nconst vec3 uUnderwearBand = vec3(1.0, ${low.toFixed(3)}, ${high.toFixed(3)});`,
    )
    .replace(
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>\nif (!${underwearBandGlsl("vUnderwearBind", "uUnderwearBand")}) discard;\nif (uUnderTopHem.x > 0.5 && vUnderwearBind.y > uUnderTopHem.y + 0.018) discard;`,
    );
}

// 기본 몸(피부) 파츠 — 옷이 덮는 bind 좌표 영역을 버린다. 옷 가장자리에서 여유만큼 안쪽만 숨겨
// 소매·밑단 경계에서는 피부가 이어져 보인다.
function prepareSkinCover(mesh: THREE.Mesh, part = 0) {
  const band = UNDERWEAR_BANDS[part] ?? [0, 0];
  const uniforms: CoverUniforms = {
    uUnderwearBand: { value: new THREE.Vector3(0, band[0], band[1]) },
    uTopCover: { value: new THREE.Vector4(0, 0, 0, 0) },
    uTopNeck: { value: new THREE.Vector2(0, 0) },
    uBottomCover: { value: new THREE.Vector3(0, 0, 0) },
  };
  const material = getSingleMaterial(mesh);
  material.onBeforeCompile = (shader) => {
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
        if (uUnderwearBand.x > 0.5 && ${underwearBandGlsl("vCoverBind", "uUnderwearBand")}) discard;
        if (uTopCover.x > 0.5
          && vCoverBind.y > uTopCover.y + 0.018
          && abs(vCoverBind.x) < uTopCover.z - 0.02
          && vCoverBind.y < uTopCover.w + uTopNeck.x * vCoverBind.z + uTopNeck.y * vCoverBind.x * vCoverBind.x - 0.015) discard;
        if (uBottomCover.x > 0.5
          && vCoverBind.y < uBottomCover.y - 0.012
          && vCoverBind.y > uBottomCover.z + 0.018
          && abs(vCoverBind.x) < 0.3) discard;`,
      );
  };
  material.needsUpdate = true;
  coverUniformsOf.set(mesh, uniforms);
}

// 원단 느낌 — 색은 UI 에서 바꾸므로 텍스처 대신 bind 좌표 기반의 약한 명암만 준다.
// 하의(바지·치마)는 상의 밑단 안쪽 허리를 안 그린다 — 체형 morph 를 섞으면 두 옷 간격이 늘 보장되지 않는다.
function prepareFabric(mesh: THREE.Mesh, fabric: string | undefined, slot: string) {
  const material = getSingleMaterial(mesh);
  const uniforms: HemUniforms = { uUnderTopHem: { value: new THREE.Vector2(0, 0) } };
  fabricUniformsOf.set(mesh, uniforms);
  material.map = null;
  material.side = THREE.DoubleSide;
  if ("metalness" in material) material.metalness = 0;
  if ("roughness" in material) material.roughness = fabric === "nylon" ? 0.62 : 0.9;
  const pattern =
    fabric === "rib"
      ? "float fabricShade = 0.94 + 0.06 * smoothstep(-0.2, 0.6, sin(atan(vFabricBind.x, vFabricBind.z) * 110.0));"
      : fabric === "denim"
        ? "float fabricShade = 0.95 + 0.05 * sin((vFabricBind.y + vFabricBind.x * 0.7) * 520.0) * sin(vFabricBind.z * 180.0 + vFabricBind.y * 40.0);"
        : "float fabricShade = 1.0;";
  const hideUnderTop =
    slot === "bottom" ? "if (uUnderTopHem.x > 0.5 && vFabricBind.y > uUnderTopHem.y + 0.018) discard;" : "";
  // 소스가 모든 옷에서 같아 캐시 키를 나누지 않으면 첫 옷의 셰이더(무늬·허리 숨김)를 다른 옷에 재사용한다.
  material.customProgramCacheKey = () => `sidekick-fabric:${fabric}:${slot}`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFabricBind;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFabricBind = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFabricBind;\nuniform vec2 uUnderTopHem;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${hideUnderTop}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${pattern}\ndiffuseColor.rgb *= fabricShade;`);
  };
  material.needsUpdate = true;
}

type BodyShape = Pick<
  SidekickConfig,
  "top" | "bottom" | "feminine" | "heavy" | "buff" | "skinny" | "shoulderWidth" | "gender"
>;

function computeShoulderMorph(appearance: Pick<SidekickConfig, "shoulderWidth">): number {
  return THREE.MathUtils.clamp(((appearance.shoulderWidth ?? 1) - 1) / SHOULDER_RANGE, -1, 1);
}

// 기본 골반 메시엔 속옷 허리 밴드·단추·밑단 턱이 조각돼 있다. 옷을 하나라도 입으면 그 요철을 지운
// morph(underwearFlat)를 켜 옷 위로 속옷 형태가 드러나지 않게 한다.
function isClothed(appearance: BodyShape): boolean {
  return appearance.top !== 1 || appearance.bottom !== 1;
}

function applyBodyShape(mesh: THREE.Object3D, appearance: BodyShape) {
  setMorph(mesh, "underwearFlat", isClothed(appearance) ? 1 : 0);
  setMorph(mesh, "masculineFeminine", appearance.feminine);
  setMorph(mesh, "defaultHeavy", appearance.heavy);
  setMorph(mesh, "defaultBuff", appearance.buff);
  setMorph(mesh, "defaultSkinny", appearance.skinny);
  setMorph(mesh, "shoulderWidth", computeShoulderMorph(appearance));
}

function updateChestUnderwear(mesh: THREE.Mesh, appearance: BodyShape) {
  mesh.visible =
    appearance.top === 1 &&
    (appearance.gender ?? (appearance.feminine >= 0.5 ? "feminine" : "masculine")) === "feminine";
  applyBodyShape(mesh, appearance);
}

// 치마는 아래에서 보여 속옷 하의를 남긴다. 바지·반바지는 덮어서 숨긴다.
function updateLowerUnderwear(mesh: THREE.Mesh, appearance: BodyShape, isSkirt: boolean) {
  mesh.visible = appearance.bottom === 1 || isSkirt;
  applyBodyShape(mesh, appearance);
}

// 1번(기본 몸)은 속옷 상태이자 현대 의상 아래 몸이다. 2·3번 원본 세트만 몸을 대체한다.
function isBaseBodyVisible(option: number): boolean {
  return option !== 2 && option !== 3;
}

// 기본 몸통 스킨 메시를 한 겹 복제해 속옷 높이만 셰이더로 남긴다 — 원본과 같은 본 가중치·morph 라
// 걷기·달리기·펀치에서도 찢어지거나 몸에서 떨어질 수 없다.
function createUnderwear(base: THREE.Mesh, name: string, part: number): THREE.Mesh {
  const underwear = base.clone();
  underwear.name = name;
  const material = new THREE.MeshStandardMaterial({ color: UNDERWEAR_COLOR, roughness: 0.82, metalness: 0 });
  const uniforms: HemUniforms = { uUnderTopHem: { value: new THREE.Vector2(0, 0) } };
  underwearUniformsOf.set(underwear, uniforms);
  material.onBeforeCompile = (shader) => applyUnderwearShader(shader, part, uniforms);
  underwear.material = material;
  underwear.castShadow = true;
  underwear.receiveShadow = true;
  underwear.frustumCulled = false;
  base.parent?.add(underwear);
  return underwear;
}

interface SidekickGameAvatarProps {
  visible: boolean;
  playerRef: RefObject<AvatarLink | null>;
  config?: SidekickConfig;
  /** 인게임 미터 배율 */
  scale?: number;
  /** QA 캡처 전용: 모션을 페이드 없이 이 시각(초)에 고정 */
  fixedTime?: number | null;
  /**
   * useFrame 순서. 손목표(−30) 뒤, 든 물건(−10) 앞이어야 한다 — 기본 0 이면 든 물건보다 늦게 돌아
   * 물건이 직전 프레임 손을 따라 헤엄친다. naju01 단독으로도 돌아야 해서 import 대신 기본값을 둔다.
   */
  framePriority?: number;
}

function SidekickGameAvatar({
  visible,
  playerRef,
  config = DEFAULT_SIDEKICK_CONFIG,
  scale = UNITS_PER_METER,
  fixedTime = null,
  framePriority = -20,
}: SidekickGameAvatarProps) {
  const root = useRef<THREE.Group>(null);
  const characterGltf = useGLTF(CHARACTER_URL);
  const motionGltf = useGLTF(MOTION_LIBRARY_URL);

  const prepared = useMemo(() => {
    const model = clone(characterGltf.scene);
    // 화면용 model 은 미터 배율로 크게 스케일된다. 그 골격을 retargetClip 에 넘기면 두 번째 모션부터
    // 부모 스케일이 본 스케일에 흡수되어 1/3 로 준다. 변환 전용 복제본은 늘 scale 1 로 둔다.
    const retargetModel = clone(characterGltf.scene);
    const source = clone(motionGltf.scene);
    const targetSkin = findFirstSkinnedMesh(model);
    const retargetSkin = findFirstSkinnedMesh(retargetModel);
    const sourceSkin = findFirstSkinnedMesh(source);
    if (!targetSkin || !retargetSkin || !sourceSkin) {
      throw new Error("Sidekick 또는 모션 파일에서 스킨 리그를 찾지 못했습니다.");
    }

    const parts: SidekickPart[] = [];
    let fixedHairWeights = 0;
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
      object.material = Array.isArray(object.material)
        ? object.material.map((material: THREE.Material) => material.clone())
        : object.material.clone();
      const info = parsePartName(object.name);
      if (info) {
        if (info.slot === "hair") fixedHairWeights += applyHairWeightFix(object);
        const garment = object.userData.wardrobe_garment ? (object.userData as Garment) : null;
        if (garment) prepareFabric(object, garment.garment_fabric, info.slot);
        const isBodySkin = (info.slot === "top" || info.slot === "bottom") && info.option === 1;
        if (isBodySkin) {
          const part = object.name.includes("10TORS") ? 1 : object.name.includes("17HIPS") ? 2 : 0;
          prepareSkinCover(object, part);
        }
        if (object.name.includes("EYEL") || object.name.includes("EYER")) prepareEyeShader(object);
        parts.push({ object, ...info, garment });
      }
    });

    targetSkin.skeleton.pose();
    model.updateMatrixWorld(true);

    // 어깨 넓이 — upperarm·shoulderAttach 본을 부모(쇄골) 좌표계에서 옆으로 민다. 클립은 회전 트랙만 있어
    // 매 프레임 쉴 때 위치 + 보정값을 다시 써 두면 어떤 모션에서도 유지된다.
    const inverseRoot = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const shoulderBones: { bone: THREE.Bone; rest: THREE.Vector3; direction: THREE.Vector3 }[] = [];
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

    // 기본 상의를 벗은 여성 체형에서만 보이는 흰색 스포츠 브라.
    const baseTorso = parts.find(
      ({ object, slot, option }) => slot === "top" && option === 1 && object.name.includes("10TORS"),
    )?.object;
    // HIPS 기본 파츠엔 허벅지 윗부분까지 들어 있어 통째로 희게 하면 무릎까지 흰 바지가 된다 — 허리 아래만 남긴다.
    const baseHips = parts.find(
      ({ object, slot, option }) => slot === "bottom" && option === 1 && object.name.includes("17HIPS"),
    )?.object;
    if (!baseTorso || !baseHips) throw new Error("Sidekick 기본 몸통·골반 파츠를 찾지 못했습니다.");
    const chestUnderwear = createUnderwear(baseTorso, "SKLIB_female_chest_underwear", 1);
    const lowerUnderwear = createUnderwear(baseHips, "SKLIB_base_lower_underwear", 2);

    const options = computeRetargetOptions(retargetSkin, sourceSkin);
    attachSkeleton(source, sourceSkin.skeleton);
    const sourceClips = new Map(motionGltf.animations.map((clip) => [clip.name, clip]));
    const retargetedClips = new Map<string, THREE.AnimationClip>();
    const clipFor = (name: string): THREE.AnimationClip | null => {
      const cached = retargetedClips.get(name);
      if (cached) return cached;
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

    const strides = new Map<string, number>();
    const strideFor = (name: string): number => {
      const cached = strides.get(name);
      if (cached !== undefined) return cached;
      const clip = clipFor(name);
      const speed = clip && LOCOMOTION_CLIPS.has(name) ? measureStrideSpeed(retargetModel, retargetSkin, clip) : 0;
      strides.set(name, speed);
      return speed;
    };
    targetSkin.skeleton.pose();
    model.updateMatrixWorld(true);
    const bottom = new THREE.Box3().setFromObject(model).min.y;
    const feet = ["foot_l", "ball_l", "foot_r", "ball_r"]
      .map((name) => targetSkin.skeleton.getBoneByName(name))
      .filter((bone): bone is THREE.Bone => !!bone);
    // 발끝을 세우는 달리기·점프에서는 발 본보다 발가락 정점이 더 내려간다. 신발(맨발 포함) 메시의
    // 발바닥 정점만 골라 두었다가 실제 스키닝 위치로 접지한다.
    const soles = parts
      .filter(({ slot }) => slot === "shoes")
      .map(({ object, option }) => {
        const position = object.geometry.getAttribute("position");
        const indices: number[] = [];
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
      strideFor,
      clipCount: sourceClips.size,
      parts,
      shoulderBones,
      chestUnderwear,
      lowerUnderwear,
      headBone: targetSkin.skeleton.getBoneByName("head"),
      // [왼손, 오른손]. 본편에서 든 물건이 이 뼈를 따라가야 캐릭터가 쥔 것으로 보인다
      // (빠져 있을 땐 3인칭에서 물건이 등 뒤 허공에 떠서 따라다녔다).
      handBones: ["hand_l", "hand_r"]
        .map((n) => targetSkin.skeleton.getBoneByName(n))
        .filter((bone): bone is THREE.Bone => !!bone),
      // 손목 → 주먹 한가운데. 모델당 한 번만 계산된다.
      palms: computeFistCenters(targetSkin),
      // 물건 전용 소켓 뼈(치비와 같은 규약)
      gripSockets: {
        hand_l: targetSkin.skeleton.getBoneByName("prop_l") ?? null,
        hand_r: targetSkin.skeleton.getBoneByName("prop_r") ?? null,
      },
      bottom,
      feet,
      soles,
      soleOffset: Number.isFinite(restFootY) ? bottom - restFootY : 0,
      fixedHairWeights,
      mappedBones: Object.keys(options.names).length,
    };
  }, [characterGltf.scene, motionGltf.scene, motionGltf.animations]);

  // 모션만 바꿔도 모든 파츠의 visible·morph·material 을 다시 쓰면 크고 복잡한 스킨 메시가 한 프레임
  // 통째로 사라질 수 있다. 외형 값이 실제로 바뀔 때만 파츠를 갱신한다.
  const appearance = useMemo(
    () => ({
      head: config.head,
      hair: config.hair,
      brows: config.brows,
      ears: config.ears,
      facialHair: config.facialHair,
      nose: config.nose,
      teeth: config.teeth,
      top: config.top,
      bottom: config.bottom,
      shoes: config.shoes,
      headwear: config.headwear,
      faceAccessory: config.faceAccessory,
      backAccessory: config.backAccessory,
      hipFront: config.hipFront,
      hipBack: config.hipBack,
      hipSide: config.hipSide,
      shoulderAccessory: config.shoulderAccessory,
      elbowAccessory: config.elbowAccessory,
      kneeAccessory: config.kneeAccessory,
      gender: config.gender,
      feminine: config.feminine,
      heavy: config.heavy,
      buff: config.buff,
      skinny: config.skinny,
      heightScale: config.heightScale,
      headScale: config.headScale,
      shoulderWidth: config.shoulderWidth,
      pupilScale: config.pupilScale,
      skinColor: config.skinColor,
      eyeColor: config.eyeColor,
      hairColor: config.hairColor,
      topColor: config.topColor,
      bottomColor: config.bottomColor,
      shoesColor: config.shoesColor,
      accessoryColor: config.accessoryColor,
    }),
    [
      config.head,
      config.hair,
      config.brows,
      config.ears,
      config.facialHair,
      config.nose,
      config.teeth,
      config.top,
      config.bottom,
      config.shoes,
      config.headwear,
      config.faceAccessory,
      config.backAccessory,
      config.hipFront,
      config.hipBack,
      config.hipSide,
      config.shoulderAccessory,
      config.elbowAccessory,
      config.kneeAccessory,
      config.feminine,
      config.heavy,
      config.buff,
      config.skinny,
      config.heightScale,
      config.headScale,
      config.gender,
      config.shoulderWidth,
      config.pupilScale,
      config.skinColor,
      config.eyeColor,
      config.hairColor,
      config.topColor,
      config.bottomColor,
      config.shoesColor,
      config.accessoryColor,
    ],
  );

  const mixer = useMemo(() => new THREE.AnimationMixer(prepared.targetSkin), [prepared.targetSkin]);
  const actions = useRef(new Map<string, THREE.AnimationAction>());
  const currentMotion = useRef<string | null>(null);
  const airborneSince = useRef<number | null>(null);
  const wasAirborne = useRef(false);
  const jumpStartEnd = useRef(0);
  const landingEnd = useRef(0);
  const lastAttack = useRef(0);
  const attackEnd = useRef(0);
  const inverseModel = useMemo(() => new THREE.Matrix4(), []);
  const footPoint = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const chosen: Record<string, number | string> = appearance;
    const chosenGarment = (slot: string) =>
      prepared.parts.find(({ slot: s, option, garment }) => s === slot && option === chosen[slot] && garment)?.garment;
    const top = chosenGarment("top");
    const bottom = chosenGarment("bottom");
    const isSkirt = bottom?.cover_kind === "skirt";
    prepared.parts.forEach(({ object, slot, option }) => {
      if (slot === "fixed") object.visible = true;
      else if (option === 1 && (slot === "top" || slot === "bottom" || slot === "shoes")) {
        object.visible = option === chosen[slot] || (slot !== "shoes" && isBaseBodyVisible(Number(chosen[slot])));
      } else object.visible = option === chosen[slot];
      applyBodyShape(object, appearance);

      const isEye = object.name.includes("EYEL") || object.name.includes("EYER");
      let color: string | null = null;
      if (isEye) color = appearance.eyeColor;
      else if (slot === "hair" || slot === "brows" || slot === "facialHair") color = appearance.hairColor;
      else if (slot === "head" || slot === "ears" || slot === "nose") color = appearance.skinColor;
      else if (slot === "top") color = option === 1 ? appearance.skinColor : appearance.topColor;
      else if (slot === "bottom") color = option === 1 ? appearance.skinColor : appearance.bottomColor;
      else if (slot === "shoes") color = option === 1 ? appearance.skinColor : appearance.shoesColor;
      else if (slot !== "fixed" && slot !== "teeth") color = appearance.accessoryColor;
      else if (object.name.includes("EBR")) color = appearance.hairColor;
      else if (object.name.includes("EAR") || object.name.includes("NOSE")) color = appearance.skinColor;
      if (isEye) {
        const uniforms = eyeUniformsOf.get(object);
        if (uniforms) {
          uniforms.uPupilColor.value.set(appearance.eyeColor);
          uniforms.uPupilRadius.value =
            PUPIL_BASE_ANGLE * THREE.MathUtils.clamp(appearance.pupilScale ?? 1, 0.55, 1.45);
        }
      } else applyMeshColor(object, color);

      const fabric = fabricUniformsOf.get(object);
      if (fabric) fabric.uUnderTopHem.value.set(top ? 1 : 0, top?.cover_hem_y ?? 0);
      const cover = coverUniformsOf.get(object);
      if (cover) {
        cover.uTopCover.value.set(
          top ? 1 : 0,
          top?.cover_hem_y ?? 0,
          top?.cover_sleeve_x ?? 0,
          top?.cover_neck_y0 ?? 0,
        );
        cover.uTopNeck.value.set(top?.cover_neck_slope_z ?? 0, top?.cover_neck_curve ?? 0);
        cover.uBottomCover.value.set(bottom && !isSkirt ? 1 : 0, bottom?.cover_waist_y ?? 0, bottom?.cover_leg_y ?? 0);
      }
    });
    updateChestUnderwear(prepared.chestUnderwear, appearance);
    updateLowerUnderwear(prepared.lowerUnderwear, appearance, isSkirt);
    underwearUniformsOf.get(prepared.lowerUnderwear)?.uUnderTopHem.value.set(top ? 1 : 0, top?.cover_hem_y ?? 0);
    prepared.parts.forEach(({ object }) => {
      const cover = coverUniformsOf.get(object);
      if (!cover) return;
      const underwear = object.name.includes("10TORS")
        ? prepared.chestUnderwear
        : object.name.includes("17HIPS")
          ? prepared.lowerUnderwear
          : null;
      cover.uUnderwearBand.value.x = underwear?.visible ? 1 : 0;
    });
  }, [prepared.parts, prepared.chestUnderwear, prepared.lowerUnderwear, appearance]);

  useEffect(() => {
    if (!visible) {
      mixer.stopAllAction();
      currentMotion.current = null;
    }
  }, [mixer, visible]);

  useEffect(
    () => () => {
      mixer.stopAllAction();
      actions.current.clear();
      // StrictMode 의 setup → cleanup → setup 에서 이름을 남기면 이미 재생 중이라고 오판해 T 포즈에 멈춘다.
      currentMotion.current = null;
      mixer.uncacheRoot(prepared.targetSkin);
    },
    [mixer, prepared.targetSkin],
  );

  const play = (name: string) => {
    if (name === currentMotion.current) return;
    let action = actions.current.get(name);
    if (!action) {
      const clip = prepared.clipFor(name);
      if (!clip) return;
      action = mixer.clipAction(clip, prepared.targetSkin);
      actions.current.set(name, action);
    }
    if (currentMotion.current) actions.current.get(currentMotion.current)?.fadeOut(0.16);
    action
      .reset()
      .setEffectiveTimeScale(name.startsWith("Punch_") ? 1.2 : 1)
      .fadeIn(0.16);
    const loop = name.endsWith("_Loop") || name === "A_TPose" || name === "Sword_Idle";
    action.clampWhenFinished = !loop;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1).play();
    currentMotion.current = name;
  };

  // playerRef.current 는 일부러 양방향으로 쓰는 상자다(avatarLink.ts).
  useFrame(({ clock }, delta) => {
    const group = root.current;
    const state = playerRef.current;
    if (!group || !state) return;
    // 손뼈를 상자에 얹는다(치비와 같은 규약). 쓰는 쪽은 본편이 정한다.
    state.rightHand = prepared.handBones[1] ?? prepared.handBones[0] ?? null;
    state.leftHand = prepared.handBones[0] ?? null;
    state.rightPalm = prepared.palms.hand_r ?? null;
    state.leftPalm = prepared.palms.hand_l ?? null;
    state.rightGripSocket = prepared.gripSockets.hand_r ?? null;
    state.leftGripSocket = prepared.gripSockets.hand_l ?? null;
    group.visible = visible;
    if (!visible) {
      if (import.meta.env.DEV) {
        exposeDevHook("sidekickDebug", {
          visible: false,
          motionCount: prepared.clipCount,
          mappedBones: prepared.mappedBones,
          appearance: config,
        });
      }
      return;
    }

    const avatarScale = scale * (config.heightScale ?? 1);

    // 걷기는 언제나 걷기 클립. 달릴 때만 실제 속도에 보폭이 가장 가까운 클립을 고른다(남는 차이는 재생 속도로).
    const pickByStride = (groundSpeed: number, candidates: string[]) => {
      let best = candidates[0];
      let bestError = Infinity;
      candidates.forEach((name) => {
        const own = prepared.strideFor(name) * avatarScale;
        if (own <= 1e-4) return;
        const error = Math.abs(Math.log(Math.max(1e-4, groundSpeed) / own));
        if (error < bestError) {
          bestError = error;
          best = name;
        }
      });
      return best;
    };

    const now = clock.elapsedTime;
    if ((state.attackSerial ?? 0) !== lastAttack.current) {
      lastAttack.current = state.attackSerial ?? 0;
      const attackClip = state.attackMotion ? prepared.clipFor(state.attackMotion) : null;
      attackEnd.current = now + THREE.MathUtils.clamp((attackClip?.duration ?? 0.62) / 1.2, 0.45, 0.82);
    }
    let next = config.motion;
    if (FORCED_MOTION) next = FORCED_MOTION;
    if (!next || next === AUTO_MOTION) {
      if (!state.grounded && airborneSince.current === null) airborneSince.current = now;
      if (state.grounded) airborneSince.current = null;
      // Space 점프는 즉시, 절벽 추락은 0.12초 뒤에만 공중 모션 — 경사 보행의 한두 프레임 접지 오차는 무시한다.
      const confirmedAir =
        state.jumping || (!state.grounded && airborneSince.current !== null && now - airborneSince.current > 0.12);
      if (now < attackEnd.current && state.attackMotion) {
        next = state.attackMotion;
      } else if (confirmedAir) {
        if (!wasAirborne.current) jumpStartEnd.current = now + 0.22;
        next = now < jumpStartEnd.current ? "Jump_Start" : "Jump_Loop";
      } else if (wasAirborne.current && state.grounded) {
        landingEnd.current = now + 0.28;
        next = "Jump_Land";
      } else if (now < landingEnd.current) next = "Jump_Land";
      else if (state.crouching) next = state.moving ? "Crouch_Fwd_Loop" : "Crouch_Idle_Loop";
      else if (state.moving) {
        next = state.running
          ? pickByStride(state.speed ?? 0, [config.runMotion || "Jog_Fwd_Loop", "Sprint_Loop"])
          : config.walkMotion || "Walk_Loop";
      } else next = "Idle_Loop";
      wasAirborne.current = confirmedAir;
    }
    play(next);
    const action = currentMotion.current ? actions.current.get(currentMotion.current) : undefined;
    // 발이 안 미끄러지게 걷기·달리기 재생 속도를 실제 이동 속도에 맞춘다.
    if (action && fixedTime === null && LOCOMOTION_CLIPS.has(next)) {
      const own = prepared.strideFor(next) * avatarScale;
      const groundSpeed = state.speed ?? 0;
      action.setEffectiveTimeScale(own > 1e-4 ? THREE.MathUtils.clamp(groundSpeed / own, 0.45, 2.2) : 1);
    }
    if (fixedTime !== null && action) {
      actions.current.forEach((other) => {
        if (other !== action) other.stop();
      });
      action.stopFading().setEffectiveWeight(1).play();
      action.time = fixedTime % Math.max(0.001, action.getClip().duration);
      mixer.update(0);
    } else mixer.update(delta);
    prepared.headBone?.scale.setScalar(config.headScale ?? 1);
    const shoulder = computeShoulderMorph(config) * SHOULDER_BONE_SHIFT;
    prepared.shoulderBones.forEach(({ bone, rest, direction }) => {
      bone.position.copy(rest).addScaledVector(direction, shoulder);
    });

    group.position.set(state.position.x, state.footY, state.position.z);
    group.rotation.set(0, state.facing, 0);
    group.scale.setScalar(avatarScale);
    group.updateMatrixWorld(true);

    // 원본 달리기는 두 발이 동시에 뜨는 프레임이 있어, root motion 을 뺀 채 틀면 공중에 뜬 듯 보인다.
    // 가장 낮은 발을 지면에 고정하고 점프 높이는 게임 이동 좌표가 맡는다.
    let animatedFootY = Infinity;
    inverseModel.copy(prepared.model.matrixWorld).invert();
    prepared.feet.forEach((bone) => {
      bone.getWorldPosition(footPoint).applyMatrix4(inverseModel);
      animatedFootY = Math.min(animatedFootY, footPoint.y);
    });
    let soleY = Infinity;
    prepared.soles.forEach(({ object, option, indices }) => {
      if (option !== (config.shoes ?? 1)) return;
      indices.forEach((index) => {
        object.getVertexPosition(index, footPoint);
        object.localToWorld(footPoint).applyMatrix4(inverseModel);
        soleY = Math.min(soleY, footPoint.y);
      });
    });
    const animatedBottom = Number.isFinite(soleY)
      ? soleY
      : Number.isFinite(animatedFootY)
        ? animatedFootY + prepared.soleOffset
        : prepared.bottom;
    group.position.y = state.footY - animatedBottom * avatarScale;

    if (import.meta.env.DEV) {
      exposeDevHook("sidekickDebug", {
        visible: true,
        motion: next,
        motionCount: prepared.clipCount,
        mappedBones: prepared.mappedBones,
        fixedHairWeights: prepared.fixedHairWeights,
        grounded: state.grounded,
        groundError: state.footY - state.groundY,
        appearance: config,
        position: state.position.toArray(),
      });
    }
  }, framePriority);

  return (
    <group name="NAJU-sidekick-avatar" ref={root} visible={visible}>
      <primitive object={prepared.model} />
    </group>
  );
}

useGLTF.preload(CHARACTER_URL);
useGLTF.preload(MOTION_LIBRARY_URL);

export default SidekickGameAvatar;
