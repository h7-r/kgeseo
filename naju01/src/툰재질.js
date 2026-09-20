// 애니메이션풍(cel) 재질 — 런타임에서만 바꾼다. GLB 원본은 건드리지 않는다.
//
// [왜 런타임인가]
//   모델은 Meshy가 구운 PBR 텍스처를 그대로 쓰고, 파이프라인은 그 텍스처를 기준으로
//   입을 지우거나 색을 곱한다. 재질을 GLB에 구워 넣으면 그 작업들이 전부 깨진다.
//   그래서 BaseColor(map)만 그대로 물려받고 재질만 MeshToonMaterial 로 갈아 끼운다.
//   원본 재질은 남겨 두고 되돌리기 함수를 돌려주므로 A/B 비교가 가능하다.
//
// [세 갈래]
//   몸  — 기본 cel + rim
//   얼굴 — 코·눈두덩 그림자를 없애려고 법선을 머리 구(球) 쪽으로 눕힌다
//   머리 — highlight band 를 한 줄 넣는다
//   얼굴은 몸과 같은 메시라 이름으로 못 가른다. head 본의 스킨 웨이트로 정점마다
//   '얼굴 정도'를 구해 셰이더에 넘긴다(잘못 칠할 일이 없다).
import * as THREE from "three";

export const 기본툰 = {
  켬: true,
  단계: 3, // 명암 계단 수 (2 또는 3)
  경계: 0.5, // 첫 계단이 꺾이는 밝기
  림세기: 0.28,
  림폭: 3.2,
  얼굴평탄: 0.85, // 1 = 얼굴 법선을 완전히 구로 눕힘
  머리광: 0.35, // 머리카락 하이라이트 띠 세기
};

// ── 그라디언트 맵 ────────────────────────────────────────────
// 계단 수·경계가 같으면 캐릭터가 몇이든 텍스처 하나를 같이 쓴다.
const 맵캐시 = new Map();

export function 그라디언트맵(단계, 경계) {
  const key = `${단계}:${경계.toFixed(3)}`;
  if (맵캐시.has(key)) return 맵캐시.get(key);
  const 폭 = 64;
  const data = new Uint8Array(폭);
  for (let i = 0; i < 폭; i += 1) {
    const x = i / (폭 - 1);
    // 경계를 기준으로 계단을 나눈다. 어두운 칸은 너무 까맣지 않게 바닥을 올린다.
    const 칸 = 단계 <= 2
      ? (x < 경계 ? 0 : 1)
      : (x < 경계 * 0.72 ? 0 : x < 경계 ? 1 : 2);
    const 값 = 단계 <= 2 ? [0.42, 1.0][칸] : [0.36, 0.68, 1.0][칸];
    data[i] = Math.round(값 * 255);
  }
  const map = new THREE.DataTexture(data, 폭, 1, THREE.RedFormat);
  map.magFilter = THREE.NearestFilter; // 경계가 흐려지면 cel 이 아니다
  map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  맵캐시.set(key, map);
  return map;
}

// ── 셰이더 덧칠 ──────────────────────────────────────────────
// 얼굴: 법선을 머리 중심에서 뻗어 나가는 방향으로 눕힌다.
// 머리: 뷰 기준 높이에 밝은 띠 하나.
// 몸통 공통: rim light.
const 정점_선언 = `
attribute float _face;
uniform vec3 _headCentre;
uniform float _faceFlatten;
varying float v_face;
varying vec3 v_viewNormal;
`;
const 정점_법선 = `
  v_face = _face;
  if (_face > 0.001 && _faceFlatten > 0.001) {
    vec3 sphere = normalize(position - _headCentre);
    objectNormal = normalize(mix(objectNormal, sphere, _face * _faceFlatten));
  }
`;
const 조각_선언 = `
uniform float _rimPower;
uniform float _rimStrength;
uniform float _hairBand;
varying float v_face;
varying vec3 v_viewNormal;
`;
const 조각_마감 = `
  vec3 viewDir = normalize(vViewPosition);
  float rim = pow(clamp(1.0 - dot(normalize(vNormal), viewDir), 0.0, 1.0), _rimPower);
  gl_FragColor.rgb += rim * _rimStrength * (1.0 - 0.6 * v_face);
  if (_hairBand > 0.001) {
    // 뷰 기준 위쪽을 향하는 면에 띠 하나 — 가닥 반사 대신 큰 덩어리를 강조한다.
    float band = smoothstep(0.62, 0.70, normalize(vNormal).y) - smoothstep(0.80, 0.90, normalize(vNormal).y);
    gl_FragColor.rgb += band * _hairBand;
  }
`;

