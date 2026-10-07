// 애니메이션풍(cel) 재질 — 런타임에서만 바꾼다. GLB 원본은 건드리지 않는다.
//   파이프라인이 Meshy 가 구운 PBR 텍스처를 기준으로 입을 지우고 색을 곱하므로, 재질을 GLB 에 구우면
//   그 작업이 전부 깨진다. BaseColor(map)만 물려받고 재질만 MeshToonMaterial 로 바꾼다.
// 얼굴은 몸과 같은 메시라 이름으로 못 가른다. head 본의 스킨 웨이트로 정점마다 '얼굴 정도'를 구해 넘긴다.
import * as THREE from "three";

import { isOutlineShell } from "./toonOutline";

export interface ToonConfig {
  enabled: boolean;
  /** 명암 계단 수(2 또는 3) */
  steps: number;
  /** 첫 계단이 꺾이는 밝기 */
  threshold: number;
  rimStrength: number;
  rimWidth: number;
  /** 1 = 얼굴 법선을 완전히 구로 눕힘 */
  faceFlatten: number;
  /** 머리카락 하이라이트 띠 세기 */
  hairShine: number;
  /** 명암 계단 경계를 이 폭만큼 이어 준다(0 = 딱 떨어지는 cel) */
  softness?: number;
}

/** 재질 갈래 — 몸(cel + rim + 얼굴 눕힘), 머리(하이라이트 띠), 그 밖(옷) */
export type ToonPartKind = "body" | "hair" | "cloth";

export type ToonPartClassifier = (object: THREE.Object3D) => ToonPartKind;

export const DEFAULT_TOON: ToonConfig = {
  enabled: true,
  steps: 3,
  threshold: 0.5,
  rimStrength: 0.28,
  rimWidth: 3.2,
  // 0.85 면 얼굴 법선이 거의 구가 되어 그림자 없이 환하기만 했다. 이목구비 음영이 남을 만큼만 눕힌다.
  faceFlatten: 0.4,
  hairShine: 0.35,
  softness: 0,
};

// 계단 수·경계가 같으면 캐릭터가 몇이든 텍스처 하나를 같이 쓴다.
const gradientCache = new Map<string, THREE.DataTexture>();

/**
 * 툰 명암 계단 텍스처.
 * softness 를 주면 계단 경계를 잇는다 — 낮은 폴리곤에서는 경계가 삼각형 모서리를 따라 톱니로 보여
 * 캐릭터를 크게 보는 생성 화면만 조금 푼다. 게임은 0 그대로다.
 */
export function toonGradientMap(steps: number, threshold: number, softness = 0): THREE.DataTexture {
  const key = `${steps}:${threshold.toFixed(3)}:${softness.toFixed(3)}`;
  const cached = gradientCache.get(key);
  if (cached) return cached;
  const width = 256;
  const data = new Uint8Array(width);
  const levels = steps <= 2 ? [0.42, 1.0] : [0.36, 0.68, 1.0];
  const edges = steps <= 2 ? [threshold] : [threshold * 0.72, threshold];
  const smooth = (a: number, b: number, t: number) => a + (b - a) * (t * t * (3 - 2 * t));
  for (let i = 0; i < width; i += 1) {
    const x = i / (width - 1);
    let value = levels[0];
    edges.forEach((edge, k) => {
      if (softness <= 0) {
        if (x >= edge) value = levels[k + 1];
      } else {
        const t = Math.min(1, Math.max(0, (x - (edge - softness / 2)) / softness));
        value = smooth(value, levels[k + 1], t);
      }
    });
    data[i] = Math.round(value * 255);
  }
  const map = new THREE.DataTexture(data, width, 1, THREE.RedFormat);
  const filter = softness > 0 ? THREE.LinearFilter : THREE.NearestFilter;
  map.magFilter = filter;
  map.minFilter = filter;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  gradientCache.set(key, map);
  return map;
}

