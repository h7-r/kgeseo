/**
 * 텍스처 잔결 펴기 — 칠한 툰의 ① 을 매 프레임 셰이더 대신 텍스처마다 한 번 GPU 로 구워 둔다.
 * 잔결(작은 밝기 차)은 밉맵 평균색으로 눌러 펴고, 굵은 무늬(글씨·줄눈·표식)는 남긴다.
 * 재질 셰이더에서 하면 픽셀마다 밉맵을 한 번 더 읽어 본부실이 25 % 느려졌다 — 구워 두면 그리는 값이 0 이다.
 * 원본 캔버스를 다시 그리면(글꼴이 늦게 와 다시 그리기 등) 판(version)이 바뀌어 다시 굽는다.
 * ※ 셰이더 문자열에는 ASCII 만.
 */
import * as THREE from "three";

export interface FlattenSettings {
  /** 잔결을 남기는 비율 0~1 */
  detail: number;
  /** 평균색을 읽을 밉맵 단계 — 클수록 넓게 편다 */
  lod: number;
  /** 손그림 세기 0~1 — 반복 텍스처(벽돌·타일·바닥)의 줄눈을 펜으로 그은 듯 흔들고 끊고, 칸마다 톤을 조금 다르게 */
  hand: number;
}

// 다시 그리는 텍스처(화면·글씨판)는 굽지 않는다 — 이만큼 바뀌면 움직이는 텍스처로 본다
const MAX_REBAKES = 3;

const bakeMaterial = new THREE.ShaderMaterial({
  uniforms: {
    source: { value: null },
    lod: { value: 4 },
    detail: { value: 0.3 },
    hand: { value: 0 },
    stepUv: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D source;
    uniform float lod;
    uniform float detail;
    uniform float hand;
    uniform vec2 stepUv;
    varying vec2 vUv;
    // sin-free hash + value noise, tiling with period p so the baked texture still repeats seamlessly
    float hash2(vec2 q) { vec3 p3 = fract(vec3(q.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float tnoise(vec2 x, float p) {
      vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
      float a = hash2(mod(i, p)), b = hash2(mod(i + vec2(1, 0), p)), c = hash2(mod(i + vec2(0, 1), p)), d = hash2(mod(i + vec2(1, 1), p));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    void main() {
      // hand: wobble the lookup by a texel or two so straight mortar lines waver like pen strokes
      vec2 wob = vec2(tnoise(vUv * 7.0, 7.0), tnoise(vUv * 7.0 + 3.7, 7.0)) - 0.5;
      vec2 uv = vUv + wob * stepUv * 9.0 * hand;
      vec4 texel = textureLod(source, uv, 0.0);
      // compare in sqrt space so dark textures keep the same threshold as bright ones
      vec3 avg = sqrt(max(textureLod(source, vUv, lod).rgb, 0.0));
      vec3 tex = sqrt(max(texel.rgb, 0.0));
      vec3 diff = tex - avg;
      float keep = smoothstep(0.05, 0.16, length(diff));
      vec3 painted = avg + diff * mix(detail, 1.0, keep);
      // hand: drawn lines (darker than the surround) thin out and break in places; patches vary a little in tone
      float ink = smoothstep(0.03, 0.12, -dot(diff, vec3(0.333)));
      float gap = smoothstep(0.55, 0.85, tnoise(vUv * 23.0, 23.0));
      painted = mix(painted, avg, ink * gap * min(1.0, hand * 1.5));
      painted *= 1.0 + (tnoise(vUv * 5.0 + 9.1, 5.0) - 0.5) * 0.2 * hand;
      gl_FragColor = vec4(painted * painted, texel.a);
      #include <colorspace_fragment>
    }`,
  depthTest: false,
  depthWrite: false,
});
const bakeScene = new THREE.Scene();
const bakeCamera = new THREE.Camera();
bakeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMaterial));

interface Baked {
  target: THREE.WebGLRenderTarget;
  version: number;
  settings: string;
}

let baked = new WeakMap<THREE.Texture, Baked>();
const rebakes = new WeakMap<THREE.Texture, number>();
const targets = new Set<THREE.WebGLRenderTarget>();

/** 구운 판을 전부 버린다(만화를 끌 때) — GPU 메모리를 원본 한 벌로 되돌린다 */
export function releaseFlattened() {
  targets.forEach((target) => target.dispose());
  targets.clear();
  baked = new WeakMap();
}

function imageSize(texture: THREE.Texture): { width: number; height: number } | null {
  const image = texture.image as { width?: number; height?: number } | null;
  if (!image?.width || !image.height) return null;
  return { width: image.width, height: image.height };
}

/** 원본의 반복·이동·회전을 그대로 옮긴다 — 재질은 맵의 행렬로 uv 를 읽는다 */
function copySampling(from: THREE.Texture, to: THREE.Texture) {
  to.wrapS = from.wrapS;
  to.wrapT = from.wrapT;
  to.repeat.copy(from.repeat);
  to.offset.copy(from.offset);
  to.center.copy(from.center);
  to.rotation = from.rotation;
  to.anisotropy = from.anisotropy;
  to.channel = from.channel;
  to.matrixAutoUpdate = from.matrixAutoUpdate;
  to.matrix.copy(from.matrix);
}

/**
 * 편 텍스처를 돌려준다. 구울 수 없는 텍스처(크기 모름·움직이는 텍스처)면 null — 원본을 그대로 쓴다.
 * 이미 구운 판이 최신이면 다시 굽지 않는다.
 */
export function flattenTexture(
  renderer: THREE.WebGLRenderer,
  source: THREE.Texture,
  settings: FlattenSettings,
): THREE.Texture | null {
  const size = imageSize(source);
  if (!size || (source as THREE.VideoTexture).isVideoTexture) return null;
  // 손그림은 반복 텍스처만 — 간판·라벨·표식은 또렷하게 남긴다
  const hand = source.wrapS === THREE.RepeatWrapping ? settings.hand : 0;
  const key = `${settings.detail}|${settings.lod}|${hand}`;
  const existing = baked.get(source);
  if (existing && existing.version === source.version && existing.settings === key) return existing.target.texture;
  if (existing && existing.version !== source.version) {
    const count = (rebakes.get(source) ?? 0) + 1;
    rebakes.set(source, count);
    if (count > MAX_REBAKES) return null;
  }

  const target =
    existing?.target ??
    new THREE.WebGLRenderTarget(size.width, size.height, {
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: source.colorSpace as THREE.ColorSpace,
    });
  targets.add(target);
  copySampling(source, target.texture);

  bakeMaterial.uniforms.source.value = source;
  bakeMaterial.uniforms.lod.value = settings.lod;
  bakeMaterial.uniforms.detail.value = settings.detail;
  bakeMaterial.uniforms.hand.value = hand;
  bakeMaterial.uniforms.stepUv.value.set(1 / size.width, 1 / size.height);
  const previousTarget = renderer.getRenderTarget();
  const previousAutoClear = renderer.autoClear;
  // 굽는 렌더가 씬에 걸린 그림자 다시 그리기 요청을 먹지 않게 — 그림자 절약(ShadowMapUpdater)이 이 깃발로 돈다
  const shadowPending = renderer.shadowMap.needsUpdate;
  renderer.autoClear = true;
  renderer.setRenderTarget(target);
  renderer.render(bakeScene, bakeCamera);
  renderer.setRenderTarget(previousTarget);
  renderer.autoClear = previousAutoClear;
  renderer.shadowMap.needsUpdate = shadowPending;
  bakeMaterial.uniforms.source.value = null;

  baked.set(source, { target, version: source.version, settings: key });
  return target.texture;
}
