/**
 * wetMaterials.ts — ④-2 비가 땅에 닿은 뒤: 젖음 · 웅덩이 · 파문 · 흐르는 물 (10/13 2단계) + 툰 외곽선 고치기
 *   (옛 몰입연출.jsx 이식)
 *   전부 **재질 셰이더**에서 한다(에셋 0 · 드로우콜 0). 바람 흔들림과 같은 방식으로 재질에 붙인다.
 *   uWet    표면이 젖은 정도 — 비가 오면 8초쯤에 차고, 그치면 40초에 걸쳐 마른다
 *   uPuddle 웅덩이가 고인 정도 — 25초쯤에 차고, 60초에 걸쳐 빠진다(「고인다」)
 *   uRain   지금 비 세기 — 파문 · 흐르는 물 줄기의 양
 *   땅: 평평한 곳(법선 y > 0.9)에만 잡음으로 웅덩이 · 경사(법선 y 0.35~0.95)에는 내리막으로 흐르는 줄기
 *   강 수면: 파문만.   나머지 빛 받는 재질: 어두워지기만(젖은 색).
 *   ※ 셰이더 문자열에는 ASCII 만 쓴다.
 *
 * [옛 이름 → 새 이름]
 *   비U → rainUniforms · 비GLSL공통/땅/수면/일반 → RAIN_GLSL_COMMON / rainGlslGround / rainGlslWater / rainGlslGeneric
 *   빛받는재질 → isLitMaterial · 젖음입히기 → applyWet · 젖음찾기 → findWetTargets · 외곽선고치기 → fixOutlines
 *   땅이름 → GROUND_NAME · 수면이름 → WATER_NAME · 젖음제외 → WET_EXCLUDED · 잡음2 → noise2 · 웅덩이인가 → isPuddleAt
 *   종류 「땅 · 수면 · 일반」 → "ground" · "water" · "generic"   userData.wg젖음 → wgWet · wg선 → wgOutline
 *   메시 이름: 땅→ground · 연결로→connectorRamp · z.지오→zone.sides · g→grass · 수면→river.surface
 *             하늘/구름→sky.* · 원경.→distant.* · 연출.→immersion.* · 왜곡의문→distortionGates
 */
import * as THREE from "three";

import { MESH_NAMES } from "../../plan/meshNames";
import { UNITS_PER_METER } from "../../plan/sitePlan";
import type { ImmersionTerrain } from "./state";

export const rainUniforms = {
  uWetRect: { value: new THREE.Vector4(0, 0, 0, 0) },
  uWet: { value: 0 },
  uPuddle: { value: 0 },
  uRain: { value: 0 },
  uWgTime: { value: 0 },
  uPuddleCol: { value: new THREE.Color("#9aa4ae") },
};

