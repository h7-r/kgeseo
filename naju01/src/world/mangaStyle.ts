/**
 * mangaStyle.ts — 「만화 v3」 화면 효과 (10/20 미르: 빈 방 시험장 만화 v3 를 나주맵에도)
 *
 * [기본값]  켜져 있다(10/20 미르 결정). 끄고 옛 화면과 견줄 때는 `?만화=off`.
 *            후처리를 끈 실행(?fx=off · ?q=low)에서는 붙지 않는다 — 저사양은 선·색 보정 없이 툰만.
 *
 * [하는 일 — 후처리 한 장. 장면을 한 번 더 그리지 않는다]
 *   ① 선   깊이만 읽어 윤곽선(앞뒤가 갈리는 곳) + 꺾인 모서리 선을 그린다.
 *          1/z 는 평평한 면 위에서 화면 방향으로 일직선이라(비스듬한 땅도) 그 2차 차이가 0 → 땅에 가짜 선이 안 생긴다.
 *          거리로 지운다: 모서리 선 creaseFar(유닛) · 윤곽선 edgeFar(유닛). 하늘(깊이 1)은 건너뛴다.
 *   ② 색   쨍한 빨강·자홍(옻칠·붉은 천)만 골라 채도를 누르고 · 전체 밝기 ×0.86 · 어두운 곳은 차갑게 · 밝은 곳은 따뜻하게.
 *          나무 갈색(초록이 빨강의 절반 이상)은 건드리지 않는다.
 *   로그 깊이(logarithmicDepthBuffer)는 postprocessing 의 readDepth 가 풀어 준다.
 *
 * [같이 바뀌는 것] 만화를 켜면 NajuScene 의 세계 껍데기 외곽선(drei <Outlines>)을 끈다 — 선이 두 겹이 되므로.
 * ※ 셰이더 문자열에는 ASCII 만 (windShader.ts 와 같은 이유).
 */
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { Uniform } from "three";
import { wrapEffect } from "@react-three/postprocessing";

const QUERY = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
/** 만화 v3 화면 효과 — 기본으로 켠다(10/20 미르: 「이 질감을 기본값으로」). 끄려면 ?만화=off */
export const IS_MANGA_STYLE = QUERY.get("만화") !== "off";

const FRAG = /* glsl */ `
uniform float uStrength;
uniform float uWidth;
uniform float uCreaseFar;
uniform float uEdgeFar;
uniform float uGrade;

float distAt(const in vec2 p) { return -getViewZ(readDepth(p)); }

vec3 mangaGrade(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  c /= max(1.0, mx);
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float red = smoothstep(0.5, 0.25, c.g / max(c.r, 0.02)) * smoothstep(0.2, 0.45, sat) * step(c.b, c.r);
  float hot = max(red, smoothstep(0.6, 0.85, sat));
  c = mix(vec3(l), c, mix(1.05, 0.5, hot));
  c *= 0.86 * mix(1.0, 0.88, hot);
  c *= mix(vec3(0.86, 0.9, 1.06), vec3(1.0), smoothstep(0.2, 0.55, l));
  c *= mix(vec3(1.0), vec3(1.03, 1.01, 0.96), smoothstep(0.7, 1.0, l));
  return pow(clamp(c, 0.0, 1.0), vec3(2.2));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 col = mix(inputColor.rgb, mangaGrade(inputColor.rgb), uGrade);
  float e = 0.0;
  if (depth < 0.99999) {
    float d0 = -getViewZ(depth);
    vec2 px = texelSize * uWidth;
    float l = distAt(uv - vec2(px.x, 0.0));
    float r = distAt(uv + vec2(px.x, 0.0));
    float u = distAt(uv + vec2(0.0, px.y));
    float b = distAt(uv - vec2(0.0, px.y));
    float il = 1.0 / l, ir = 1.0 / r, iu = 1.0 / u, ib = 1.0 / b, i0 = 1.0 / d0;
    float lap = max(abs(il + ir - 2.0 * i0), abs(iu + ib - 2.0 * i0)) * d0;
    float eDisc = smoothstep(0.04, 0.12, lap) * (1.0 - smoothstep(uEdgeFar * 0.6, uEdgeFar, d0));
    float eCrease = smoothstep(0.003, 0.012, lap) * (1.0 - smoothstep(uCreaseFar * 0.5, uCreaseFar, d0));
    e = clamp(max(eDisc, eCrease), 0.0, 1.0) * uStrength;
  }
  outputColor = vec4(mix(col, col * vec3(0.28, 0.24, 0.24), e), inputColor.a);
}
`;

export interface MangaEffectOptions {
  /** 선 진하기 0~1 */
  strength?: number;
  /** 선 굵기(화면 픽셀 배수) */
  width?: number;
  /** 모서리 선이 사라지는 거리(유닛, 1 유닛 = 0.3 m) */
  creaseFar?: number;
  /** 윤곽선이 사라지는 거리(유닛) */
  edgeFar?: number;
  /** 색 보정 세기 0~1 */
  grade?: number;
}

export class MangaEffectImpl extends Effect {
  constructor({ strength = 0.9, width = 1.5, creaseFar = 60, edgeFar = 300, grade = 1 }: MangaEffectOptions = {}) {
    super("MangaEffect", FRAG, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ["uStrength", new Uniform(strength)],
        ["uWidth", new Uniform(width)],
        ["uCreaseFar", new Uniform(creaseFar)],
        ["uEdgeFar", new Uniform(edgeFar)],
        ["uGrade", new Uniform(grade)],
      ]),
    });
  }
}

/** <EffectComposer> 안에 넣는다 */
export const MangaEffect = wrapEffect(MangaEffectImpl);