// 셰이더 문자열 안에는 한글을 넣지 않는다 — 일부 드라이버는 주석의 한글도 거부한다.
const VERTEX_DECLARATIONS = `
attribute float _face;
attribute float _tint;
varying float v_tint;
varying float v_cloth;
varying float v_bottom;
uniform vec3 _headCentre;
uniform float _faceFlatten;
varying float v_face;
varying vec3 v_viewNormal;
`;
const VERTEX_NORMAL = `
  v_face = _face;
  v_tint = _tint;
  // interpolate "is cloth" and "is bottom" separately (1->3 would pass through 2 = top)
  v_cloth = _tint > 1.5 ? 1.0 : 0.0;
  v_bottom = _tint > 2.5 ? 1.0 : 0.0;
  if (_face > 0.001 && _faceFlatten > 0.001) {
    vec3 sphere = normalize(position - _headCentre);
    objectNormal = normalize(mix(objectNormal, sphere, _face * _faceFlatten));
  }
`;
const FRAGMENT_DECLARATIONS = `
uniform vec3 _skinTint;
uniform vec3 _clothTint;
uniform vec3 _bottomTint;
varying float v_tint;
varying float v_cloth;
varying float v_bottom;
uniform float _rimPower;
uniform float _rimStrength;
uniform float _hairBand;
varying float v_face;
varying vec3 v_viewNormal;
`;
const FRAGMENT_FINISH = `
  vec3 viewDir = normalize(vViewPosition);
  float rim = pow(clamp(1.0 - dot(normalize(vNormal), viewDir), 0.0, 1.0), _rimPower);
  gl_FragColor.rgb += rim * _rimStrength * (1.0 - 0.6 * v_face);
  if (_hairBand > 0.001) {
    float band = smoothstep(0.62, 0.70, normalize(vNormal).y) - smoothstep(0.80, 0.90, normalize(vNormal).y);
    gl_FragColor.rgb += band * _hairBand;
  }
`;
// 살빛과 옷 색을 정점 표식으로 따로 곱한다(몸과 옷이 한 메시). 흰자·이도 피부 표식 안이라
// 살빛에 물드는데, 흰자는 밝고 무채색이라 그만큼(sclera) 살빛을 걷어 낸다.
const FRAGMENT_TINT = `#include <map_fragment>
  // 2 = top, 3 = bottom
  if (v_cloth > 0.5) diffuseColor.rgb *= (v_bottom > 0.5 * v_cloth) ? _bottomTint : _clothTint;
  else if (v_tint > 0.5) {
    float lum = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
    float sat = lum - min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
    float sclera = smoothstep(0.60, 0.84, lum) * (1.0 - smoothstep(0.05, 0.13, sat));
    diffuseColor.rgb *= mix(_skinTint, vec3(1.0), sclera);
  }`;

export interface ToonUniforms {
  _headCentre: THREE.IUniform<THREE.Vector3>;
  _faceFlatten: THREE.IUniform<number>;
  _rimPower: THREE.IUniform<number>;
  _rimStrength: THREE.IUniform<number>;
  _hairBand: THREE.IUniform<number>;
  _skinTint: THREE.IUniform<THREE.Color>;
  _clothTint: THREE.IUniform<THREE.Color>;
  /** 하의 색 — 표식 3(naju01/tools 의 하의 표식 굽기가 넣는다) */
  _bottomTint: THREE.IUniform<THREE.Color>;
}

interface ToonUniformEntry {
  uniforms: ToonUniforms;
  kind: ToonPartKind;
}

interface ToonBuildConfig extends ToonConfig {
  headCentre: THREE.Vector3;
}

/**
 * 툰 재질의 userData 열쇠. 세계 툰은 이 표식이 있는 재질(캐릭터)을 건너뛴다.
 * 원본 재질은 `TOON_SOURCE_KEY` 에 남겨 둔다(툰 위에 툰을 겹치지 않게).
 */
export const TOON_UNIFORMS_KEY = "toonUniforms";
const TOON_SOURCE_KEY = "toonSource";
// 우리가 채운 빈 _tint 를 GLB 가 준 것으로 오해하지 않게 남기는 표식.
const EMPTY_TINT_KEY = "emptyTint";