const RAIN_GLSL_COMMON = /* glsl */ `
uniform float uWet; uniform float uPuddle; uniform float uRain; uniform float uWgTime; uniform vec3 uPuddleCol; uniform vec4 uWetRect;
varying vec3 vWgW;
// rain zone rect (m): inside = 1, fades to 0 over 3 m outside - wetness only in that zone (10/13)
float wgZone( vec2 pm ) {
  vec2 d = max( uWetRect.xy - pm, pm - uWetRect.zw );
  return 1.0 - smoothstep( 0.0, 3.0, length( max( d, vec2( 0.0 ) ) ) );
}
float wgHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float wgNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ), u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wgHash( i ), wgHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( wgHash( i + vec2( 0.0, 1.0 ) ), wgHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float wgRipple( vec2 p, float t ) {
  float acc = 0.0;
  for ( int k = 0; k < 2; k ++ ) {
    vec2 q = p * 3.2 + float( k ) * 17.3;
    vec2 c = floor( q );
    for ( int j = -1; j <= 1; j ++ ) for ( int i = -1; i <= 1; i ++ ) {
      vec2 cell = c + vec2( float( i ), float( j ) );
      float h = wgHash( cell + float( k ) * 3.7 );
      vec2 ctr = cell + vec2( wgHash( cell + 3.1 ), wgHash( cell + 7.7 ) );
      float ph = fract( t * 1.1 + h * 7.0 );
      float d = length( q - ctr );
      float ring = 1.0 - smoothstep( 0.0, 0.035, abs( d - ph * 0.55 ) );
      acc += ring * ( 1.0 - ph ) * ( 1.0 - ph ) * step( h, uRain );
    }
  }
  return clamp( acc, 0.0, 1.0 );
}
`;
const rainGlslGround = (U: string) => /* glsl */ `
{
  vec3 wN = inverseTransformDirection( normal, viewMatrix );
  vec2 pm = vWgW.xz / ${U};
  float zk = wgZone( pm );
  float wet = uWet * zk, puddle = uPuddle * zk, rain = uRain * zk;
  vec3 col = diffuseColor.rgb * ( 1.0 - 0.38 * wet );
  float flatK = smoothstep( 0.84, 0.94, wN.y );
  if ( puddle > 0.001 && flatK > 0.0 ) {
    float n = wgNoise( pm * 0.45 ) * 0.65 + wgNoise( pm * 1.3 + 5.0 ) * 0.35;
    float th = mix( 1.02, 0.52, puddle ); // 10/13: more puddles (about 2x covered area)
    float pud = smoothstep( th, th + 0.04, n ) * flatK;
    if ( pud > 0.001 ) {
      vec3 pc = mix( col * 0.45, uPuddleCol, 0.55 );
      if ( rain > 0.01 ) pc += wgRipple( pm, uWgTime ) * 0.22;
      col = mix( col, pc, pud );
    }
  }
  float slope = ( 1.0 - smoothstep( 0.80, 0.95, wN.y ) ) * step( 0.35, wN.y );
  if ( rain > 0.01 && slope > 0.0 ) {
    vec2 dn = normalize( wN.xz + vec2( 1e-4 ) );
    float s = dot( pm, dn ), side = dot( pm, vec2( - dn.y, dn.x ) );
    float st = fract( s * 1.2 - uWgTime * 1.4 + wgNoise( vec2( side * 3.0, 0.0 ) ) * 2.0 );
    float streak = smoothstep( 0.0, 0.08, st ) * ( 1.0 - smoothstep( 0.08, 0.22, st ) ) * smoothstep( 0.5, 0.72, wgNoise( vec2( side * 2.2, s * 0.3 ) ) );
    col += streak * slope * rain * 0.22;
  }
  diffuseColor.rgb = col;
}
`;
const rainGlslWater = (U: string) => /* glsl */ `
if ( uRain > 0.01 ) diffuseColor.rgb += wgRipple( vWgW.xz / ${U}, uWgTime ) * 0.18 * uRain * wgZone( vWgW.xz / ${U} );
`;
const rainGlslGeneric = (U: string) => /* glsl */ `
diffuseColor.rgb *= 1.0 - 0.32 * uWet * wgZone( vWgW.xz / ${U} );
`;

export type WetKind = "ground" | "water" | "generic";

type LitMaterial = THREE.MeshToonMaterial | THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | THREE.MeshPhongMaterial;
const isLitMaterial = (m: THREE.Material | null | undefined): m is LitMaterial =>
  !!m &&
  ((m as THREE.MeshToonMaterial).isMeshToonMaterial ||
    (m as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
    (m as THREE.MeshLambertMaterial).isMeshLambertMaterial ||
    (m as THREE.MeshPhongMaterial).isMeshPhongMaterial) === true;

export function applyWet(m: THREE.Material | null | undefined, kind: WetKind) {
  if (!isLitMaterial(m) || m.userData.wgWet) return;
  m.userData.wgWet = kind;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  const U = UNITS_PER_METER.toFixed(6);
  m.onBeforeCompile = function (sh, r) {
    prev?.call(this, sh, r);
    if (!sh.fragmentShader.includes("#include <emissivemap_fragment>") || !sh.vertexShader.includes("#include <begin_vertex>")) return;
    Object.assign(sh.uniforms, rainUniforms);
    sh.vertexShader =
      "varying vec3 vWgW;\n" +
      sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvWgW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
    const body = kind === "ground" ? rainGlslGround(U) : kind === "water" ? rainGlslWater(U) : rainGlslGeneric(U);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + RAIN_GLSL_COMMON)
      .replace("#include <emissivemap_fragment>", body + "\n#include <emissivemap_fragment>");
  };
  m.customProgramCacheKey = function () {
    return (prevKey ? prevKey.call(this) : "") + "|wgwet:" + kind;
  };
  m.needsUpdate = true;
}

