/**
 * animeStyle.ts — 「변환판(원신 방향)」 화면의 셰이더 쪽 (옛 애니화풍.js 이식, 10/14 정리판, 🟡 팀 검토 전)
 *
 * [켜는 법]  `?aihub&src=sf&r=15&애니판` — 변환판 에셋(loaders/publicAssets 의 anime_bake·anime)과 함께 켜진다.
 *            주소에 `애니판` 이 없으면 이 파일은 아무것도 하지 않는다(지금 화면 그대로).
 *
 * [하는 일 — 모두 프레임 비용이 거의 0(후처리 패스 없음)]
 *   ① 명암   3단 계단 대신 원신식 2톤(그늘 0.55 ↔ 밝음 1.0) + 부드러운 경계, 그늘에 푸른 보랏빛.
 *            ※ gradientmap 조각을 바꾸므로 캐릭터 툰(avatar/toonMaterial)에도 같이 걸린다.
 *   ② 색 보정  채도 +, 중간 그늘은 차갑게 · 밝은 곳은 따뜻하게(아주 어두운 곳은 건드리지 않음 — 밤 장면 보호).
 *   ③ 먼 곳 바램 0.8 → 0.4 (애니 배경은 먼 곳도 색이 남는다)
 *   ④ 잎 둥글리기  덤불·수풀 법선을 덩어리 중심에서 바깥으로(로드 때 한 번).
 *
 * [WorldToon.tsx 와 어떻게 같이 사는가 — 리드가 갈라야 할 자리]
 *   WorldToon 은 (a) 표준/물리 재질을 MeshToonMaterial 로 갈아 끼우고 (b) 이미 툰인 재질에는 제 gradientMap
 *   (makeToonGradientTexture(steps, threshold)) 을 꽂는다. 이 파일은 그 **텍스처를 읽는 셰이더 조각**
 *   (THREE.ShaderChunk.gradientmap_pars_fragment) 을 바꾼다 — 둘은 층이 달라 충돌하지 않는다.
 *     · 램프 "부드럽게"(기본): 조각이 gradientMap 텍스처를 **읽지 않고** coord.x 로 2톤을 만든다
 *       → WorldToon 의 steps/threshold 는 효과가 없다(캐릭터 toonMaterial 의 steps 도 마찬가지).
 *     · 램프 "계단"(`&램프=계단`): texture2D(gradientMap) 그대로 → WorldToon 의 3단이 산다. 그늘색만 입힌다.
 *   → 리드는 NajuScene.tsx 의 `<WorldToon enabled steps={toonConfig.steps} threshold={toonConfig.threshold} />`
 *     바로 옆에 `<AnimeStyleLayer />` 를 두면 된다(WorldToon 의 props 는 바꿀 필요 없다). 굳이 가르려면
 *     `steps={IS_ANIME_VARIANT && animeValues.ramp === "soft" ? 2 : toonConfig.steps}` 정도 — 보기엔 차이가 없다.
 *   ※ ShaderChunk 는 **모듈이 읽힐 때** 바꾼다(재질이 컴파일되기 전이어야 한다). 그래서 이 파일은 씬 모듈보다
 *     먼저 import 되어야 하고, ③ 은 windShader.ts 가 먼저 고쳐 둔 안개 조각(WG_DESAT)의 「0.8」만 바꾸므로
 *     아래에서 windShader 를 side-effect import 해 순서를 못 박는다.
 *
 * ※ 셰이더 문자열에는 ASCII 만 쓴다(windShader.ts 와 같은 이유 — 일부 드라이버가 한글 주석을 거부).
 *
 * [옛 이름 → 새 이름]
 *   애니켬 → IS_ANIME_VARIANT · 애니값 → animeValues · 잎둥글리기 → roundLeafNormals · N애니화풍 → AnimeStyleLayer
 *   그늘색 → shadeColor · 채도 → saturation · 대비 → contrast · 차가운그늘 → coolShadow · 따뜻한빛 → warmLight
 *   바램 → farFade · 잎둥글림 → leafRounding · 램프 → ramp("soft"|"steps") · 그늘밝기 → shadeLevel
 */
import { useEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { TOON_UNIFORMS_KEY } from "../avatar/toonMaterial";
import { IS_ANIME_VARIANT } from "../loaders/publicAssetManifest";
// ③ 의 전제 — 안개 조각(WG_DESAT)을 windShader 가 먼저 고쳐 두게 import 순서를 못 박는다
import "../scene/immersion/windShader";

export { IS_ANIME_VARIANT };

const QUERY = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;

// 값은 여기 한 곳 — 보고 고친다 🟡
//   주소창으로 바로 바꿔 볼 수 있다: `&그늘밝기=0.55&그늘=0.68&채도=1.15&대비=1.08&바램=0.4&잎=0.8`
const numberParam = (name: string, fallback: number) => {
  const v = Number(QUERY?.get(name));
  return Number.isFinite(v) && QUERY?.has(name) ? v : fallback;
};
const shadeStrength = numberParam("그늘", 0.68); // 그늘 계단 밝기(낮을수록 진한 그늘). 푸른 보랏빛을 곱한다
export const animeValues = {
  shadeColor: [shadeStrength * 0.95, shadeStrength * 1.02, Math.min(1.3, shadeStrength * 1.6)] as [number, number, number],
  saturation: numberParam("채도", 1.15), // 1 = 그대로 (10/14: 1.3 → 1.15, 공개 3D 잎이 형광으로 뜸)
  contrast: numberParam("대비", 1.08), // 1 = 그대로
  coolShadow: [0.92, 0.96, 1.08] as [number, number, number],
  warmLight: [1.06, 1.02, 0.94] as [number, number, number],
  farFade: numberParam("바램", 0.4), // 먼 곳이 회색으로 바래는 정도(windShader 안개 조각은 0.8) — 애니는 먼 곳도 색이 남는다
  leafRounding: numberParam("잎", 0.8), // 0 = 원래 법선, 1 = 완전히 덩어리 중심에서 바깥으로
  /** 원신식 2톤 부드러운 경계(10/14 결정). `&램프=계단` = 게임 원래 3단(WorldToon 의 gradientMap 그대로) */
  ramp: (QUERY?.get("램프") === "계단" ? "steps" : "soft") as "soft" | "steps",
  shadeLevel: numberParam("그늘밝기", 0.55), // 부드러운 램프의 그늘 쪽 밝기
};

const v3 = (a: [number, number, number]) => `vec3(${a.map((x) => x.toFixed(3)).join(", ")})`;

// ── ① 명암 — gradientmap 조각 ──
if (IS_ANIME_VARIANT && !THREE.ShaderChunk.gradientmap_pars_fragment.includes("WG_SHADE")) {
  const original = "return vec3( texture2D( gradientMap, coord ).r );";
  if (THREE.ShaderChunk.gradientmap_pars_fragment.includes(original)) {
    THREE.ShaderChunk.gradientmap_pars_fragment = THREE.ShaderChunk.gradientmap_pars_fragment.replace(
      original,
      `// WG_SHADE
		${
      animeValues.ramp === "soft"
        ? // 원신식(10/14): 3단 계단 대신 밝음/그늘 두 톤 + 부드러운 경계(셀 경계가 칼처럼 끊기지 않게)
          `float wgG = mix( ${animeValues.shadeLevel.toFixed(3)}, 1.0, smoothstep( 0.40, 0.58, coord.x ) );`
        : "float wgG = texture2D( gradientMap, coord ).r;"
    }
		return wgG * mix( ${v3(animeValues.shadeColor)}, vec3( 1.0 ), smoothstep( 0.45, 0.95, wgG ) );`,
    );
  } else console.warn("[animeStyle] gradientmap 조각 모양이 달라 그늘색을 건너뜀");
}

// ── ② 색 보정 — colorspace 조각 끝에 덧붙인다 ──
if (IS_ANIME_VARIANT && !THREE.ShaderChunk.colorspace_fragment.includes("WG_GRADE")) {
  THREE.ShaderChunk.colorspace_fragment += /* glsl */ `
// WG_GRADE
{
  vec3 wgC = gl_FragColor.rgb;
  float wgL = dot( wgC, vec3( 0.299, 0.587, 0.114 ) );
  // v3(10/14): night guard - dark pixels keep their saturation/contrast, cool tint only in mid-shadow band
  float wgMid = smoothstep( 0.06, 0.3, wgL );
  wgC = mix( vec3( wgL ), wgC, mix( 1.0, ${animeValues.saturation.toFixed(3)}, wgMid ) );
  wgC = mix( wgC, ( wgC - 0.5 ) * ${animeValues.contrast.toFixed(3)} + 0.5, smoothstep( 0.15, 0.4, wgL ) );
  float wgCool = smoothstep( 0.04, 0.14, wgL ) * ( 1.0 - smoothstep( 0.14, 0.5, wgL ) );
  wgC *= mix( vec3( 1.0 ), ${v3(animeValues.coolShadow)}, wgCool );
  wgC *= mix( vec3( 1.0 ), ${v3(animeValues.warmLight)}, smoothstep( 0.6, 1.0, wgL ) );
  gl_FragColor.rgb = clamp( wgC, 0.0, 1.0 );
}
`;
}

// ── ③ 먼 곳 바램 — windShader.ts 가 먼저 고쳐 둔 안개 조각의 「0.8」만 바꾼다(import 순서상 그쪽이 먼저 돈다) ──
if (
  IS_ANIME_VARIANT &&
  THREE.ShaderChunk.fog_fragment.includes("WG_DESAT") &&
  !THREE.ShaderChunk.fog_fragment.includes("WG_ANI_DESAT")
) {
  THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment
    .replace("clamp( fogFactor * 1.6, 0.0, 1.0 ) * 0.8 )", `clamp( fogFactor * 1.6, 0.0, 1.0 ) * ${animeValues.farFade.toFixed(3)} )`)
    .replace("// WG_DESAT", "// WG_DESAT WG_ANI_DESAT");
}

// ── ④ 잎 둥글리기 ───────────────────────────────────────────
//   무리 이름(groupId)은 edits.json 열쇠라 한글 그대로다 — 여기 정규식도 그 값을 본다.
const LEAF_NAME = /나무|수풀|덤불|잎|숲|풀|꽃/;
const EXCLUDED_NAME = /\.(기둥|가로대)|울타리|집|돌|바위/;
function isGreenish(geometry: THREE.BufferGeometry): boolean {
  const c = geometry.attributes.color as THREE.BufferAttribute | undefined;
  if (!c) return false;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = Math.min(c.count, 600);
  for (let i = 0; i < n; i++) {
    const k = Math.floor((i * c.count) / n);
    r += c.getX(k);
    g += c.getY(k);
    b += c.getZ(k);
  }
  return g > r * 1.05 && g > b * 1.05;
}
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();
const _h = new THREE.Vector3();
function roundNormals(geometry: THREE.BufferGeometry, strength: number): boolean {
  const pos = geometry.attributes.position as THREE.BufferAttribute | undefined;
  const nor = geometry.attributes.normal as THREE.BufferAttribute | undefined;
  if (!pos || !nor) return false;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return false;
  box.getCenter(_c);
  box.getSize(_h).multiplyScalar(0.5).max(new THREE.Vector3(1e-4, 1e-4, 1e-4));
  // 아래쪽으로 조금 내린 중심 — 덩어리 윗면이 하늘빛을 더 받는다
  _c.y -= _h.y * 0.25;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i).sub(_c).divide(_h).normalize();
    _n.fromBufferAttribute(nor, i).lerp(_p, strength).normalize();
    nor.setXYZ(i, _n.x, _n.y, _n.z);
  }
  nor.needsUpdate = true;
  return true;
}
/** 씬의 초록 덩어리(툰 재질 · 캐릭터 제외) 법선을 둥글린다. 바꾼 메시 이름을 돌려준다. */
export function roundLeafNormals(scene: THREE.Object3D, strength = animeValues.leafRounding): string[] {
  const changed: string[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || mesh.geometry.userData.leafRounded) return;
    const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshToonMaterial | undefined;
    if (!m?.isMeshToonMaterial || m.userData?.[TOON_UNIFORMS_KEY]) return; // 캐릭터 툰은 건드리지 않는다
    const name = `${o.name} ${o.parent?.name ?? ""}`;
    if (EXCLUDED_NAME.test(o.name)) return;
    if (!(LEAF_NAME.test(name) && isGreenish(mesh.geometry))) return;
    mesh.geometry.userData.leafRounded = true;
    if (roundNormals(mesh.geometry, strength)) changed.push(o.name || "∅");
  });
  return changed;
}

/**
 * 씬에 두면 나중에 들어오는 무리까지 훑는다(WorldToon 과 같은 방식 — 처음 12초 동안 1초마다).
 * `애니판` 이 없으면 아무것도 하지 않는다. 콘솔: __game.animeStyle.values · .roundedCount()
 */
export function AnimeStyleLayer() {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!IS_ANIME_VARIANT) return undefined;
    let total = 0;
    let runs = 0;
    const sweep = () => {
      const changed = roundLeafNormals(scene);
      total += changed.length;
      if (changed.length) invalidate();
      if (++runs >= 12) clearInterval(timer);
    };
    const timer = setInterval(sweep, 1000);
    sweep();
    if (import.meta.env.DEV) exposeDevHook("animeStyle", { values: animeValues, roundedCount: () => total });
    return () => clearInterval(timer);
  }, [scene, invalidate]);
  return null;
}
