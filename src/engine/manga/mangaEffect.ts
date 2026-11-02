/**
 * 「만화 v3」 화면 효과 — 나주맵(naju01/src/world/mangaStyle.ts)과 같은 셰이더를 본편 실내에 맞춰 옮겼다.
 * 후처리 한 장이라 장면을 다시 그리지 않는다.
 *   ① 선  깊이만 읽어 윤곽선(앞뒤가 갈리는 곳)과 꺾인 모서리 선을 긋는다. 평평한 면은 1/z 의 2차 차이가 0 이라 가짜 선이 없다.
 *   ② 색  쨍한 빨강·자홍만 채도를 누르고, 어두운 곳은 차갑게 · 밝은 곳은 따뜻하게.
 * 나주와 다른 점: 밝기 배율(exposure)·그늘 차가움(cool)·채도(saturation)·중간밝기(lift)·선 색(ink)을 값으로 뺐다. 실내는 이미 어두워 나주의 ×0.86 을 그대로 쓰면 더 가라앉는다.
 * ※ 셰이더 문자열에는 ASCII 만 — 일부 드라이버가 한글 주석을 거부한다.
 */
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { Color, LinearSRGBColorSpace, Matrix4, Uniform, Vector3, type Camera } from "three";
import { wrapEffect } from "@react-three/postprocessing";

const FRAG = /* glsl */ `
uniform float uStrength;
uniform float uWidth;
uniform float uCreaseFar;
uniform float uEdgeFar;
uniform float uGrade;
uniform float uExposure;
uniform float uCool;
uniform float uSaturation;
uniform float uLift;
uniform float uPaper;
uniform float uWobble;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;

// world-anchored value noise - the wobble stays on the object instead of crawling over the screen
float wHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float wNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wHash(i), wHash(i + vec3(1, 0, 0)), f.x), mix(wHash(i + vec3(0, 1, 0)), wHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(wHash(i + vec3(0, 0, 1)), wHash(i + vec3(1, 0, 1)), f.x), mix(wHash(i + vec3(0, 1, 1)), wHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 worldAt(const in vec2 uv, const in float depth) {
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return (uCamWorld * vec4(v.xyz / v.w, 1.0)).xyz;
}
uniform vec3 uInk;

float distAt(const in vec2 p) { return -getViewZ(readDepth(p)); }

vec3 mangaGrade(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  c /= max(1.0, mx);
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float red = smoothstep(0.5, 0.25, c.g / max(c.r, 0.02)) * smoothstep(0.2, 0.45, sat) * step(c.b, c.r);
  float hot = max(red, smoothstep(0.6, 0.85, sat));
  c = mix(vec3(l), c, mix(1.05, 0.5, hot) * uSaturation);
  c *= uExposure * mix(1.0, 0.88, hot);
  c *= mix(mix(vec3(1.0), vec3(0.86, 0.9, 1.06), uCool), vec3(1.0), smoothstep(0.2, 0.55, l));
  c *= mix(vec3(1.0), vec3(1.03, 1.01, 0.96), smoothstep(0.7, 1.0, l));
  // lift mid tones only - pixels darker than about 0.1 (the unlit corridor) stay where they are
  c += uLift * c * (1.0 - c) * smoothstep(0.1, 0.3, l);
  return pow(clamp(c, 0.0, 1.0), vec3(2.2));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 col = mix(inputColor.rgb, mangaGrade(inputColor.rgb), uGrade);
  float e = 0.0;
  if (depth < 0.99999) {
    // hand-drawn pen: shift where the line is looked for and vary its weight, both from noise pinned to the world
    vec2 suv = uv;
    float weight = 1.0;
    if (uWobble > 0.0) {
      vec3 w = worldAt(uv, depth) * 0.9;
      suv += (vec2(wNoise(w), wNoise(w + 17.3)) - 0.5) * 2.0 * uWobble * texelSize;
      weight = mix(1.0, 0.55 + 0.9 * wNoise(w * 0.6 + 5.1), min(1.0, uWobble));
    }
    float d0 = distAt(suv);
    vec2 px = texelSize * uWidth * weight;
    float l = distAt(suv - vec2(px.x, 0.0));
    float r = distAt(suv + vec2(px.x, 0.0));
    float u = distAt(suv + vec2(0.0, px.y));
    float b = distAt(suv - vec2(0.0, px.y));
    float il = 1.0 / l, ir = 1.0 / r, iu = 1.0 / u, ib = 1.0 / b, i0 = 1.0 / d0;
    float lap = max(abs(il + ir - 2.0 * i0), abs(iu + ib - 2.0 * i0)) * d0;
    float eDisc = smoothstep(0.04, 0.12, lap) * (1.0 - smoothstep(uEdgeFar * 0.6, uEdgeFar, d0));
    float eCrease = smoothstep(0.006, 0.02, lap) * (1.0 - smoothstep(uCreaseFar * 0.5, uCreaseFar, d0));
    e = clamp(max(eDisc, eCrease), 0.0, 1.0) * uStrength;
  }
  // static paper grain - fixed on screen like the sheet the picture is drawn on
  vec2 cell = floor(uv * resolution / 2.0);
  float grain = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  col *= 1.0 + uPaper * grain;
  outputColor = vec4(mix(col, col * uInk, e), inputColor.a);
}
`;

