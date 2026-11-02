/**
 * 「칠한 툰」 — 만화 화풍일 때 본편 툰 재질을 나주맵 세계 재질처럼 바꾼다.
 * 나주 세계는 꼭짓점 색 몇 가지 + 각진 면 + 3단 계단이라 면마다 색이 몇 개뿐이다. 본편은 같은 툰 재질이지만
 * 캔버스 텍스처(벽돌 결·얼룩·잡티)가 사진처럼 촘촘하고, 스탠드·천장등 빛이 거리로 매끈하게 줄어든다.
 *   ① 텍스처  잔결 펴기 — 텍스처마다 한 번 굽는다(textureFlatten.ts)
 *   ② 명암    나주 계단 + 붓 기울기 — 공용 계단 텍스처에 굽는다(engine/toon.ts setToonRamp)
 *   ③ 그림자  그림자 속은 간접광만 남는다 — 간접광에 색을 입혀 검은 그림자 대신 물든 그림자로   ← 이 파일
 *   ④ 빛 계단 거리로 줄어드는 빛을 몇 칸의 칠로 끊는다 — 나주의 해 하나 아래 평평한 면처럼        ← 이 파일
 *   ⑤ 밝은 조  팔레트를 입힌 구역만 — 픽셀의 빛 양을 [그림자밝기 … 1] 로 접는다. 나주처럼 그늘도 바탕의 절반쯤 밝고,
 *             스탠드 웅덩이는 그 위에 조금만 더 밝다. 빛(팀 값)은 그대로라 불 꺼진 복도 퍼즐 같은 다른 구역은 안 바뀐다 ← 이 파일
 *   ⑦ 빛 중성  빛 색(크림색 등)은 버리고 밝기만 — 실내 전체가 노랗게 물들지 않게
 *   ⑥ 붓 얼룩  넓은 면에 아주 낮은 주파수로 밝기를 조금씩 흔든다(세계 좌표라 걸어도 흐르지 않는다) — 손으로 칠한 느낌
 * ③④⑥ 는 픽셀마다 한 번(빛마다가 아니라) 도는 셈이라 싸다. 빛마다 도는 계단 함수는 건드리지 않는다 —
 * 거기에 셈을 넣었더니 스탠드가 많은 본부실이 빛 수만큼 느려졌다.
 * 값은 모든 재질이 한 유니폼을 같이 쓴다 → Leva 를 움직여도 재컴파일이 없다. uMangaPaint 0 이면 원래 식 그대로다.
 * ※ 셰이더 문자열에는 ASCII 만.
 */
import * as THREE from "three";

export const paintedUniforms = {
  /** 0 = 원래 재질, 1 = 칠한 툰 */
  uMangaPaint: { value: 1 },
  /** 그림자 속(간접광)에 곱하는 색 */
  uMangaAmbient: { value: new THREE.Vector3(1, 1, 1) },
  /** 빛의 양을 끊는 칸 수(밝기의 제곱근 기준). 0 = 끊지 않는다 */
  uMangaBands: { value: 0 },
  /** 붓 얼룩 세기 — 밝기를 ±이만큼 흔든다 */
  uMangaBrush: { value: 0 },
  /** 빛 색 중성화 0~1 — 크림색 천장등·스탠드 빛이 모든 면을 노랗게 물들이지 않게 밝기만 남긴다 */
  uMangaNeutral: { value: 0 },
};

/** 밝은 조 값 — 모든 구역이 같이 쓴다. 켜고 끄기(uKeyOn)는 구역마다 따로(zoneKeyUniforms) */
export const highKeyUniforms = {
  /** 그늘의 밝기(바탕 대비) — 나주는 그늘 쪽이 바탕의 절반쯤 */
  uKeyFloor: { value: 0.5 },
  /** 이 빛 양이 바탕 그대로(1)가 된다 */
  uKeyRef: { value: 1.3 },
  /** 그보다 센 빛(스탠드 웅덩이)이 더 밝아지는 최대치 */
  uKeyTop: { value: 0.25 },
};
const KEY_OFF = { uKeyOn: { value: 0 }, uKeyFloor: { value: 1 }, uKeyRef: { value: 1 }, uKeyTop: { value: 0 } };

const zoneKeys = new Map<string, typeof KEY_OFF>();
/**
 * 구역 하나의 밝은 조 유니폼 — 켬 여부만 구역 것, 값은 함께 쓴다. 복도처럼 나중에 켜지는 구역도
 * 재질을 다시 컴파일하지 않고 uKeyOn 만 바꾼다.
 */
export function zoneKeyUniforms(zone: string) {
  let uniforms = zoneKeys.get(zone);
  if (!uniforms) {
    uniforms = { ...highKeyUniforms, uKeyOn: { value: 0 } };
    zoneKeys.set(zone, uniforms);
  }
  return uniforms;
}

