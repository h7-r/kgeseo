import { useEffect, useRef } from "react";
import * as THREE from "three";

import { runWhenIdle } from "@/lib/idle";
import { clamp01 } from "@/lib/math";
import { prefersReducedMotion } from "@/lib/motionPreference";

import HeroVideoFrame from "./HeroVideoFrame";

/**
 * 히어로 배경 영상 — WebGL 왜곡 + 스크롤 스크럽.
 *
 * HeroPin 트랙을 지나는 진행도(0~1)에 영상 시각을 맞춘다. 영상은 제 속도로 흐르다가
 * 스크롤이 앞서면 멈추고 그 자리로 찾아가 따라잡는다. hero-scrub.mp4 는 모든 프레임이 키프레임이라 seek 가 끊기지 않는다.
 *
 * 셰이더 연출: 빨려드는 줌·렌즈, 스크롤할 때만 흔들림·색수차, 빠를 때 가로 띠가 어긋나는 글리치,
 * 가운데서 퍼지는 봉인 원, 끝에 가까울수록 셀 셰이딩(게임 세계), 필름 그레인.
 */

const ZOOM_TARGET = 1.2;
// 핀 구간의 이 지점에서 영상이 끝나고, 나머지는 끝 장면을 붙잡는다 — 끝까지 봐야 아래로 넘어간다.
const VIDEO_END_AT = 0.85;
const SHAKE_GAIN = 5;
// 흔들림 구역 [진행도 중심, 폭, 세기] — 처음에 세게, 중간에 약하게 한 번 더.
const SHAKE_ZONES: readonly (readonly [center: number, width: number, strength: number])[] = [
  [0.1, 0.08, 1.0],
  [0.5, 0.1, 0.5],
];
// 끝에서 셀 셰이딩으로 바뀌는 정도(0 이면 끔). 더 올리면 화질이 뭉개져 보인다.
const WORLD_SHIFT = 0.28;

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  uniform sampler2D uTex;
  uniform float uTime, uZoom, uShake, uWarp, uProg, uAspect, uWorld;
  uniform vec2 uScale, uTexel;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main(){
    vec2 uv = (vUv - 0.5) * uScale + 0.5;                 // cover 맞춤
    uv = (uv - 0.5) / uZoom + 0.5;                        // 줌인
    float rad = distance(uv, vec2(0.5));
    uv += (vec2(0.5) - uv) * uWarp * 0.18 * rad;          // 빨려드는 렌즈

    // 흔들림: 화면 전체 떨림 + 물결
    uv += uShake * 0.005 * vec2(sin(uTime * 38.0), sin(uTime * 30.0 + 1.7));
    uv += uShake * 0.003 * vec2(sin(uv.y * 42.0 + uTime * 22.0), sin(uv.x * 38.0 - uTime * 19.0));

    // 글리치: 빠르게 스크롤할 때만 가로 띠 몇 줄이 옆으로 어긋난다
    float band = floor(vUv.y * 36.0);
    float n = hash(vec2(band, floor(uTime * 14.0)));
    uv.x += step(1.0 - uShake * 0.08, n) * (n - 0.5) * 0.035 * uShake;

    // 봉인 원: 진행도만큼 퍼지며 지나가는 자리를 굴절시킨다
    vec2 q = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
    float ringR = uProg * 1.15;
    float ring = exp(-pow((length(q) - ringR) / 0.035, 2.0)) * sin(3.14159 * clamp(uProg, 0.0, 1.0));
    vec2 d = normalize(uv - vec2(0.5) + vec2(1e-4));
    uv += d * ring * 0.012;

    // 색수차: 흔들릴수록 R·B 채널을 서로 반대쪽으로 벌린다
    float ca = uShake * 0.004 + uWarp * 0.0025 + ring * 0.003;
    float r = texture2D(uTex, uv + d * ca).r;
    vec3  g = texture2D(uTex, uv).rgb;
    float b = texture2D(uTex, uv - d * ca).b;
    vec3 col = vec3(r, g.g, b);

    // 게임 세계: 단계 색 + 부드러운 윤곽선
    float world = uWorld * smoothstep(0.55, 0.95, uProg);
    if (world > 0.001) {
      float lx = lum(texture2D(uTex, uv + vec2(uTexel.x * 1.5, 0.0)).rgb) - lum(texture2D(uTex, uv - vec2(uTexel.x * 1.5, 0.0)).rgb);
      float ly = lum(texture2D(uTex, uv + vec2(0.0, uTexel.y * 1.5)).rgb) - lum(texture2D(uTex, uv - vec2(0.0, uTexel.y * 1.5)).rgb);
      float edge = smoothstep(0.06, 0.2, length(vec2(lx, ly)));
      vec3 toon = floor(col * 9.0 + 0.5) / 9.0;
      vec3 cel = mix(toon, vec3(0.03, 0.06, 0.13), edge * 0.75);
      col = mix(col, cel, world);
    }

    col += vec3(0.38, 0.65, 0.98) * ring * 0.3;           // 봉인 원의 푸른 빛
    col += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 100.0) - 0.5) * (0.016 + uShake * 0.025); // 그레인
    gl_FragColor = vec4(col, 1.0);
  }