function patchShader(material: THREE.MeshToonMaterial, config: ToonBuildConfig, kind: ToonPartKind): ToonUniforms {
  const uniforms: ToonUniforms = {
    _headCentre: { value: config.headCentre },
    _faceFlatten: { value: kind === "body" ? config.faceFlatten : 0 },
    _rimPower: { value: config.rimWidth },
    _rimStrength: { value: config.rimStrength },
    _hairBand: { value: kind === "hair" ? config.hairShine : 0 },
    _skinTint: { value: new THREE.Color(1, 1, 1) },
    _clothTint: { value: new THREE.Color(1, 1, 1) },
    _bottomTint: { value: new THREE.Color(1, 1, 1) },
  };
  material.userData[TOON_UNIFORMS_KEY] = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>\n${VERTEX_NORMAL}`)
      .replace(
        "#include <defaultnormal_vertex>",
        `#include <defaultnormal_vertex>\n  v_viewNormal = transformedNormal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace("#include <map_fragment>", FRAGMENT_TINT)
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>\n${FRAGMENT_FINISH}`);
  };
  // three 는 onBeforeCompile 소스로 프로그램을 캐시한다. 갈래가 다르면 키도 달라야
  // 몸 셰이더가 머리에 재사용되지 않는다(그 탓에 의상이 통째로 사라진 적이 있다).
  material.customProgramCacheKey = () =>
    `toon:${kind}:${config.steps}:${config.threshold}:${config.softness ?? 0}:sclera`;
  return uniforms;
}

// ── 살결/옷 가르기 ──
// 몸과 옷은 한 메시라 정점 표식 `_tint` 로 가른다: 0 = 그대로, 1 = 피부, 2 = 상의, 3 = 하의.
// 표식은 모델을 구울 때 넣어야 한다 — 아틀라스 여백이 살빛이라 런타임에 텍스처로 추정하면
// 셔츠 정점도 살빛이 나온다. 표식이 없으면 색을 곱하지 않고 아바타가 메시 단위로 칠한다.
function hasTintAttribute(mesh: THREE.Mesh): boolean {
  const geometry = mesh.geometry;
  // StrictMode 의 두 번째 효과에서 우리가 채운 빈 표식을 GLB 것으로 오해하면 색칠이 통째로 죽는다.
  if (geometry.getAttribute("_tint")) return !geometry.userData[EMPTY_TINT_KEY];
  addEmptyTint(geometry);
  return false;
}

function addEmptyTint(geometry: THREE.BufferGeometry) {
  if (geometry.getAttribute("_tint")) return;
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("_tint", new THREE.BufferAttribute(new Float32Array(count), 1));
  geometry.userData[EMPTY_TINT_KEY] = true;
}

// head 본에 매달린 정도를 정점 속성으로 굽는다. 지오메트리당 한 번만 한다.
function addFaceWeights(mesh: THREE.SkinnedMesh): boolean {
  const geometry = mesh.geometry;
  if (geometry.getAttribute("_face")) return true;
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  const bones = mesh.skeleton?.bones;
  if (!skinIndex || !skinWeight || !bones) return false;
  const head = bones.findIndex((bone) => bone.name === "head");
  if (head < 0) return false;
  const out = new Float32Array(skinIndex.count);
  for (let i = 0; i < skinIndex.count; i += 1) {
    let sum = 0;
    for (let k = 0; k < 4; k += 1) {
      if (skinIndex.getComponent(i, k) === head) sum += skinWeight.getComponent(i, k);
    }
    out[i] = sum;
  }
  geometry.setAttribute("_face", new THREE.BufferAttribute(out, 1));
  return true;
}

function addEmptyFaceWeights(geometry: THREE.BufferGeometry) {
  if (geometry.getAttribute("_face")) return;
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("_face", new THREE.BufferAttribute(new Float32Array(count), 1));
}

/** 원본 재질에서 쓰는 필드만 — 어느 three 재질이든 이 중 있는 것만 물려받는다. */
interface SourceMaterialFields {
  map?: THREE.Texture | null;
  color?: THREE.Color;
  alphaMap?: THREE.Texture | null;
  emissive?: THREE.Color;
  emissiveMap?: THREE.Texture | null;
}

// 지키는 것: BaseColor·색·투명·알파컷·side·정점색. 버리는 것: normal/roughness/metalness/env(PBR 질감의 정체).
function createToonMaterial(
  source: THREE.Material,
  config: ToonBuildConfig,
  kind: ToonPartKind,
): { material: THREE.MeshToonMaterial; uniforms: ToonUniforms } {
  const fields = source as THREE.Material & SourceMaterialFields;
  const material = new THREE.MeshToonMaterial({
    map: fields.map ?? null,
    color: fields.color ? fields.color.clone() : new THREE.Color(0xffffff),
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    alphaMap: fields.alphaMap ?? null,
    side: source.side,
    vertexColors: source.vertexColors,
    depthWrite: source.depthWrite,
    depthTest: source.depthTest,
    emissive: fields.emissive ? fields.emissive.clone() : new THREE.Color(0x000000),
    emissiveMap: fields.emissiveMap ?? null,
    gradientMap: toonGradientMap(config.steps, config.threshold, config.softness ?? 0),
  });
  material.name = `${source.name || "material"}_toon`;
  const uniforms = patchShader(material, config, kind);
  return { material, uniforms };
}

export interface ToonTint {
  skin?: string;
  cloth?: string;
  bottom?: string;
}

export interface ToonHandle {
  /** 원본 재질로 되돌리고 툰 재질을 버린다 */
  restore: () => void;
  uniforms: ToonUniforms[];
  /** 재질을 다시 만들지 않고 림·얼굴·머리광만 바꾼다 */
  update: (next: ToonConfig) => void;
  /** 피부·의상 색을 uniform 으로만 바꾼다 */
  tint: (colors: ToonTint) => void;
  /** 정점 표식이 있는 메시가 하나라도 있나. 없으면 아바타가 메시 단위 색칠로 돌아간다. */
  hasTintMarks: boolean;
}

interface InstalledMaterials {
  object: THREE.Mesh;
  material: THREE.Material | THREE.Material[];
  installed: THREE.Material | THREE.Material[];
  created: THREE.MeshToonMaterial[];
}

/** root 아래 메시를 전부 툰 재질로 바꾼다. */
export function applyToon(
  root: THREE.Object3D,
  classify: ToonPartClassifier,
  config: ToonConfig = DEFAULT_TOON,
): ToonHandle {
  const headCentre = new THREE.Vector3();
  const installed: InstalledMaterials[] = [];
  const entries: ToonUniformEntry[] = [];
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && !isOutlineShell(object)) meshes.push(object);
  });
  // 머리 본 위치를 메시 로컬 좌표로 — 얼굴 법선을 눕힐 중심이다.
  const headSkin = meshes.find(
    (mesh): mesh is THREE.SkinnedMesh => mesh instanceof THREE.SkinnedMesh && !!mesh.skeleton?.getBoneByName("head"),
  );
  const headBone = headSkin?.skeleton.getBoneByName("head");
  if (headSkin && headBone) {
    headBone.updateMatrixWorld(true);
    headCentre.setFromMatrixPosition(headBone.matrixWorld);
    headSkin.updateMatrixWorld(true);
    headSkin.worldToLocal(headCentre);
    // 본은 턱 밑에 있어 머리 한가운데가 되도록 살짝 올린다.
    headCentre.y += 0.06;
  }
  const buildConfig: ToonBuildConfig = { ...config, headCentre };
  let hasTintMarks = false;
  meshes.forEach((object) => {
    const kind = classify(object) ?? "cloth";
    if (!(object instanceof THREE.SkinnedMesh && addFaceWeights(object))) addEmptyFaceWeights(object.geometry);
    if (kind === "hair") addEmptyTint(object.geometry);
    else if (hasTintAttribute(object)) hasTintMarks = true;
    const current: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
    // 이미 툰이 붙어 있으면 그 툰의 원본에서 다시 만든다(툰 위에 툰을 겹치지 않는다).
    const sources = current.map((m) => (m.userData?.[TOON_SOURCE_KEY] as THREE.Material | undefined) ?? m);
    const created = sources.map((source) => {
      const { material, uniforms } = createToonMaterial(source, buildConfig, kind);
      material.userData[TOON_SOURCE_KEY] = source;
      entries.push({ uniforms, kind });
      return material;
    });
    const install = Array.isArray(object.material) ? created : created[0];
    installed.push({
      object,
      material: Array.isArray(object.material) ? sources : sources[0],
      installed: install,
      created,
    });
    object.material = install;
  });
  // 내가 붙인 재질이 아직 붙어 있을 때만 원본으로 돌린다.
  //   StrictMode 의 떼기는 두 프레임 미뤄지는데, 그 사이 다시 붙은 두 번째 툰을 지우면
  //   첫 캐릭터만 툰이 아니게 되고 상의 색이 아예 안 먹었다.
  const restore = () => {
    installed.forEach(({ object, material, installed: install, created }) => {
      if (object.material === install) object.material = material;
      created.forEach((m) => m.dispose());
    });
    installed.length = 0;
  };
  const update = (next: ToonConfig) => {
    entries.forEach(({ uniforms, kind }) => {
      uniforms._rimStrength.value = next.rimStrength;
      uniforms._rimPower.value = next.rimWidth;
      uniforms._faceFlatten.value = kind === "body" ? next.faceFlatten : 0;
      uniforms._hairBand.value = kind === "hair" ? next.hairShine : 0;
    });
  };
  const tint = ({ skin, cloth, bottom }: ToonTint) => {
    entries.forEach(({ uniforms, kind }) => {
      if (kind === "hair") return;
      if (skin) uniforms._skinTint.value.set(skin);
      if (cloth) uniforms._clothTint.value.set(cloth);
      uniforms._bottomTint.value.set(bottom ?? cloth ?? "#ffffff");
    });
  };
  return { restore, uniforms: entries.map((entry) => entry.uniforms), update, tint, hasTintMarks };
}