// 옛 /^(땅|연결로|z\.지오|g)$/ → 새 메시 이름(plan/meshNames)
const GROUND_NAMES = new Set<string>([MESH_NAMES.ground, MESH_NAMES.connectorRamp, MESH_NAMES.zoneSides, MESH_NAMES.grass]);
const WATER_NAME = MESH_NAMES.riverSurface;
// 옛 /하늘|구름|원경\.|연출\.|왜곡의문|인물|아비사|사이드킥|치비/ — 무리 이름(한글)은 그대로, 메시 이름은 새 이름으로
const WET_EXCLUDED = /^sky\.|^distant\.|^immersion\.|^distortionGates$|인물|아비사|사이드킥|치비|avatar/i;
export function findWetTargets(scene: THREE.Scene) {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh || (o as THREE.Sprite).isSprite) return;
    const name = o.name || "";
    if (WET_EXCLUDED.test(name) || WET_EXCLUDED.test(o.parent?.name ?? "")) return;
    const kind: WetKind = GROUND_NAMES.has(name) ? "ground" : name === WATER_NAME ? "water" : "generic";
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) applyWet(m, kind);
  });
}

// ── 툰 외곽선(drei <Outlines>) — 안개 · 로그 깊이 붙이기 (10/13) ──────────
//   drei 의 외곽선 재질은 안개도 로그 깊이 버퍼 조각도 없다. 그래서 ① 밝은 안개 속에서
//   물체는 흐려지는데 외곽선 껍데기만 **새까맣게** 남고(천막 둘레의 검은 테두리),
//   ② 깊이 계산이 본체와 달라 껍데기가 본체 뒤로 크게 비친다. 재질 문자열에 두 조각을 넣어 고친다.
export function fixOutlines(scene: THREE.Scene) {
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
    if (!m || !m.isShaderMaterial || m.userData.wgOutline || !m.uniforms?.thickness || !("screenspace" in m.uniforms)) return;
    m.userData.wgOutline = true;
    Object.assign(m.uniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog));
    m.fog = true;
    // ③ 인스턴스 행렬의 크기(×미터 × 키)가 법선에도 곱해져 껍데기가 수십 배로 부풀었다 → 법선을 정규화한다
    m.vertexShader =
      "#include <fog_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n" +
      m.vertexShader
        .replace("tPosition.xyz + tNormal.xyz * thickness", "tPosition.xyz + normalize( tNormal.xyz ) * thickness")
        .replace(/gl_Position = clipPosition;\s*\}/, (a) => a + "\n     #include <logdepthbuf_vertex>\n     #include <fog_vertex>");
    m.fragmentShader =
      "#include <common>\n#include <fog_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n" +
      m.fragmentShader
        .replace("void main(){", "void main(){\n     #include <logdepthbuf_fragment>")
        .replace(/\}\s*$/, "  #include <fog_fragment>\n}");
    m.needsUpdate = true;
  });
}

// JS 쪽 웅덩이 판정(첨벙 발소리용) — 셰이더와 같은 잡음
const hash2 = (x: number, y: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
function noise2(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
/** (x m, z m) 가 지금 고인 웅덩이 위인가 — 셰이더의 웅덩이 잡음·문턱과 같은 식 */
export function isPuddleAt(xm: number, zm: number, terrain: ImmersionTerrain | null | undefined) {
  const R = rainUniforms.uWetRect.value;
  if (xm < R.x || xm > R.z || zm < R.y || zm > R.w) return false; // 비 온 구역 밖
  const puddle = rainUniforms.uPuddle.value;
  if (puddle < 0.1) return false;
  const n = noise2(xm * 0.45, zm * 0.45) * 0.65 + noise2(xm * 1.3 + 5, zm * 1.3 + 5) * 0.35;
  const th = 1.02 + (0.52 - 1.02) * puddle;
  if (n < th + 0.02) return false;
  const h = (x: number, z: number) => terrain?.groundAt(x, z).y ?? 0;
  const dx = h(xm + 0.3, zm) - h(xm - 0.3, zm);
  const dz = h(xm, zm + 0.3) - h(xm, zm - 0.3);
  return Math.hypot(dx, dz) / 0.6 < 0.45; // 법선 y ≈ 0.91 이상(셰이더 0.84~0.94 와 맞춤)
}
