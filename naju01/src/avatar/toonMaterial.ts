// 애니메이션풍(cel) 재질 — 런타임에서만 바꾼다. GLB 원본은 건드리지 않는다.
//   파이프라인이 Meshy 가 구운 PBR 텍스처를 기준으로 입을 지우고 색을 곱하므로, 재질을 GLB 에 구우면
//   그 작업이 전부 깨진다. BaseColor(map)만 물려받고 재질만 MeshToonMaterial 로 바꾼다.
// 얼굴은 몸과 같은 메시라 이름으로 못 가른다. head 본의 스킨 웨이트로 정점마다 '얼굴 정도'를 구해 넘긴다.
import * as THREE from "three";

import { addEmptyScalpWeights, addScalpWeights } from "./buzzScalp";
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
  // 너무 크면 얼굴 법선이 거의 구가 되어 그림자 없이 환하기만 하다. 이목구비 음영이 남을 만큼만 눕힌다.
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
export function makeToonGradientTexture(steps: number, threshold: number, softness = 0): THREE.DataTexture {
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
        const t = THREE.MathUtils.clamp((x - (edge - softness / 2)) / softness, 0, 1);
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
uniform vec3 _swayOffset;
uniform float _swayTwist;
uniform vec4 _swayShape;
attribute float _face;
attribute float _tint;
attribute float _scalp;
varying float v_scalp;
varying vec3 v_restPos;
varying float v_tint;
varying float v_cloth;
varying float v_bottom;
varying float v_skin;
uniform vec3 _headCentre;
uniform float _faceFlatten;
varying float v_face;
varying vec3 v_viewNormal;
`;
// v_cloth 를 정점마다 0/1 로 자르지 않는다. 목선 표식(naju01/tools/meshy_round_collar.py)은 경계가 정확히 1.5 인
// 1.0~2.0 눈금이라, 자르면 경계가 삼각형 모서리를 따라서만 갈려 목둘레가 톱니처럼 찢겨 보인다.
// _tint − 1 을 0~1 로 자르면 0.5 등고선이 삼각형 안을 가로지르는 매끈한 곡선이 된다. 하의(3)는 1 로 묶여 상의를 지나지 않는다.
const VERTEX_NORMAL = `
  v_face = _face;
  v_tint = _tint;
  v_scalp = _scalp;
  v_restPos = position;
  // keep the 1.0~2.0 ramp (see the Korean note above) instead of a per-vertex step;
  // "is bottom" still steps, so a skin->bottom triangle never passes through 2 = top
  v_cloth = clamp(_tint - 1.0, 0.0, 1.0);
  v_bottom = _tint > 2.5 ? 1.0 : 0.0;
  // skin (1) mark, stepped per vertex like v_bottom: > 0 inside any triangle that touches a skin vertex
  v_skin = (_tint > 0.5 && _tint < 1.5) ? 1.0 : 0.0;
  if (_face > 0.001 && _faceFlatten > 0.001) {
    vec3 sphere = normalize(position - _headCentre);
    objectNormal = normalize(mix(objectNormal, sphere, _face * _faceFlatten));
  }
`;
// 긴 머리 찰랑임(hairSway.ts) — 스키닝이 끝난 자리에 머리끝 밀림을 더한다. 두피 높이(_swayShape.x) 아래로
// 머리끝(_swayShape.y)까지 갈수록 제곱으로 커진다(두피·정수리는 그대로). 머리칼을 몸 쪽(척추 축을 향해 수평으로)으로는
// 밀지 않는다 — 등에 얹힌 머리는 앞으로, 가슴에 내린 머리는 뒤로 안 들어가고 옆·밖으로만 출렁인다.
// _swayShape = (두피 높이, 머리끝 높이, 척추 축 z, 세기). 세기 0(단발·짧은 머리)이면 아무것도 안 한다.
const VERTEX_HAIR_SWAY = `#include <skinning_vertex>
  {
    float swayAlong = clamp((_swayShape.x - position.y) / max(_swayShape.x - _swayShape.y, 0.001), 0.0, 1.0);
    float swayWeight = swayAlong * swayAlong * _swayShape.w;
    if (swayWeight > 0.0) {
      vec2 radial = vec2(position.x, position.z - _swayShape.z);
      float radialLength = length(radial);
      vec2 outward = radialLength > 0.0001 ? radial / radialLength : vec2(0.0);
      vec3 sway = _swayOffset + _swayTwist * vec3(radial.y, 0.0, -radial.x);
      sway.xz -= outward * min(dot(sway.xz, outward), 0.0);
      transformed += sway * swayWeight;
    }
  }
`;
const FRAGMENT_DECLARATIONS = `
uniform vec3 _skinTint;
uniform vec3 _clothTint;
uniform vec3 _bottomTint;
uniform vec3 _clothBase;
uniform vec3 _bottomBase;
uniform float _seamFix;
uniform vec3 _skinBase;
uniform float _skinHem;
uniform float _legHemTop;
varying float v_tint;
varying float v_cloth;
varying float v_bottom;
varying float v_skin;
uniform float _rimPower;
uniform float _rimStrength;
uniform float _hairBand;
uniform vec3 _hairBase;
uniform float _hairNorm;
uniform float _bottomNorm;
uniform float _buzz;
uniform vec3 _buzzColor;
varying float v_scalp;
varying vec3 v_restPos;
varying float v_face;
varying vec3 v_viewNormal;
float buzzHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
vec3 bottomPaint(vec3 texel) {
  if (_bottomNorm < 0.5) return texel * _bottomTint;
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  float ratio = dot(texel, LUMA) / max(dot(_bottomBase, LUMA), 0.0001);
  float shade = pow(ratio, 0.6);
  shade = shade / (1.0 + max(shade - 1.0, 0.0) * 0.6);
  return _bottomTint * mix(1.0, max(shade, 0.2), 0.85);
}
float skinLike(vec3 texel) {
  if (_skinHem < 0.5) return 0.0;
  vec3 seen = sqrt(texel);
  float brightest = max(max(seen.r, seen.g), seen.b);
  float spread = (brightest - min(min(seen.r, seen.g), seen.b)) / max(brightest, 0.001);
  float closer = smoothstep(-0.05, 0.05, distance(seen, sqrt(_bottomBase)) - distance(seen, sqrt(_skinBase)));
  return closer * smoothstep(0.07, 0.12, spread);
}
float buzzNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(buzzHash(i), buzzHash(i + vec3(1, 0, 0)), f.x), mix(buzzHash(i + vec3(0, 1, 0)), buzzHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(buzzHash(i + vec3(0, 0, 1)), buzzHash(i + vec3(1, 0, 1)), f.x), mix(buzzHash(i + vec3(0, 1, 1)), buzzHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
`;
// 머리색 — 머리 텍스처는 짙은 갈색이라 고른 색을 그냥 곱하면(예전 방식) 거의 검정이 되고 결이 사라졌다.
// 텍스처의 밝기를 그 머리의 평균 밝기(_hairBase, 살빛 조각을 뺀 정점 UV 자리 평균)로 나눠 「평균보다 밝다·어둡다」만
// 남기고, 그 비율을 고른 색에 곱한다 — 평균 자리가 고른 색 그대로 나온다. 남자 긴 머리처럼 거의 검은 텍스처는 비율이
// JPEG 잡티까지 키우므로 비율을 0.6 제곱으로 누르고, 하이라이트가 하얗게 타지 않게 위를 눌러 담는다(1.7배에 수렴).
// 결의 세기는 85% 만 쓴다. 흰색(#ffffff = 「원본」)이면 예전처럼 곱한다.
// 머리 메시에 딸려 온 살빛 조각(원본 캐릭터의 귀 등)은 밝고 채도가 있어 가려내 피부색으로 칠한다.
const FRAGMENT_HAIR = `
#ifdef USE_MAP
  {
    vec3 texel = sampledDiffuseColor.rgb;
    vec3 seenHair = sqrt(texel);
    float brightest = max(max(seenHair.r, seenHair.g), seenHair.b);
    float spread = (brightest - min(min(seenHair.r, seenHair.g), seenHair.b)) / max(brightest, 0.001);
    float skinPiece = smoothstep(0.5, 0.62, brightest) * smoothstep(0.1, 0.18, spread);
    vec3 hairColor = diffuseColor.rgb;
    if (_hairNorm > 0.5) {
      const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
      float ratio = dot(texel, LUMA) / max(dot(_hairBase, LUMA), 0.0001);
      float shade = pow(ratio, 0.6);
      shade = shade / (1.0 + max(shade - 1.0, 0.0) * 0.6);
      hairColor = diffuse * mix(1.0, max(shade, 0.2), 0.85);
    }
    diffuseColor.rgb = mix(hairColor, texel * _skinTint, skinPiece);
  }
#endif
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
// Meshy 아틀라스는 옷 섬 둘레에 살색 여백이 붙어 있어 보간·밉맵에서 섬 경계가 번진다 — 검은 반바지엔 밝은 실금,
// 흰 셔츠 소매·밑단엔 검은 실밥처럼 보인다. 구역 평균색(정점 UV 에서 잰다)에서 벗어난 텍셀을 평균색으로 되돌리되,
// 다른 옷 구역의 색이면 그대로 둔다 — 정점 표식의 밑단 경계는 텍스처의 밑단과 조금 어긋나, 셔츠 구역에 그려진
// 반바지 텍셀을 흰색으로 칠하면 밑단이 찢어진 듯 보였다. 피부 구역은 눈·눈썹이 정당하게 어두워 손대지 않는다.
// 상의·하의 정점이 섞인 삼각형(밑단을 가로지르는 줄)만은 정점 표식 대신 텍셀 색으로 상·하의를 가른다 — 표식은
// 삼각형 모서리를 따라 톱니로 갈리지만 텍스처의 밑단은 매끈하다. 텍셀 색을 상의 평균색→하의 평균색 직선에 내려
// 어느 쪽인지 보고(평균보다 더 검은 반바지 텍셀도 하의다), 직선에서 먼 색(살빛 여백 등)만 예전처럼 표식으로 정해
// 평균색으로 되돌린다. 반반인 중간색(접힌 그늘·밑단 자체의 번짐)은 가까운 정점 표식 쪽으로 조금 기운다.
// 표식은 naju01/tools/bake-bottom-markers.mjs hem 이 텍스처 밑단 둘레로 옮겨 둔다(이 갈래는 그 띠 안에서만 돈다).
// 두 평균색이 가까우면(√선형 거리 0.12 미만) 색으로 못 가르므로 이 갈래를 끈다.
// 하의 색(bottomPaint) — 반바지 텍스처가 검정이라 고른 색을 곱하면(예전 방식) 무슨 색이든 검게 남았다(미르 11/11 「상의처럼 색을
// 바꿀 수 없나」). 머리색(FRAGMENT_HAIR)과 같은 셈으로 텍스처 밝기를 하의 평균 밝기(_bottomBase)로 나눠 주름 · 그늘만 남기고
// 고른 색을 입힌다 — 평균 자리가 고른 색 그대로 나온다. 흰색(#ffffff = 「원본」)이거나 평균을 못 재면 예전처럼 곱한다(검정 그대로).
// 다리와 반바지가 맞닿는 줄(피부 · 하의 정점이 섞인 삼각형)은 정점 표식이 아니라 텍셀 색으로 가른다 — 피부 평균색(_skinBase)과
// 하의 평균색 중 가까운 쪽. 표식은 삼각형 모서리를 따라 톱니로 갈려, 뒤쪽 다리에 반바지 색이 번지고(표식은 하의 · 그림은 살)
// 다리 쪽에 검은 점이 남았다(표식은 피부 · 그림은 반바지) — 검정일 땐 덜 보였다(미르 11/11). 하의 표식은 그림의 밑단보다 한 줄 더
// 내려와 있어 하의만 걸친 삼각형의 살 텍셀도 살로 되돌린다. 살로 보는 것은 「피부 평균에 더 가깝고 · 붉은 기(채도)가 있는」 텍셀만 —
// 반바지의 밝은 박음질 · 주름 빛은 무채색이라 반바지로 남는다(skinLike). 하의만 걸친 삼각형에서는 다리 구멍 근처(하의 구역 아래
// 10%, 쉴 때 자세 높이 _legHemTop)만 — 옆선의 붉은 기 도는 밝은 점까지 살로 칠해 점이 생겼다. 두 평균색이 가까우면 끈다(_skinHem).
const FRAGMENT_TINT = `#include <map_fragment>
  // skin (1) <-> bottom (3) hem: decide by the texel colour, not the vertex marks (see the Korean note above)
  if (_skinHem > 0.5 && v_skin > 0.001 && v_bottom > 0.001) {
    diffuseColor.rgb = mix(bottomPaint(diffuseColor.rgb), diffuseColor.rgb * _skinTint, skinLike(diffuseColor.rgb));
  }
  // 2 = top, 3 = bottom
  else if (v_cloth > 0.5) {
    bool isBottom = v_bottom > 0.5 * v_cloth;
    // 거리는 제곱근 공간에서 — 선형값은 어두운 쪽이 눌려 검은 천 위의 갈색 실금(0.05 근처)이 평균과 구별되지 않는다
    vec3 seen = sqrt(diffuseColor.rgb);
    vec3 sTop = sqrt(_clothBase);
    vec3 seg = sqrt(_bottomBase) - sTop;
    float segLen2 = dot(seg, seg);
    // only triangles that carry both a top (2) and a bottom (3) mark
    float hem = step(0.001, v_bottom) * step(0.001, v_cloth - v_bottom) * step(0.0144, segLen2) * _seamFix;
    if (hem > 0.5) {
      // distance to the line, not the segment: texels darker than the bottom average (or whiter than the top
      // average) are still that cloth, not strays
      float along = dot(seen - sTop, seg) / segLen2;
      float stray = smoothstep(0.03, 0.08, distance(seen, sTop + seg * along));
      // ambiguous mid tones (a shadowed fold, the painted hem's own anti-aliasing) lean to the vertex marks
      float lean = 0.25 * (v_bottom / max(v_cloth, 0.001) - 0.5);
      float pick = smoothstep(0.4, 0.6, clamp(along, 0.0, 1.0) + lean);
      float bottomWeight = mix(pick, isBottom ? 1.0 : 0.0, stray);
      vec3 topColor = mix(diffuseColor.rgb, _clothBase, stray) * _clothTint;
      vec3 bottomColor = bottomPaint(mix(diffuseColor.rgb, _bottomBase, stray));
      diffuseColor.rgb = mix(topColor, bottomColor, bottomWeight);
    } else {
      vec3 own = isBottom ? _bottomBase : _clothBase;
      vec3 other = isBottom ? _clothBase : _bottomBase;
      float stray = smoothstep(0.06, 0.18, distance(seen, sqrt(own)))
        * smoothstep(0.08, 0.2, distance(seen, sqrt(other))) * _seamFix;
      vec3 cleaned = mix(diffuseColor.rgb, own, stray);
      // a leg texel under bottom marks (the marks reach a row below the painted hem) stays skin;
      // only near the leg openings, so warm specks on the side seams higher up stay cloth
      float legSkin = skinLike(diffuseColor.rgb) * step(v_restPos.y, _legHemTop);
      diffuseColor.rgb = isBottom
        ? mix(bottomPaint(cleaned), diffuseColor.rgb * _skinTint, legSkin)
        : cleaned * _clothTint;
    }
  }
  else if (v_tint > 0.5) {
    float lum = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
    float sat = lum - min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
    float sclera = smoothstep(0.60, 0.84, lum) * (1.0 - smoothstep(0.05, 0.13, sat));
    diffuseColor.rgb *= mix(_skinTint, vec3(1.0), sclera);
    if (_buzz > 0.5 && v_scalp > 0.001) {
      // stubble grain in rest-pose space (sticks to the scalp); vertical cells a little longer = short strands
      vec3 cell = v_restPos * vec3(950.0, 520.0, 950.0);
      float grain = buzzNoise(cell) * 0.6 + buzzNoise(cell * 2.3 + 17.0) * 0.4;
      // fade the grain out where one pixel spans several cells (far away) so it does not shimmer
      grain = mix(0.5, grain, 1.0 - smoothstep(0.5, 1.5, length(fwidth(cell))));
      float cover = v_scalp * mix(0.86, 1.0, smoothstep(0.2, 0.55, grain));
      vec3 strands = _buzzColor * mix(0.8, 1.18, grain);
      diffuseColor.rgb = mix(diffuseColor.rgb, strands, cover);
    }
  }`;

interface ToonUniforms {
  _headCentre: THREE.IUniform<THREE.Vector3>;
  _faceFlatten: THREE.IUniform<number>;
  _rimPower: THREE.IUniform<number>;
  _rimStrength: THREE.IUniform<number>;
  _hairBand: THREE.IUniform<number>;
  _skinTint: THREE.IUniform<THREE.Color>;
  _clothTint: THREE.IUniform<THREE.Color>;
  /** 하의 색 — 표식 3(naju01/tools 의 하의 표식 굽기가 넣는다) */
  _bottomTint: THREE.IUniform<THREE.Color>;
  /** 상의·하의 구역의 텍스처 평균색 — 섬 경계 번짐을 되돌릴 기준 */
  _clothBase: THREE.IUniform<THREE.Color>;
  _bottomBase: THREE.IUniform<THREE.Color>;
  /** 번짐 보정 세기 0~1. 평균색을 못 재면 0 */
  _seamFix: THREE.IUniform<number>;
  /** 피부 구역 텍스처 평균색(어두운 눈 · 눈썹 텍셀 뺌, 선형) — 다리와 반바지 경계를 텍셀 색으로 가를 기준 */
  _skinBase: THREE.IUniform<THREE.Color>;
  /** 1 = 다리 · 반바지 경계를 텍셀 색으로 가른다(두 평균색을 쟀고 충분히 다를 때) */
  _skinHem: THREE.IUniform<number>;
  /** 하의만 걸친 삼각형에서 살 텍셀을 살로 되돌리는 높이 한계(쉴 때 자세 y) — 하의 구역 아래 10% */
  _legHemTop: THREE.IUniform<number>;
  /** 머리 텍스처 평균색(살빛 조각 뺌, 선형) — 머리색을 평균 밝기에 맞춰 칠할 기준 */
  _hairBase: THREE.IUniform<THREE.Color>;
  /** 1 = 머리색을 평균 밝기 기준으로 칠한다, 0 = 예전처럼 텍스처에 곱한다(흰색 = 원본, 평균을 못 잼) */
  _hairNorm: THREE.IUniform<number>;
  /** 1 = 하의 색을 하의 평균 밝기 기준으로 칠한다(검은 반바지도 고른 색으로), 0 = 예전처럼 곱한다(흰색 = 원본, 평균을 못 잼) */
  _bottomNorm: THREE.IUniform<number>;
  /** 머리끝 밀림(아바타 로컬 m)·비틀림(rad) — hairSway.ts 가 프레임마다 넣는다 */
  _swayOffset: THREE.IUniform<THREE.Vector3>;
  _swayTwist: THREE.IUniform<number>;
  /** (두피 높이, 머리끝 높이, 척추 축 z, 세기) — 머리 메시마다 한 번 정한다 */
  _swayShape: THREE.IUniform<THREE.Vector4>;
  /** 반삭(buzzScalp.ts) — 1 이면 두피(_scalp)를 머리색으로 칠한다 */
  _buzz: THREE.IUniform<number>;
  /** 반삭 머리색(선형) — 머리색을 그 아바타 기본 머리 텍스처 평균에 곱한 값(머리 메시와 같은 밝기) */
  _buzzColor: THREE.IUniform<THREE.Color>;
}

interface ToonUniformEntry {
  uniforms: ToonUniforms;
  kind: ToonPartKind;
  /** 머리 텍스처 평균색을 쟀나 — 못 쟀으면 머리색을 예전처럼 곱한다 */
  hairBaseKnown: boolean;
  /** 하의 구역 평균색을 쟀나 — 못 쟀으면 하의 색을 예전처럼 곱한다 */
  bottomBaseKnown: boolean;
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

function applyToonShaderPatch(
  material: THREE.MeshToonMaterial,
  config: ToonBuildConfig,
  kind: ToonPartKind,
): ToonUniforms {
  const uniforms: ToonUniforms = {
    _headCentre: { value: config.headCentre },
    _faceFlatten: { value: kind === "body" ? config.faceFlatten : 0 },
    _rimPower: { value: config.rimWidth },
    _rimStrength: { value: config.rimStrength },
    _hairBand: { value: kind === "hair" ? config.hairShine : 0 },
    _skinTint: { value: new THREE.Color(1, 1, 1) },
    _clothTint: { value: new THREE.Color(1, 1, 1) },
    _bottomTint: { value: new THREE.Color(1, 1, 1) },
    _clothBase: { value: new THREE.Color(1, 1, 1) },
    _bottomBase: { value: new THREE.Color(0, 0, 0) },
    _seamFix: { value: 0 },
    _skinBase: { value: new THREE.Color(1, 1, 1) },
    _skinHem: { value: 0 },
    _legHemTop: { value: -1e9 },
    _hairBase: { value: new THREE.Color(1, 1, 1) },
    _hairNorm: { value: 0 },
    _bottomNorm: { value: 0 },
    _swayOffset: { value: new THREE.Vector3() },
    _swayTwist: { value: 0 },
    _swayShape: { value: new THREE.Vector4(0, 0, 0, 0) },
    _buzz: { value: 0 },
    _buzzColor: { value: new THREE.Color(0, 0, 0) },
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
    if (kind === "hair")
      shader.vertexShader = shader.vertexShader.replace("#include <skinning_vertex>", VERTEX_HAIR_SWAY);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace("#include <map_fragment>", kind === "hair" ? `${FRAGMENT_TINT}\n${FRAGMENT_HAIR}` : FRAGMENT_TINT)
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>\n${FRAGMENT_FINISH}`);
  };
  // three 는 onBeforeCompile 소스로 프로그램을 캐시한다. 갈래가 다르면 키도 달라야
  // 몸 셰이더가 머리에 재사용되지 않는다(그 탓에 의상이 통째로 사라진 적이 있다).
  material.customProgramCacheKey = () =>
    `toon:${kind}:${config.steps}:${config.threshold}:${config.softness ?? 0}:sclera`;
  return uniforms;
}

// ── 옷 구역 평균색 ──
// 상의(표식 2)·하의(표식 3) 정점의 UV 자리에서 텍스처를 읽어 평균을 낸다. 텍스처는 한 번만 캔버스로 내려 둔다.
const texelCache = new WeakMap<THREE.Texture, ImageData | null>();

function readTexels(map: THREE.Texture): ImageData | null {
  if (texelCache.has(map)) return texelCache.get(map) ?? null;
  let texels: ImageData | null = null;
  const image = map.image as CanvasImageSource & { width?: number; height?: number };
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (width && height && typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(image, 0, 0);
        texels = context.getImageData(0, 0, width, height);
      }
    } catch {
      texels = null; // 다른 출처 이미지 등 — 보정만 끈다
    }
  }
  texelCache.set(map, texels);
  return texels;
}

interface ZoneBases {
  cloth: THREE.Color | null;
  bottom: THREE.Color | null;
  skin: THREE.Color | null;
}

/** 표식 2·3 정점이 가리키는 텍셀의 평균색. 정점이 없는 구역은 null */
/** 하의 구역(표식 3) 아래 10% 높이(쉴 때 자세 y) — 다리 구멍 근처. 하의 표식이 없으면 아무 데도 안 걸리게 아주 낮게 */
function legHemTop(geometry: THREE.BufferGeometry) {
  const tint = geometry.getAttribute("_tint");
  const position = geometry.getAttribute("position");
  if (!tint || !position) return -1e9;
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < tint.count; i += 1) {
    if (tint.getX(i) < 2.5) continue;
    const y = position.getY(i);
    low = Math.min(low, y);
    high = Math.max(high, y);
  }
  return Number.isFinite(low) ? low + (high - low) * 0.1 : -1e9;
}

/** 두 평균색(선형)이 색으로 가를 만큼 다른가 — 제곱근 공간 거리 0.12 이상(상의 · 하의 밑단 갈래와 같은 기준) */
function isFarApart(a: THREE.Color, b: THREE.Color) {
  return (
    Math.hypot(Math.sqrt(a.r) - Math.sqrt(b.r), Math.sqrt(a.g) - Math.sqrt(b.g), Math.sqrt(a.b) - Math.sqrt(b.b)) >=
    0.12
  );
}

function computeZoneBases(geometry: THREE.BufferGeometry, map: THREE.Texture | null): ZoneBases {
  const none: ZoneBases = { cloth: null, bottom: null, skin: null };
  const tint = geometry.getAttribute("_tint");
  const uv = geometry.getAttribute("uv");
  if (!map || !tint || !uv) return none;
  const texels = readTexels(map);
  if (!texels) return none;
  const { width, height, data } = texels;
  const sums = { cloth: [0, 0, 0, 0], bottom: [0, 0, 0, 0], skin: [0, 0, 0, 0] };
  for (let i = 0; i < tint.count; i += 1) {
    const mark = tint.getX(i);
    const zone = mark > 2.5 ? sums.bottom : mark > 1.75 ? sums.cloth : mark > 0.5 && mark < 1.5 ? sums.skin : null;
    if (!zone) continue;
    const u = uv.getX(i) - Math.floor(uv.getX(i));
    const v = uv.getY(i) - Math.floor(uv.getY(i));
    // flipY 가 꺼진(GLTF) 텍스처는 v = 0 이 이미지 첫 줄이다
    const row = Math.min(height - 1, Math.floor((map.flipY ? 1 - v : v) * height));
    const column = Math.min(width - 1, Math.floor(u * width));
    const at = (row * width + column) * 4;
    // 피부 평균은 살빛만 — 눈동자 · 눈썹 · 입술 그늘 같은 어두운 텍셀은 뺀다
    if (zone === sums.skin && Math.max(data[at], data[at + 1], data[at + 2]) < 90) continue;
    zone[0] += data[at];
    zone[1] += data[at + 1];
    zone[2] += data[at + 2];
    zone[3] += 1;
  }
  // 캔버스 값은 sRGB — 셰이더의 map 은 선형이라 같은 공간으로 옮긴다
  const toColor = ([r, g, b, n]: number[]) =>
    n ? new THREE.Color(r / n / 255, g / n / 255, b / n / 255).convertSRGBToLinear() : null;
  return { cloth: toColor(sums.cloth), bottom: toColor(sums.bottom), skin: toColor(sums.skin) };
}

/**
 * 머리 텍스처의 평균색(선형) — 정점 UV 자리 텍셀의 평균. 살빛 조각(밝고 채도 있는 텍셀, FRAGMENT_HAIR 와 같은 기준)은 뺀다.
 * 못 재면 null(머리색을 예전처럼 곱한다).
 */
function computeHairBase(geometry: THREE.BufferGeometry, map: THREE.Texture | null): THREE.Color | null {
  const uv = geometry.getAttribute("uv");
  if (!map || !uv) return null;
  const texels = readTexels(map);
  if (!texels) return null;
  const { width, height, data } = texels;
  const sum = [0, 0, 0];
  let count = 0;
  const linear = new THREE.Color();
  for (let i = 0; i < uv.count; i += 1) {
    const u = uv.getX(i) - Math.floor(uv.getX(i));
    const v = uv.getY(i) - Math.floor(uv.getY(i));
    const row = Math.min(height - 1, Math.floor((map.flipY ? 1 - v : v) * height));
    const column = Math.min(width - 1, Math.floor(u * width));
    const at = (row * width + column) * 4;
    linear.setRGB(data[at] / 255, data[at + 1] / 255, data[at + 2] / 255).convertSRGBToLinear();
    const seen = [Math.sqrt(linear.r), Math.sqrt(linear.g), Math.sqrt(linear.b)];
    const brightest = Math.max(...seen);
    const spread = (brightest - Math.min(...seen)) / Math.max(brightest, 0.001);
    if (brightest > 0.56 && spread > 0.14) continue;
    sum[0] += linear.r;
    sum[1] += linear.g;
    sum[2] += linear.b;
    count += 1;
  }
  return count ? new THREE.Color(sum[0] / count, sum[1] / count, sum[2] / count) : null;
}

/** 머리 파츠 번호 — GLB 노드 extras(variant)는 재질이 여럿이면 부모 그룹에 붙어 온다 */
function hairVariantOf(object: THREE.Object3D): number | null {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (node.userData.slot !== undefined)
      return typeof node.userData.variant === "number" ? node.userData.variant : null;
  }
  return null;
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
    gradientMap: makeToonGradientTexture(config.steps, config.threshold, config.softness ?? 0),
  });
  material.name = `${source.name || "material"}_toon`;
  const uniforms = applyToonShaderPatch(material, config, kind);
  return { material, uniforms };
}

interface ToonTint {
  skin?: string;
  cloth?: string;
  bottom?: string;
  /** 머리색 — 머리 메시는 재질 색으로 곱해 두고 여기서는 평균 밝기 기준으로 칠할지만 정한다. 반삭 색도 이 색에서 낸다 */
  hair?: string;
  /** 반삭을 골랐나 — 몸의 두피를 머리색으로 칠한다(buzzScalp.ts) */
  buzz?: boolean;
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
  /** 긴 머리 찰랑임 — 머리끝 밀림(아바타 로컬 m)·비틀림(rad). 단발처럼 짧은 머리 재질은 건너뛴다 */
  sway: (offset: THREE.Vector3, twist: number) => void;
  /** 흔들릴 만큼 긴 머리 재질이 하나라도 있나 — 없으면 아바타가 용수철을 굴리지 않는다 */
  hasSwayingHair: boolean;
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
  let referenceHairBase: THREE.Color | null = null;
  meshes.forEach((object) => {
    const kind = classify(object) ?? "cloth";
    if (!(object instanceof THREE.SkinnedMesh && addFaceWeights(object))) addEmptyFaceWeights(object.geometry);
    if (kind === "body" && object instanceof THREE.SkinnedMesh) addScalpWeights(object);
    else addEmptyScalpWeights(object.geometry);
    // 반삭 색의 밝기 기준 — 그 아바타의 기본 머리(파츠 번호 0) 텍스처 평균
    if (kind === "hair" && hairVariantOf(object) === 0 && !referenceHairBase) {
      const map = (Array.isArray(object.material) ? object.material[0] : object.material) as THREE.MeshStandardMaterial;
      referenceHairBase = computeHairBase(object.geometry, map?.map ?? null);
    }
    if (kind === "hair") addEmptyTint(object.geometry);
    else if (hasTintAttribute(object)) hasTintMarks = true;
    const current: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
    // 이미 툰이 붙어 있으면 그 툰의 원본에서 다시 만든다(툰 위에 툰을 겹치지 않는다).
    const sources = current.map((m) => (m.userData?.[TOON_SOURCE_KEY] as THREE.Material | undefined) ?? m);
    const created = sources.map((source) => {
      const { material, uniforms } = createToonMaterial(source, buildConfig, kind);
      material.userData[TOON_SOURCE_KEY] = source;
      let hairBaseKnown = false;
      let bottomBaseKnown = false;
      if (kind !== "hair") {
        const bases = computeZoneBases(object.geometry, material.map);
        if (bases.cloth) uniforms._clothBase.value.copy(bases.cloth);
        if (bases.bottom) uniforms._bottomBase.value.copy(bases.bottom);
        bottomBaseKnown = !!bases.bottom;
        if (bases.skin) uniforms._skinBase.value.copy(bases.skin);
        uniforms._skinHem.value = bases.skin && bases.bottom && isFarApart(bases.skin, bases.bottom) ? 1 : 0;
        uniforms._legHemTop.value = legHemTop(object.geometry);
        uniforms._seamFix.value = bases.cloth || bases.bottom ? 1 : 0;
      } else {
        const base = computeHairBase(object.geometry, material.map);
        if (base) uniforms._hairBase.value.copy(base);
        hairBaseKnown = !!base;
        if (object instanceof THREE.SkinnedMesh) uniforms._swayShape.value.copy(hairSwayShape(object));
      }
      entries.push({ uniforms, kind, hairBaseKnown, bottomBaseKnown });
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
  //   첫 캐릭터만 툰이 아니게 되고 상의 색이 아예 안 먹는다.
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
  const buzzColor = new THREE.Color();
  const tint = ({ skin, cloth, bottom, hair, buzz }: ToonTint) => {
    // 반삭 색 — 머리 메시와 같게 보이게. 「원본」(흰색)이면 기본 머리 텍스처 평균(짙은 갈색), 고른 색이 있으면 그 색 그대로.
    // 예전엔 늘 「머리색 × 텍스처 평균」이라 머리 메시를 평균 밝기 기준으로 칠한 뒤(_hairNorm)에도 반삭만 무슨 색이든 거의 검게
    // 남았다(미르 11/11 「머리색을 바꿔도 안 보인다」). 머리 메시도 평균 자리가 고른 색 그대로 나온다
    const isOriginalHair = !hair || hair.toLowerCase() === "#ffffff";
    if (isOriginalHair && referenceHairBase) buzzColor.copy(referenceHairBase);
    else buzzColor.set(hair ?? "#ffffff");
    const bottomColor = (bottom ?? cloth ?? "#ffffff").toLowerCase();
    entries.forEach(({ uniforms, kind, hairBaseKnown, bottomBaseKnown }) => {
      if (skin) uniforms._skinTint.value.set(skin);
      if (kind === "hair") {
        uniforms._hairNorm.value = hairBaseKnown && hair && hair.toLowerCase() !== "#ffffff" ? 1 : 0;
        return;
      }
      if (cloth) uniforms._clothTint.value.set(cloth);
      uniforms._bottomTint.value.set(bottomColor);
      uniforms._bottomNorm.value = bottomBaseKnown && bottomColor !== "#ffffff" ? 1 : 0;
      uniforms._buzz.value = buzz ? 1 : 0;
      uniforms._buzzColor.value.copy(buzzColor);
    });
  };
  const swaying = entries.filter(({ uniforms, kind }) => kind === "hair" && uniforms._swayShape.value.w > 0);
  const sway = (offset: THREE.Vector3, twist: number) => {
    swaying.forEach(({ uniforms }) => {
      uniforms._swayOffset.value.copy(offset);
      uniforms._swayTwist.value = twist;
    });
  };
  return {
    restore,
    uniforms: entries.map((entry) => entry.uniforms),
    update,
    tint,
    hasTintMarks,
    sway,
    hasSwayingHair: swaying.length > 0,
  };
}

const _headBind = new THREE.Matrix4();

/**
 * 머리 메시의 찰랑임 모양 — (두피 높이, 머리끝 높이, 척추 축 z, 세기), 메시 로컬(쉴 때 자세) 좌표.
 * 두피 높이 = head 뼈 + 2 cm(턱 높이 — 이 위는 안 흔든다), 머리끝 = 메시의 가장 낮은 점.
 * 머리끝이 두피 높이보다 15 cm 넘게 내려가면 다 흔들고 6 cm 안이면(단발·짧은 머리) 안 흔든다. 짧을수록 덜 흔든다.
 */
function hairSwayShape(mesh: THREE.SkinnedMesh): THREE.Vector4 {
  const shape = new THREE.Vector4(0, 0, 0, 0);
  const index = mesh.skeleton?.bones.findIndex((bone) => bone.name === "head") ?? -1;
  if (index < 0) return shape;
  // inverseBindMatrices 의 역행렬 = 쉴 때 자세의 뼈 자리(메시 공간)
  const head = new THREE.Vector3().setFromMatrixPosition(_headBind.copy(mesh.skeleton.boneInverses[index]).invert());
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const tip = mesh.geometry.boundingBox?.min.y ?? head.y;
  const top = head.y + 0.02;
  const length = top - tip;
  const amount = THREE.MathUtils.smoothstep(length, 0.06, 0.15) * Math.min(1, length / 0.25);
  return shape.set(top, tip, head.z, amount);
}
