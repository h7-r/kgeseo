/**
 * windShader.ts — ① 바랜 왜곡 안개 조각 · ③ 바람 흔들림 꼭짓점 셰이더 (옛 몰입연출.jsx 이식)
 *   ※ 셰이더 문자열에는 ASCII 만 쓴다(일부 드라이버가 주석의 한글도 거부한다).
 *
 * [옛 이름 → 새 이름]
 *   흔들림GLSL → WIND_GLSL · 흔들림입히기 → applyWind · 식물찾기 → findPlants
 *   식물이름 → PLANT_NAME · 식물아님 → NOT_PLANT · userData.wg바람 → userData.wgWind
 */
import * as THREE from "three";

import { IS_FOCUS_ENABLED } from "./focusFog";
import { windUniforms } from "./state";

// ── ① 바랜 왜곡: 안개 셰이더 — 멀수록 채도가 빠지며 안개색으로 ─────
//   후처리 없이 기존 안개 계산에 두 줄을 더한다(기준기 부담 0).
if (IS_FOCUS_ENABLED && !THREE.ShaderChunk.fog_fragment.includes("WG_DESAT")) {
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  // WG_DESAT
  float wgL = dot( gl_FragColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( wgL ), clamp( fogFactor * 1.6, 0.0, 1.0 ) * 0.8 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
}

// ── ③ 바람 흔들림 — 식물 재질에 꼭짓점 흔들림을 붙인다 ──
//   무리 이름(groupId)은 edits.json 열쇠라 한글 그대로다 — 여기 정규식도 그 값을 본다.
const PLANT_NAME = /나무|덤불|수풀|잎더미|풀|잡초|꽃|갈대|절벽머리/;
const NOT_PLANT = /^땅\.|풀이|흙/;
/** 흔들림 종류 — 풀·덤불은 통째로 · 나무 줄기는 밑동을 붙잡고 위만 · 나무 잎은 가지를 따라가며 따로 살랑인다 */
type WindKind = "plant" | "trunk" | "leaves";

const WIND_HEAD = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
vec3 wgBase = vec3( 0.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  wgBase = instanceMatrix[ 3 ].xyz;
#endif
float wgH = max( mvPosition.y - wgBase.y, 0.0 );
float wgP = uWindTime * 1.7 + wgBase.x * 0.21 + wgBase.z * 0.17;
float wgG = sin( wgP ) + 0.35 * sin( wgP * 2.7 + 1.3 );
`;
const WIND_TAIL = /* glsl */ `
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

// 풀·덤불 — 예전 그대로
const PLANT_GLSL = /* glsl */ `
{
  float wgS = 0.03 * wgH + 0.25 * min( wgH, 2.0 );
  mvPosition.x += uWindAmp * wgS * wgG;
  mvPosition.z += uWindAmp * wgS * 0.6 * cos( wgP * 0.8 );
  // leaf flutter (10/14): fast small shiver on the upper part so motion still reads while the player walks
  float wgL = clamp( wgH / 3.0, 0.0, 1.0 );
  float wgF = sin( uWindTime * 7.3 + dot( transformed, vec3( 3.1, 1.7, 2.3 ) ) ) + 0.5 * sin( uWindTime * 11.7 + transformed.y * 4.0 + wgBase.x );
  mvPosition.xyz += vec3( 1.0, 0.35, 0.8 ) * uWindAmp * 0.07 * wgL * wgF;
}
`;

// 나무 — 단위는 유닛(0.3 m). 줄기와 잎이 같은 식으로 휘어야 잎이 가지에서 안 떨어진다.
//   1) 굽은 줄기: 자리마다 다른 쪽 · 다른 세기로 위로 갈수록 휜다(밑동은 0) + 윗부분이 살짝 S 자
//   2) 바람: 밑동 2 m 는 붙잡고 그 위만 제곱으로 휜다 — 땅에 묻힌 밑동이 들려 보이지 않는다
const TREE_GLSL = /* glsl */ `
{
  float wgHash = fract( sin( dot( wgBase.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  float wgHash2 = fract( wgHash * 7.13 + 0.37 );
  float wgAng = wgHash * 6.2832;
  vec2 wgDir = vec2( cos( wgAng ), sin( wgAng ) );
  float wgBend = ( 0.002 + 0.005 * wgHash2 ) * wgH * min( wgH, 22.0 );
  float wgWave = sin( wgH * 0.2 + wgHash * 6.0 ) * 0.35 * clamp( ( wgH - 5.0 ) / 10.0, 0.0, 1.0 );
  mvPosition.xz += wgDir * wgBend + vec2( -wgDir.y, wgDir.x ) * wgWave;
  float wgW = max( wgH - 6.5, 0.0 );
  float wgSway = uWindAmp * 0.003 * wgW * min( wgW, 16.0 );
  mvPosition.x += wgSway * wgG;
  mvPosition.z += wgSway * 0.6 * cos( wgP * 0.8 );
}
`;
const LEAF_GLSL = /* glsl */ `
{
  // leaves: fast rustle on top of the branch sway, stronger toward the crown
  float wgL = clamp( ( wgH - 4.0 ) / 8.0, 0.0, 1.0 );
  float wgF = sin( uWindTime * 6.1 + dot( transformed, vec3( 3.1, 1.7, 2.3 ) ) * 2.0 ) + 0.6 * sin( uWindTime * 10.3 + transformed.y * 5.0 + wgBase.x );
  float wgR = sin( uWindTime * 2.3 + dot( transformed, vec3( 0.7, 0.3, 0.9 ) ) );
  mvPosition.xyz += vec3( 1.0, 0.45, 0.8 ) * ( 0.08 + uWindAmp * 0.16 ) * wgL * ( wgF * 0.6 + wgR * 0.4 );
}
`;

const WIND_GLSL: Record<WindKind, string> = {
  plant: WIND_HEAD + PLANT_GLSL + WIND_TAIL,
  trunk: WIND_HEAD + TREE_GLSL + WIND_TAIL,
  leaves: WIND_HEAD + TREE_GLSL + LEAF_GLSL + WIND_TAIL,
};

export function applyWind(m: THREE.Material | null | undefined, kind: WindKind = "plant") {
  if (!m || m.userData.wgWind || (m as THREE.ShaderMaterial).isShaderMaterial) return;
  m.userData.wgWind = kind;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = function (sh, r) {
    prev?.call(this, sh, r);
    if (!sh.vertexShader.includes("#include <project_vertex>")) return;
    sh.uniforms.uWindTime = windUniforms.uWindTime;
    sh.uniforms.uWindAmp = windUniforms.uWindAmp;
    sh.vertexShader =
      "uniform float uWindTime;\nuniform float uWindAmp;\n" +
      sh.vertexShader.replace("#include <project_vertex>", WIND_GLSL[kind]);
  };
  m.customProgramCacheKey = function () {
    return (prevKey ? prevKey.call(this) : "") + "|wgwind-" + kind;
  };
  m.needsUpdate = true;
}

/** 나무 재질은 잎(오려낸 잎 카드)과 줄기를 가른다 */
const TREE_NAME = /나무/;
const isLeafMaterial = (m: THREE.Material) => m.alphaTest > 0 || m.transparent;

/** 씬을 훑어 식물 재질에 흔들림을 붙인다. 새로 붙인 재질 수를 돌려준다. */
export function findPlants(scene: THREE.Scene) {
  let n = 0;
  scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const name = o.name || o.parent?.name || "";
    if (!PLANT_NAME.test(name) || NOT_PLANT.test(name.replace(/^AI허브:/, ""))) return;
    const mat = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mat) ? mat : [mat])
      if (m && !m.userData.wgWind) {
        applyWind(m, TREE_NAME.test(name) ? (isLeafMaterial(m) ? "leaves" : "trunk") : "plant");
        n++;
      }
  });
  return n;
}
