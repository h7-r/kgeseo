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
 *          낮게 깔린 면은 지운다: 깊이가 끊긴 두 점을 세계 위치로 되돌려 높이 차가 수평 거리의 5~12% 밖이면 선을 안 긋는다.
 *          (10/29) 먼 강물을 낮은 각도로 보면 물결 마루 뒤 골이 가려져 깊이가 끊기고, 그게 물결마다 가로줄로 그어졌다.
 *   ② 색   쨍한 빨강·자홍(옻칠·붉은 천)만 골라 채도를 누르고 · 전체 밝기 ×0.86 · 어두운 곳은 차갑게 · 밝은 곳은 따뜻하게.
 *          나무 갈색(초록이 빨강의 절반 이상)은 건드리지 않는다.
 *   로그 깊이(logarithmicDepthBuffer)는 postprocessing 의 readDepth 가 풀어 준다.
 *
 * [같이 바뀌는 것] 만화를 켜면 NajuScene 의 세계 껍데기 외곽선(drei <Outlines>)을 끈다 — 선이 두 겹이 되므로.
 * ※ 셰이더 문자열에는 ASCII 만 (windShader.ts 와 같은 이유).
 */
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { PerspectiveCamera, Uniform, Vector2, Vector3, type Camera } from "three";
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
uniform float uInkBlack;
uniform vec2 uTanHalf;
uniform vec3 uUpView;

float distAt(const in vec2 p) { return -getViewZ(readDepth(p)); }
vec3 viewPosAt(const in vec2 p, const in float dist) { return vec3((p * 2.0 - 1.0) * uTanHalf * dist, -dist); }

// 0 = flat sheet seen edge-on (water ripples, flat ground), 1 = real step (rock, boat, wall)
float steepness(const in vec2 uv, const in float d0, const in vec2 nuv, const in float dn) {
  vec3 delta = viewPosAt(nuv, dn) - viewPosAt(uv, d0);
  float dy = dot(delta, uUpView);
  float dh = length(delta - dy * uUpView);
  return smoothstep(0.05, 0.12, abs(dy) / max(dh, 1e-4));
}

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
    // the neighbour that differs most decides whether this is a real step
    float dn = l; vec2 nuv = uv - vec2(px.x, 0.0);
    if (abs(r - d0) > abs(dn - d0)) { dn = r; nuv = uv + vec2(px.x, 0.0); }
    if (abs(u - d0) > abs(dn - d0)) { dn = u; nuv = uv + vec2(0.0, px.y); }
    if (abs(b - d0) > abs(dn - d0)) { dn = b; nuv = uv - vec2(0.0, px.y); }
    lap *= steepness(uv, d0, nuv, dn);
    float eDisc = smoothstep(0.04, 0.12, lap) * (1.0 - smoothstep(uEdgeFar * 0.6, uEdgeFar, d0));
    float eCrease = smoothstep(0.003, 0.012, lap) * (1.0 - smoothstep(uCreaseFar * 0.5, uCreaseFar, d0));
    e = clamp(max(eDisc, eCrease), 0.0, 1.0) * uStrength;
  }
  // 선 색 — 바탕을 어둡게 눌러 그린다. 물속(uInkBlack)에서는 둘레 빛을 타지 않는 먹선으로
  vec3 ink = mix(col * vec3(0.28, 0.24, 0.24), vec3(0.012, 0.014, 0.016), uInkBlack);
  outputColor = vec4(mix(col, ink, e), inputColor.a);
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

/** 선 색 손잡이 — black 이 1 이면 선이 먹빛(물속 장면이 켠다) */
export const mangaInk = { black: 0 };

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
        ["uInkBlack", new Uniform(0)],
        ["uTanHalf", new Uniform(new Vector2(1, 1))],
        ["uUpView", new Uniform(new Vector3(0, 1, 0))],
      ]),
    });
  }

  /** 선을 지울지 가리려고 화면 → 세계 높이를 되돌린다 — 그 계산에 쓸 카메라 */
  private camera: Camera | null = null;

  override set mainCamera(camera: Camera) {
    this.camera = camera;
  }

  override update() {
    const camera = this.camera;
    (this.uniforms.get("uInkBlack")! as Uniform<number>).value = mangaInk.black;
    if (!camera) return;
    if (camera instanceof PerspectiveCamera) {
      const tanY = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom;
      (this.uniforms.get("uTanHalf")!.value as Vector2).set(tanY * camera.aspect, tanY);
    }
    // 세계의 위쪽(0,1,0)을 카메라 좌표로
    (this.uniforms.get("uUpView")!.value as Vector3).set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
  }
}

/** <EffectComposer> 안에 넣는다 */
export const MangaEffect = wrapEffect(MangaEffectImpl);