export interface MangaEffectOptions {
  /** 선 진하기 0~1 */
  strength?: number;
  /** 선 굵기(화면 픽셀 배수) */
  width?: number;
  /** 모서리 선이 사라지는 거리(유닛, 1 유닛 ≈ 0.3 m) */
  creaseFar?: number;
  /** 윤곽선이 사라지는 거리(유닛) */
  edgeFar?: number;
  /** 색 보정 세기 0~1 */
  grade?: number;
  /** 색 보정의 밝기 배율 — 나주는 0.86 */
  exposure?: number;
  /** 어두운 곳을 차갑게 하는 세기 0~1 — 나주는 1. 실내는 화면 대부분이 어두워 1 이면 통째로 푸르게 뜬다 */
  cool?: number;
  /** 전체 채도 배율 — 나주는 1. 실내의 푸른 회색 벽을 나주의 차분한 회색 쪽으로 당긴다 */
  saturation?: number;
  /** 중간 밝기를 띄우는 세기 0~1. 아주 어두운 곳(불 꺼진 복도)은 건드리지 않는다 */
  lift?: number;
  /** 펜선 손떨림(화면 픽셀) — 세계에 붙은 잡음으로 선 자리·굵기를 흔든다. 0 = 곧은 선 */
  wobble?: number;
  /** 종이결 세기 0~1 — 화면에 고정된 아주 옅은 결(움직여도 반짝이지 않는다) */
  paper?: number;
  /** 선 색. 바탕색에 곱한다 — 나주는 붉은 먹(#473d3d) */
  ink?: string;
}

// 색 고르개의 16진수를 곱하는 숫자로 그대로 읽는다(#473d3d → 0.28, 0.24, 0.24). 선형 변환을 하면 먹이 새까매진다.
const inkVector = (hex: string) => {
  const c = new Color().setStyle(hex, LinearSRGBColorSpace);
  return new Vector3(c.r, c.g, c.b);
};

export class MangaEffectImpl extends Effect {
  constructor({
    strength = 0.9,
    width = 1.5,
    creaseFar = 60,
    edgeFar = 300,
    grade = 1,
    exposure = 0.86,
    cool = 1,
    saturation = 1,
    lift = 0,
    paper = 0,
    wobble = 0,
    ink = "#473d3d",
  }: MangaEffectOptions = {}) {
    super("MangaEffect", FRAG, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ["uStrength", new Uniform(strength)],
        ["uWidth", new Uniform(width)],
        ["uCreaseFar", new Uniform(creaseFar)],
        ["uEdgeFar", new Uniform(edgeFar)],
        ["uGrade", new Uniform(grade)],
        ["uExposure", new Uniform(exposure)],
        ["uCool", new Uniform(cool)],
        ["uSaturation", new Uniform(saturation)],
        ["uLift", new Uniform(lift)],
        ["uPaper", new Uniform(paper)],
        ["uWobble", new Uniform(wobble)],
        ["uInvProj", new Uniform(new Matrix4())],
        ["uCamWorld", new Uniform(new Matrix4())],
        ["uInk", new Uniform(inkVector(ink))],
      ]),
    });
  }

  private camera: Camera | null = null;

  // EffectPass 가 장면 카메라를 넘겨준다 — 손떨림 잡음을 세계에 붙이려고 깊이를 세계 좌표로 되돌릴 때 쓴다
  override set mainCamera(camera: Camera) {
    this.camera = camera;
  }

  override update() {
    if (!this.camera) return;
    (this.uniforms.get("uInvProj")?.value as Matrix4).copy(this.camera.projectionMatrixInverse);
    (this.uniforms.get("uCamWorld")?.value as Matrix4).copy(this.camera.matrixWorld);
  }
}

/** <EffectComposer> 안에 넣는다. 다른 효과보다 먼저 둔다. */
export const MangaEffect = wrapEffect(MangaEffectImpl);