`;

type Mode = "scrub" | "loop";

interface HeroUniforms {
  [uniform: string]: THREE.IUniform;
  uTex: THREE.IUniform<THREE.VideoTexture>;
  uTime: THREE.IUniform<number>;
  uZoom: THREE.IUniform<number>;
  uShake: THREE.IUniform<number>;
  uWarp: THREE.IUniform<number>;
  uProg: THREE.IUniform<number>;
  uAspect: THREE.IUniform<number>;
  uWorld: THREE.IUniform<number>;
  uScale: THREE.IUniform<THREE.Vector2>;
  uTexel: THREE.IUniform<THREE.Vector2>;
}

interface HeroResources {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
  uniforms: HeroUniforms;
}

// 모드별로 하나씩만 만들어 다시 쓴다 — 홈으로 돌아올 때마다 WebGL 문맥·셰이더·영상을 새로 만들면 쪽 이동 직후가 길게 막힌다.
const resourceCache: Partial<Record<Mode, HeroResources>> = {};

function createResources(isScrub: boolean, isReducedMotion: boolean): HeroResources | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: false, antialias: false, powerPreference: "low-power" });
  } catch {
    return null; // WebGL 불가 — 포스터 바탕이 그대로 보인다.
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x43587f, 1);
  renderer.debug.checkShaderErrors = !import.meta.env.PROD;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;

  // 스크럽이 아닐 때(동작 줄이기 등)도 같은 영상을 반복해 쓴다.
  const video = document.createElement("video");
  video.src = "/hero-scrub.mp4";
  video.muted = true;
  video.loop = !isScrub;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.preload = "auto";

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const uniforms: HeroUniforms = {
    uTex: { value: texture },
    uTime: { value: 0 },
    uZoom: { value: 1.0 },
    uShake: { value: 0 },
    uWarp: { value: 0 },
    uProg: { value: 0 },
    uAspect: { value: 16 / 9 },
    uWorld: { value: isReducedMotion ? 0 : WORLD_SHIFT },
    uScale: { value: new THREE.Vector2(1, 1) },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return { renderer, scene, camera, video, texture, uniforms };
}

const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

/** 캔버스를 붙이고 렌더 루프를 돌린다. 떼어 낼 때 부를 정리 함수를 돌려준다. */
function mount(container: HTMLElement): (() => void) | undefined {
  const isReducedMotion = prefersReducedMotion();
  // HeroPin 트랙 안에 있을 때만 스크럽하고, 아니면 그냥 반복 재생한다.
  const track = container.closest<HTMLElement>("[data-pin-track]");
  const sticky = track?.querySelector<HTMLElement>("[data-pin-sticky]") ?? null;
  const isScrub = Boolean(track && sticky) && !isReducedMotion;

  let isDead = false;
  let frame = 0;
  let isVisible = true;

  const mode: Mode = isScrub ? "scrub" : "loop";
  const resources = resourceCache[mode] ?? createResources(isScrub, isReducedMotion);
  if (!resources) return undefined;
  resourceCache[mode] = resources;
  const { renderer, scene, camera, video, texture, uniforms } = resources;

  // 다른 쪽으로 가는 순간(주소가 바뀌기 직전) 바로 멈춘다 — 떼어질 때까지 새 페이지와 GPU 를 나눠 쓰지 않게.
  let isLeaving = false;
  const handleNavigate = (event: NavigateEvent) => {
    try {
      if (new URL(event.destination.url).pathname === location.pathname) return; // 질의만 바뀌면 그대로
    } catch {
      return;
    }
    isLeaving = true;
    try {
      video.pause();
    } catch {
      // 문서에서 떨어진 영상이면 던진다. 멈출 것이 없으니 넘어간다.
    }
  };
  window.navigation?.addEventListener?.("navigate", handleNavigate);

  const canvas = renderer.domElement;
  const hasFrame = video.readyState >= 2;
  canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;opacity:${hasFrame ? 1 : 0};transition:opacity .8s ease`;
  container.appendChild(canvas);
  if (hasFrame && isScrub) {
    try {
      video.currentTime = 0; // 처음 온 것처럼 첫 장면부터
    } catch {
      // 아직 옮길 수 없는 상태면 그대로 둔다.
    }
  }

  let videoAspect = 16 / 9;
  let needsRedraw = true;
  // 캔버스 버퍼는 무대 배율이 적용된, 화면에 실제로 보이는 크기로 잡는다. 1920 설계 크기로 잡으면 GPU 가 포화된다.
  const fit = () => {
    const rect = container.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    needsRedraw = true;
    const aspect = width / height;
    uniforms.uAspect.value = aspect;
    uniforms.uScale.value.set(Math.min(1, aspect / videoAspect), Math.min(1, videoAspect / aspect));
  };
  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(container);
  // 창 폭이 바뀌면 배율만 바뀌고 칸의 설계 크기는 그대로라 ResizeObserver 로는 못 잡는다.
  window.addEventListener("resize", fit);

  const intersectionObserver = new IntersectionObserver(([entry]) => {
    isVisible = Boolean(entry?.isIntersecting);
  });
  intersectionObserver.observe(container);

  let target = 0;
  let current = 0;
  const readProgress = () => {
    if (!isScrub || !track || !sticky) return;
    const rect = track.getBoundingClientRect();
    const distance = Math.max(1, track.offsetHeight - sticky.offsetHeight);
    target = clamp01(-rect.top / distance);
  };

  // 영상은 제 속도로 흐르되 스크롤이 앞서면 따라간다. 끝에 닿으면 맨 위일 때만 다시 처음부터, 아니면 끝 장면을 붙잡는다.
  const seek = () => {
    if (!isScrub || isDead || isLeaving || video.readyState < 1 || video.seeking || !video.duration) return;
    if (!isVisible) {
      if (!video.paused) video.pause();
      return;
    }
    const end = Math.max(0, video.duration - 0.06);
    const time = Math.min(Math.min(1, current / VIDEO_END_AT) * video.duration, end);
    if (!Number.isFinite(time)) return;
    if (time > video.currentTime + 0.05) {
      // 멈추고 찾아간다. seeked 가 다시 불러 계속 따라간다.
      if (!video.paused) video.pause();
      video.currentTime = time;
    } else if (video.paused) {
      if (video.ended || video.currentTime >= end - 0.01) {
        if (current < 0.02) {
          video.currentTime = 0;
          video.play().catch(() => {});
        }
      } else {
        video.play().catch(() => {});
      }
    }
  };

  const prepare = () => {
    if (video.videoWidth) {
      videoAspect = video.videoWidth / video.videoHeight;
      uniforms.uTexel.value.set(1 / video.videoWidth, 1 / video.videoHeight);
    }
    fit();
    readProgress();
    seek();
    texture.needsUpdate = true;
  };
  const handleLoadedData = () => {
    prepare();
    canvas.style.opacity = "1";
  };
  const handleSeeked = () => {
    texture.needsUpdate = true;
    seek();
  };
  video.addEventListener("loadedmetadata", prepare);
  video.addEventListener("loadeddata", handleLoadedData);
  video.addEventListener("seeked", handleSeeked);
  if (hasFrame) prepare();

  if (isScrub) {
    window.addEventListener("scroll", readProgress, { passive: true });
    window.addEventListener("resize", readProgress);
    window.addEventListener("pageshow", readProgress);
    readProgress();
  } else {
    video.play().catch(() => {});
  }

  let shake = 0;
  // 바뀐 게 있을 때만 그린다: 새 영상 장면, 스크롤 추적·흔들림 중, 크기 변경, 또는 33ms 경과(그레인이 30장/초로 일렁이게).
  let lastTextureVersion = -1;
  let lastRenderedAt = 0;

  const tick = (now: number) => {
    if (isDead) return;
    frame = requestAnimationFrame(tick);

    let progress = 0;
    let speed = 0;
    if (isScrub) {
      const delta = target - current;
      current += delta * 0.2;
      if (Math.abs(target - current) < 0.0004) current = target;
      seek();
      progress = current;
      speed = Math.abs(delta);
    }

    let zone = 0;
    for (const [center, width, strength] of SHAKE_ZONES) {
      const x = (progress - center) / width;
      zone += strength * Math.exp(-x * x);
    }
    const targetShake = isReducedMotion ? 0 : Math.min(1, Math.min(1, speed * SHAKE_GAIN) * (0.35 + zone));
    shake += (targetShake - shake) * 0.2;

    uniforms.uTime.value = now / 1000;
    uniforms.uZoom.value = 1 + (ZOOM_TARGET - 1) * easeOutCubic(progress);
    uniforms.uShake.value = shake;
    uniforms.uWarp.value = isReducedMotion ? 0 : shake * (0.5 + (1 - progress) * 0.5);
    uniforms.uProg.value = isReducedMotion ? 0 : progress;

    if (!isVisible || document.hidden || isLeaving) return;
    const isMoving = Math.abs(target - current) > 0 || shake > 0.002;
    const hasNewFrame = texture.version !== lastTextureVersion;
    if (needsRedraw || hasNewFrame || isMoving || now - lastRenderedAt >= 33) {
      renderer.render(scene, camera);
      lastTextureVersion = texture.version;
      lastRenderedAt = now;
      needsRedraw = false;
    }
  };
  frame = requestAnimationFrame(tick);

  return () => {
    isDead = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    window.removeEventListener("resize", fit);
    window.navigation?.removeEventListener?.("navigate", handleNavigate);
    window.removeEventListener("scroll", readProgress);
    window.removeEventListener("resize", readProgress);
    window.removeEventListener("pageshow", readProgress);
    video.removeEventListener("loadedmetadata", prepare);
    video.removeEventListener("loadeddata", handleLoadedData);
    video.removeEventListener("seeked", handleSeeked);
    try {
      video.pause();
    } catch {
      // 문서에서 떨어진 영상이면 던진다. 멈출 것이 없으니 넘어간다.
    }
    // 자원은 버리지 않는다 — 다음에 홈으로 오면 그대로 다시 붙인다.
    canvas.remove();
  };
}

/** 히어로 배경. three.js 를 부르므로 lazy 로 떼어 쓰고, 받는 동안 Hero 가 같은 HeroVideoFrame 을 보여 준다. */
export default function HeroVideo() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // WebGL 문맥 생성은 주 스레드를 1초 넘게 막아 첫 화면을 늦춘다. 처음엔 한가할 때 만든다(포스터가 이미 깔려 있다).
    let cleanup: (() => void) | null = null;
    let isCancelled = false;
    const start = () => {
      if (!isCancelled) cleanup = mount(container) ?? null;
    };
    let cancelIdle: (() => void) | null = null;
    if (resourceCache.scrub || resourceCache.loop) start();
    else cancelIdle = runWhenIdle(start, 1200, 200);
    return () => {
      isCancelled = true;
      cancelIdle?.();
      cleanup?.();
    };
  }, []);

  return <HeroVideoFrame boxRef={containerRef} />;
}