function 셰이더덧칠(material, 설정, 갈래) {
  const uniforms = {
    // 갈래는 uniform 이 아니라 표식이다(갱신할 때 몸/머리를 가른다).
    _headCentre: { value: 설정.머리중심 ?? new THREE.Vector3() },
    _faceFlatten: { value: 갈래 === "body" ? 설정.얼굴평탄 : 0 },
    _rimPower: { value: 설정.림폭 },
    _rimStrength: { value: 설정.림세기 },
    _hairBand: { value: 갈래 === "hair" ? 설정.머리광 : 0 },
  };
  uniforms.갈래 = 갈래;
  material.userData.툰유니폼 = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${정점_선언}`)
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>\n${정점_법선}`)
      .replace("#include <defaultnormal_vertex>", `#include <defaultnormal_vertex>\n  v_viewNormal = transformedNormal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${조각_선언}`)
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>\n${조각_마감}`);
  };
  // three 는 onBeforeCompile 의 소스로 프로그램을 캐시한다. 갈래가 다르면 키도 달라야
  // 몸 셰이더가 머리에 재사용되지 않는다(예전에 이걸로 의상이 통째로 사라진 적이 있다).
  material.customProgramCacheKey = () => `툰:${갈래}:${설정.단계}:${설정.경계}`;
}

// ── 얼굴 가중치 ──────────────────────────────────────────────
// head 본에 매달린 정도를 정점 속성으로 굽는다. 지오메트리당 한 번만 한다.
function 얼굴속성(mesh) {
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

function 빈얼굴속성(geometry) {
  if (geometry.getAttribute("_face")) return;
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("_face", new THREE.BufferAttribute(new Float32Array(count), 1));
}

// ── 변환 ─────────────────────────────────────────────────────
// 원본 재질에서 지켜야 할 것: BaseColor, 색, 투명·알파컷, side, 정점색.
// 버리는 것: normal/roughness/metalness/env — 이것들이 PBR 질감의 정체다.
function 툰재질(원본, 설정, 갈래) {
  const material = new THREE.MeshToonMaterial({
    map: 원본.map ?? null,
    color: 원본.color ? 원본.color.clone() : new THREE.Color(0xffffff),
    transparent: 원본.transparent,
    opacity: 원본.opacity,
    alphaTest: 원본.alphaTest,
    alphaMap: 원본.alphaMap ?? null,
    side: 원본.side,
    vertexColors: 원본.vertexColors,
    depthWrite: 원본.depthWrite,
    depthTest: 원본.depthTest,
    emissive: 원본.emissive ? 원본.emissive.clone() : new THREE.Color(0x000000),
    emissiveMap: 원본.emissiveMap ?? null,
    gradientMap: 그라디언트맵(설정.단계, 설정.경계),
  });
  material.name = `${원본.name || "재질"}_툰`;
  셰이더덧칠(material, 설정, 갈래);
  return material;
}

/**
 * root 아래 메시를 전부 툰 재질로 바꾼다.
 * @param {THREE.Object3D} root
 * @param {(object:THREE.Mesh)=>"body"|"hair"|"cloth"} 갈래정하기
 * @param {object} 설정
 * @returns {{되돌리기:Function, 유니폼:Array, 갱신:Function}}
 */
export function 툰적용(root, 갈래정하기, 설정 = 기본툰) {
  const 머리중심 = new THREE.Vector3();
  const 원래 = [];
  const 유니폼 = [];
  const 대상 = [];
  root.traverse((object) => {
    if (object.isMesh) 대상.push(object);
  });
  // 머리 본 위치를 메시 로컬 좌표로 — 얼굴 법선을 눕힐 중심이다.
  const 스킨 = 대상.find((o) => o.isSkinnedMesh && o.skeleton?.getBoneByName("head"));
  if (스킨) {
    const head = 스킨.skeleton.getBoneByName("head");
    head.updateMatrixWorld(true);
    머리중심.setFromMatrixPosition(head.matrixWorld);
    스킨.updateMatrixWorld(true);
    스킨.worldToLocal(머리중심);
    // 머리 한가운데가 되도록 살짝 올린다(본은 턱 밑에 있다).
    머리중심.y += 0.06;
  }
  const 값 = { ...설정, 머리중심 };
  대상.forEach((object) => {
    const 갈래 = 갈래정하기(object) ?? "cloth";
    if (!(object.isSkinnedMesh && 얼굴속성(object))) 빈얼굴속성(object.geometry);
    const 목록 = Array.isArray(object.material) ? object.material : [object.material];
    const 새것 = 목록.map((원본) => {
      const material = 툰재질(원본, 값, 갈래);
      유니폼.push(material.userData.툰유니폼);
      return material;
    });
    원래.push({ object, material: object.material });
    object.material = Array.isArray(object.material) ? 새것 : 새것[0];
  });
  const 되돌리기 = () => {
    원래.forEach(({ object, material }) => {
      const 지금 = Array.isArray(object.material) ? object.material : [object.material];
      지금.forEach((m) => m.dispose());
      object.material = material;
    });
    원래.length = 0;
  };
  const 갱신 = (다음) => {
    유니폼.forEach((u) => {
      u._rimStrength.value = 다음.림세기;
      u._rimPower.value = 다음.림폭;
      u._faceFlatten.value = u.갈래 === "body" ? 다음.얼굴평탄 : 0;
      u._hairBand.value = u.갈래 === "hair" ? 다음.머리광 : 0;
    });
  };
  return { 되돌리기, 유니폼, 갱신, 재질: 원래.map(({ object }) => object.material) };
}
