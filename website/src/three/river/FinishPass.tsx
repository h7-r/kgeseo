import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { NOISE, STORY } from "./glsl";
import { journeyInput, MAX_SCRIMS } from "./journey";
import type { SharedUniforms } from "./world";

// 장면을 한 장에 그린 뒤 한 패스로 마무리한다. 효과마다 패스를 따로 두면 화면을 여러 번 읽고 쓴다.
//  · 글 자리(scrim): 페이지의 글 덩이가 놓인 자리만 장면을 흐리고 어둡게 눌러 글이 늘 차분한 바탕 위에 앉게 한다.
//  · 게임 모습의 먹선: 깊이가 꺾이는 자리에 외곽선 — 본부실 화면과 같은 툰 윤곽.
//  · 왜곡: 아지랑이처럼 휘는 화면과 이따금 어긋나는 가로 띠(약하게). 구역이 바뀌는 순간과 봉인이 맞물리는 순간만 크게.
//  · 빛 번짐·그레인·비네트.

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAGMENT = /* glsl */ `
  #include <packing>
  uniform float uTime;
  ${NOISE}
  ${STORY}
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;
  uniform vec2 uTexel;
  uniform vec2 uViewport;
  uniform float uPulse;
  uniform float uLock;
  uniform vec2 uLockCenter;
  uniform vec4 uScrims[${MAX_SCRIMS}];
  uniform int uScrimCount;
  uniform vec3 uInk;
  uniform vec3 uCalm;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  // 깊이 → 1/거리. 평면에선 화면을 따라 곧게 변해 물·바닥 같은 넓은 면에 거짓 선이 생기지 않는다.
  float inverseDistance(vec2 uv) {
    float viewZ = perspectiveDepthToViewZ(texture2D(tDepth, uv).r, uNear, uFar);
    return 1.0 / max(-viewZ, 0.01);
  }

  float roundedBox(vec2 p, vec2 halfSize, float radius) {
    vec2 q = abs(p) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  }

  void main() {
    vec2 uv = vUv;
    vec2 centered = vUv - 0.5;
    float aspect = uViewport.x / uViewport.y;
    float d = uDistort;
    float g = uPulse;

    // 아지랑이 — 왜곡만큼 화면이 느리게 출렁인다.
    vec2 flow = vec2(valueNoise(vUv * vec2(4.0, 7.0) + uTime * 0.12), valueNoise(vUv * vec2(6.0, 4.0) - uTime * 0.1)) - 0.5;
    uv += flow * d * 0.006;

    // 이따금 가로 띠 몇 줄이 옆으로 어긋난다.
    float band = floor(vUv.y * 46.0);
    float tick = floor(uTime * 9.0);
    float bandNoise = hash(vec2(band, tick));
    float burst = step(0.88, hash(vec2(tick, 3.0)));
    uv.x += step(1.0 - d * 0.04 * burst - g * 0.5, bandNoise) * (bandNoise - 0.5) * (0.03 * d + 0.11 * g);

    // 봉인이 맞물리는 순간 — 봉인 자리에서 퍼지는 고리 충격파.
    vec2 fromLock = (vUv - uLockCenter) * vec2(aspect, 1.0);
    float ringRadius = (1.0 - uLock) * 1.3;
    float shock = exp(-pow((length(fromLock) - ringRadius) / 0.035, 2.0)) * uLock;
    uv -= normalize(fromLock + 1e-4) * shock * 0.02;

    // 구역 바뀜 — 빨려드는 렌즈와 물결.
    uv -= centered * g * 0.08 * (0.3 + dot(centered, centered) * 3.0);
    uv += g * 0.005 * vec2(sin(vUv.y * 70.0 + uTime * 45.0), sin(vUv.x * 50.0 - uTime * 31.0));

    vec2 spread = normalize(centered + 1e-4) * (d * 0.0015 + g * 0.014 + shock * 0.01);
    vec3 col = vec3(texture2D(tScene, uv + spread).r, texture2D(tScene, uv).g, texture2D(tScene, uv - spread).b);

    // 게임 모습의 먹선.
    if (uGame > 0.01) {
      float here = inverseDistance(uv);
      float around = inverseDistance(uv + vec2(uTexel.x, 0.0)) + inverseDistance(uv - vec2(uTexel.x, 0.0))
                   + inverseDistance(uv + vec2(0.0, uTexel.y)) + inverseDistance(uv - vec2(0.0, uTexel.y));
      float edge = abs(4.0 * here - around) / max(here, 1e-4);
      col = mix(col, uInk, smoothstep(0.12, 0.3, edge) * uGame * 0.9);
    }

    // 빛 번짐 — 흐린 밉맵 두 층에서 밝은 몫만 더한다(달·창·가로등·솔기).
    vec3 haze = textureLod(tScene, uv, 3.0).rgb * 0.5 + textureLod(tScene, uv, 5.0).rgb * 0.45;
    col += max(haze - 0.32, 0.0) * 0.8;
    col += vec3(0.62, 0.7, 0.92) * shock * 0.3;

    // 글 자리 — 흐린 밉맵을 채도 빼고 어둡게. 가장자리는 넓게 풀어 판이 아니라 그늘로 보이게 한다.
    float calm = 0.0;
    vec2 pixel = vUv * uViewport;
    for (int i = 0; i < ${MAX_SCRIMS}; i++) {
      if (i >= uScrimCount) break;
      vec4 rect = uScrims[i] * vec4(uViewport, uViewport);
      vec2 center = (rect.xy + rect.zw) * 0.5;
      vec2 halfSize = (rect.zw - rect.xy) * 0.5;
      float edgeDistance = roundedBox(pixel - center, halfSize, 40.0);
      calm = max(calm, 1.0 - smoothstep(-30.0, 110.0, edgeDistance));
    }
    if (calm > 0.001) {
      vec3 blurred = textureLod(tScene, vUv, 4.5).rgb;
      // 밝은 창은 밝기를 눌러 둬야 글 뒤에서 비쳐 나오지 않는다.
      float glow = min(dot(blurred, vec3(0.3, 0.59, 0.11)), 0.5);
      vec3 quiet = uCalm + vec3(glow * 0.16);
      col = mix(col, quiet, calm * 0.94);
    }

    // 노출을 조금 올리고 1 을 넘는 빛을 부드럽게 접는다.
    col *= 1.25;
    col = col / (1.0 + max(col - 0.8, 0.0));
    col = pow(col, vec3(0.92));

    float vignette = smoothstep(1.2, 0.3, length(centered * vec2(aspect * 0.75, 1.0)));
    col *= mix(0.6, 1.0, vignette);
    col += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 100.0) - 0.5) * (0.025 + g * 0.06);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** 구역이 바뀐 뒤 일그러짐이 사는 시간(초). */
const PULSE_DURATION = 0.55;

interface FinishPassProps {
  uniforms: SharedUniforms;
  /** 봉인이 맞물린 순간의 번쩍임(SealFragments 가 1 로 올리고 서서히 꺼진다). */
  lockPulse: { value: number };
  /** 봉인 고리의 화면 자리(0~1). */
  lockCenter: THREE.Vector2;
  /** MSAA 표본 수. 0 이면 끈다. */
  samples: number;
  /** false 면 구역 바뀜 일그러짐을 걸지 않는다(동작 줄이기). */
  animated: boolean;
}

/** 장면 렌더를 넘겨받아 마무리 패스로 화면에 그린다. useFrame 우선순위 1 — R3F 기본 렌더를 대신한다. */
export default function FinishPass({ uniforms, lockPulse, lockCenter, samples, animated }: FinishPassProps) {
  const { gl, scene, camera, size, viewport } = useThree();

  const target = useMemo(() => {
    const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    renderTarget.depthTexture = new THREE.DepthTexture(1, 1);
    return renderTarget;
  }, [samples]);
  useEffect(() => () => target.dispose(), [target]);

  const pass = useMemo(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: uniforms.uTime,
        uDistort: uniforms.uDistort,
        uGame: uniforms.uGame,
        tScene: { value: null },
        tDepth: { value: null },
        uNear: { value: perspective.near },
        uFar: { value: perspective.far },
        uTexel: { value: new THREE.Vector2() },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uPulse: { value: 0 },
        uLock: lockPulse,
        uLockCenter: { value: lockCenter },
        uScrims: { value: Array.from({ length: MAX_SCRIMS }, () => new THREE.Vector4()) },
        uScrimCount: { value: 0 },
        uInk: { value: new THREE.Color("#04070e") },
        uCalm: { value: new THREE.Color("#02050c") },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const quadScene = new THREE.Scene();
    quadScene.add(quad);
    return { material, quadScene, quadCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }, [uniforms, lockPulse, lockCenter, camera]);
  useEffect(() => () => pass.material.dispose(), [pass]);

  // 사각형은 장면 밖에 있어 ShaderPrewarm 의 컴파일에 안 걸린다. 처음 쓰이는 순간 멈칫하지 않게 미리 굽는다.
  useEffect(() => {
    gl.compileAsync(pass.quadScene, pass.quadCamera).catch(() => {});
  }, [gl, pass]);

  useEffect(() => {
    const width = Math.round(size.width * viewport.dpr);
    const height = Math.round(size.height * viewport.dpr);
    target.setSize(width, height);
    pass.material.uniforms.uTexel.value.set(1 / width, 1 / height);
    pass.material.uniforms.uViewport.value.set(size.width, size.height);
  }, [target, pass, size, viewport.dpr]);

  const lastSectionRef = useRef(-1);
  const pulseStartRef = useRef(-10);

  useFrame(({ clock }) => {
    const now = clock.getElapsedTime();
    const passUniforms = pass.material.uniforms;

    const section = journeyInput.section;
    if (section !== lastSectionRef.current) {
      // 처음 붙을 때는 일그러뜨리지 않는다.
      if (lastSectionRef.current !== -1 && animated) pulseStartRef.current = now;
      lastSectionRef.current = section;
    }
    const age = (now - pulseStartRef.current) / PULSE_DURATION;
    // 확 터졌다가 빠르게 가라앉는다. 중간에 한 번 더 튀어 기계가 덜컥이는 느낌을 준다.
    passUniforms.uPulse.value =
      age < 0 || age > 1
        ? 0
        : THREE.MathUtils.smoothstep(age, 0, 0.08) * (1 - age) ** 2 + 0.35 * Math.exp(-(((age - 0.5) / 0.06) ** 2));

    const scrims = passUniforms.uScrims.value as THREE.Vector4[];
    const count = Math.min(MAX_SCRIMS, journeyInput.scrimCount);
    for (let i = 0; i < count; i += 1) {
      const [x0, y0, x1, y1] = journeyInput.scrims[i];
      // 페이지 좌표(위 기준) → 화면 좌표(아래 기준)
      scrims[i].set(x0, 1 - y1, x1, 1 - y0);
    }
    passUniforms.uScrimCount.value = count;

    gl.setRenderTarget(target);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    passUniforms.tScene.value = target.texture;
    passUniforms.tDepth.value = target.depthTexture;
    gl.render(pass.quadScene, pass.quadCamera);
  }, 1);

  return null;
}