const DECLARATIONS = /* glsl */ `
uniform float uMangaPaint;
uniform vec3 uMangaAmbient;
uniform float uMangaBands;
uniform float uMangaBrush;
uniform float uMangaNeutral;
varying vec3 vMgWorld;
// cheap smooth value noise (world units) - low frequency brush variation
// sin-free hash (Hoskins) - sin is the expensive part on mobile and integrated GPUs
float mgHash( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
float mgNoise( vec3 p ) {
  vec3 i = floor( p ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( mgHash( i ), mgHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( mgHash( i + vec3( 0, 1, 0 ) ), mgHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( mgHash( i + vec3( 0, 0, 1 ) ), mgHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( mgHash( i + vec3( 0, 1, 1 ) ), mgHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
uniform float uKeyOn;
uniform float uKeyFloor;
uniform float uKeyRef;
uniform float uKeyTop;
`;

const LIGHT_FINISH = /* glsl */ `
#include <lights_fragment_end>
if ( uMangaPaint > 0.0 ) {
  reflectedLight.indirectDiffuse *= uMangaAmbient;
  // light amount = lit colour / surface colour
  vec3 mgLit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  float mgAlbedo = max( dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ), 0.02 );
  float mgAmount = dot( mgLit, vec3( 0.299, 0.587, 0.114 ) ) / mgAlbedo;
  float mgTarget = mgAmount;
  if ( uKeyOn > 0.0 ) {
    // high key: fold the light amount into [floor .. 1], strong lamp pools add a little on top
    float mgOver = max( mgAmount - uKeyRef, 0.0 ) / uKeyRef;
    float mgKey = mix( uKeyFloor, 1.0, clamp( mgAmount / uKeyRef, 0.0, 1.0 ) ) + uKeyTop * ( 1.0 - exp( -mgOver ) );
    mgTarget = mix( mgAmount, mgKey, uKeyOn );
  }
  if ( uMangaBands > 0.0 ) {
    // banded in sqrt space
    float mgS = sqrt( max( mgTarget, 0.0 ) ) * uMangaBands;
    // wide soft edge - a hard edge turns the dithered PCF penumbra into dotted, stair-stepped contours
    float mgBanded = ( floor( mgS ) + smoothstep( 0.2, 0.8, fract( mgS ) ) ) / uMangaBands;
    mgTarget = mgBanded * mgBanded;
  }
  float mgScale = mgAmount > 1e-4 ? mgTarget / mgAmount : 1.0;
  if ( uMangaNeutral > 0.0 ) {
    // keep each light term's brightness, drop its hue - surfaces show their own colour, not the bulb's cream
    vec3 mgW = vec3( 0.299, 0.587, 0.114 );
    vec3 mgBase = diffuseColor.rgb / mgAlbedo;
    reflectedLight.directDiffuse = mix( reflectedLight.directDiffuse, mgBase * dot( reflectedLight.directDiffuse, mgW ), uMangaNeutral );
    reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, mgBase * dot( reflectedLight.indirectDiffuse, mgW ), uMangaNeutral );
  }
  if ( uMangaBrush > 0.0 ) {
    float mgN = mgNoise( vMgWorld * 0.3 ); // one low octave - big painted patches, no fine speckle
    mgScale *= 1.0 + uMangaBrush * ( mgN - 0.5 ) * 2.0;
  }
  reflectedLight.directDiffuse *= mgScale;
  reflectedLight.indirectDiffuse *= mgScale;
}
`;

const PAINTED_KEY = "mangaPainted";

const WORLD_VARYING = /* glsl */ `
#include <project_vertex>
#ifdef USE_INSTANCING
  vMgWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
#else
  vMgWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#endif
`;

function injectPainted(shader: THREE.WebGLProgramParametersWithUniforms, zone: string | null) {
  Object.assign(shader.uniforms, paintedUniforms, zone ? zoneKeyUniforms(zone) : KEY_OFF);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vMgWorld;")
    .replace("#include <project_vertex>", WORLD_VARYING);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${DECLARATIONS}`)
    .replace("#include <lights_fragment_end>", LIGHT_FINISH);
}

/**
 * 툰 재질 하나에 칠한 툰을 건다. 이미 건 재질은 건너뛴다. 다음 컴파일부터 먹는다.
 * zone = 재질이 든 팔레트 구역(밝은 조를 받는다). 처음 건 때 정해진다 — 구역을 먼저 훑는다.
 */
export function paintToonMaterial(material: THREE.MeshToonMaterial, zone: string | null = null) {
  if (material.userData[PAINTED_KEY]) return false;
  material.userData[PAINTED_KEY] = true;
  material.onBeforeCompile = (shader) => injectPainted(shader, zone);
  // 같은 정의끼리는 프로그램 하나를 같이 쓴다
  material.customProgramCacheKey = () => PAINTED_KEY;
  material.needsUpdate = true;
  return true;
}
