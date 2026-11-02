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
const WIND_GLSL = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
vec3 wgBase = vec3( 0.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  wgBase = instanceMatrix[ 3 ].xyz;
#endif
{
  float wgH = max( mvPosition.y - wgBase.y, 0.0 );
  float wgS = 0.03 * wgH + 0.25 * min( wgH, 2.0 );
  float wgP = uWindTime * 1.7 + wgBase.x * 0.21 + wgBase.z * 0.17;
  float wgG = sin( wgP ) + 0.35 * sin( wgP * 2.7 + 1.3 );
  mvPosition.x += uWindAmp * wgS * wgG;
  mvPosition.z += uWindAmp * wgS * 0.6 * cos( wgP * 0.8 );
  // leaf flutter (10/14): fast small shiver on the upper part so motion still reads while the player walks
  float wgL = clamp( wgH / 3.0, 0.0, 1.0 );
  float wgF = sin( uWindTime * 7.3 + dot( transformed, vec3( 3.1, 1.7, 2.3 ) ) ) + 0.5 * sin( uWindTime * 11.7 + transformed.y * 4.0 + wgBase.x );
  mvPosition.xyz += vec3( 1.0, 0.35, 0.8 ) * uWindAmp * 0.07 * wgL * wgF;
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

export function applyWind(m: THREE.Material | null | undefined) {
  if (!m || m.userData.wgWind || (m as THREE.ShaderMaterial).isShaderMaterial) return;
  m.userData.wgWind = true;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = function (sh, r) {
    prev?.call(this, sh, r);
    if (!sh.vertexShader.includes("#include <project_vertex>")) return;
    sh.uniforms.uWindTime = windUniforms.uWindTime;
    sh.uniforms.uWindAmp = windUniforms.uWindAmp;
    sh.vertexShader =
      "uniform float uWindTime;\nuniform float uWindAmp;\n" + sh.vertexShader.replace("#include <project_vertex>", WIND_GLSL);
  };
  m.customProgramCacheKey = function () {
    return (prevKey ? prevKey.call(this) : "") + "|wgwind";
  };
  m.needsUpdate = true;
}

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
        applyWind(m);
        n++;
      }
  });
  return n;
}
