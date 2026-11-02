import { useEffect, useRef } from "react";
import * as THREE from "three";

import { runWhenIdle } from "@/lib/idle";
import { clamp01, easeOutCubic } from "@/lib/math";
import { prefersReducedMotion } from "@/lib/motionPreference";

import HeroVideoFrame from "./HeroVideoFrame";

/**
 * 히어로 배경 영상 — WebGL 왜곡 + 스크롤 스크럽.
 *
 * HeroPin 트랙을 지나는 진행도(0~1)에 영상 시각을 맞춘다. 영상은 제 속도로 흐르다가
 * 스크롤이 앞서면 멈추고 그 자리로 찾아가 따라잡는다. 영상은 모든 프레임이 키프레임이라 seek 가 끊기지 않는다.
 *
 * 스크럽이 아니면 예고편으로 한 번만 튼다. 왜곡·암전·끊김은 영상에 구워져 있고, 끝나면 onEnd 로 알린 뒤
 * 바탕을 끝 화면 영상(나주 밤 강가를 천천히 미는 반복 영상)으로 바꾼다 — 그 위에 Hero 가 로고를 띄운다.
 * 끝 화면 바탕은 AMBIENT_VIDEO_URL 하나만 바꾸면 갈아 끼울 수 있다. replayKey 가 바뀌면 예고편을 처음부터 다시 튼다.
 * 셰이더 연출: 빨려드는 줌·렌즈, 스크롤할 때만 흔들림·색수차, 빠를 때 가로 띠가 어긋나는 글리치,
 * 가운데서 퍼지는 봉인 원, 로고가 뜰 때의 왜곡 한 번, 필름 그레인.
 */

// 영상 파일은 이름에 판을 붙인다 — 같은 이름으로 바꾸면 브라우저가 옛 영상을 계속 쓴다.
const HERO_VIDEO_URL = "/hero-trailer-v6.mp4";
// 끝 화면 바탕 반복 영상. 예고편이 흐르기 시작한 뒤에야 받는다 — 첫 화면 로딩을 나눠 쓰지 않게.
const AMBIENT_VIDEO_URL = "/hero-ambient-v1.mp4";
// 이만큼 지나도 영상이 흐르지 않으면(자동 재생 막힘·느린 망) 예고편을 건너뛰고 끝 화면을 띄운다.
const START_TIMEOUT_MS = 8000;
// 끝 화면 바탕이 암전에서 떠오르는 시간(로고가 먼저 뜨고 바탕이 뒤따른다)과, 로고와 함께 화면이 한 번 깨지는 시간.
const END_FADE_DELAY_MS = 900;
const END_FADE_MS = 1600;
const END_GLITCH_MS = 900;

const ZOOM_TARGET = 1.2;
// 핀 구간의 이 지점에서 영상이 끝나고, 나머지는 끝 장면을 붙잡는다 — 끝까지 봐야 아래로 넘어간다.
const VIDEO_END_AT = 0.85;
const SHAKE_GAIN = 5;
// 흔들림 구역 [진행도 중심, 폭, 세기] — 처음에 세게, 중간에 약하게 한 번 더.
const SHAKE_ZONES: readonly (readonly [center: number, width: number, strength: number])[] = [
  [0.1, 0.08, 1.0],
  [0.5, 0.1, 0.5],
];

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  uniform sampler2D uTex, uAmbient;
  uniform float uTime, uZoom, uShake, uWarp, uProg, uAspect, uGlitch, uEnd;
  uniform vec2 uScale;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

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

    // 왜곡: 굵은 띠가 크게 미끄러진다. 미끄러진 띠는 색수차 뒤에서 푸르게 물든다
    float slipBand = floor(vUv.y * 18.0);
    float sn = hash(vec2(slipBand, floor(uTime * 20.0)));
    float slip = step(1.0 - uGlitch * 0.38, sn) * (sn - 0.5) * 0.09 * uGlitch;
    uv.x += slip;

    // 봉인 원: 진행도만큼 퍼지며 지나가는 자리를 굴절시킨다
    vec2 q = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
    float ringR = uProg * 1.15;
    float ring = exp(-pow((length(q) - ringR) / 0.035, 2.0)) * sin(3.14159 * clamp(uProg, 0.0, 1.0));
    vec2 d = normalize(uv - vec2(0.5) + vec2(1e-4));
    uv += d * ring * 0.012;

    // 색수차: 흔들릴수록 R·B 채널을 서로 반대쪽으로 벌린다
    float ca = uShake * 0.004 + uWarp * 0.0025 + ring * 0.003 + uGlitch * 0.007;
    float r = texture2D(uTex, uv + d * ca).r;
    vec3  g = texture2D(uTex, uv).rgb;
    float b = texture2D(uTex, uv - d * ca).b;
    vec3 col = vec3(r, g.g, b);

    // 미끄러진 띠는 사이트 파랑(#6f86bf → #9fb2ea)으로 물들고, 왜곡 동안 밝기가 깜박인다
    col = mix(col, col * vec3(0.62, 0.72, 1.0) + vec3(0.06, 0.09, 0.2), step(0.0005, abs(slip)) * 0.6);
    col *= 1.0 - uGlitch * 0.12 * step(0.5, hash(vec2(floor(uTime * 30.0), 3.0)));

    // 끝 화면 바탕: 어둡게 다듬어 둔 반복 영상이 암전 위로 떠오른다(글자가 읽히게 영상 쪽에서 이미 눌러 두었다)
    if (uEnd > 0.001) col = mix(col, texture2D(uAmbient, uv).rgb, uEnd);

    col += vec3(0.38, 0.65, 0.98) * ring * 0.3;           // 봉인 원의 푸른 빛
    col += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 100.0) - 0.5) * (0.016 + uShake * 0.025); // 그레인
    gl_FragColor = vec4(col, 1.0);
  }
`;

type Mode = "scrub" | "trailer";

interface HeroUniforms {
  [uniform: string]: THREE.IUniform;
  uTex: THREE.IUniform<THREE.VideoTexture>;
  uAmbient: THREE.IUniform<THREE.Texture>;
  uTime: THREE.IUniform<number>;
  uZoom: THREE.IUniform<number>;
  uShake: THREE.IUniform<number>;
  uWarp: THREE.IUniform<number>;
  uProg: THREE.IUniform<number>;
  uAspect: THREE.IUniform<number>;
  uGlitch: THREE.IUniform<number>;
  uEnd: THREE.IUniform<number>;
  uScale: THREE.IUniform<THREE.Vector2>;
}

interface HeroResources {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
  uniforms: HeroUniforms;
  /** 끝 화면 바탕. 예고편이 흐르기 시작할 때 만든다. */
  ambient: { video: HTMLVideoElement; texture: THREE.VideoTexture } | null;
}

/** mount 가 돌려주는 손잡이. */
interface HeroPlayer {
  /** 예고편을 처음부터 다시 튼다(끝 화면 → 예고편). */
  replay: () => void;
  dispose: () => void;
}

function createVideo(src: string): HTMLVideoElement {
  const video = document.createElement("video");
  video.src = src;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.preload = "auto";
  return video;
}

function createVideoTexture(video: HTMLVideoElement): THREE.VideoTexture {
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

// 모드별로 하나씩만 만들어 다시 쓴다 — 홈으로 돌아올 때마다 WebGL 문맥·셰이더·영상을 새로 만들면 쪽 이동 직후가 길게 막힌다.
const resourceCache: Partial<Record<Mode, HeroResources>> = {};

function createResources(): HeroResources | null {
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

  // 스크럽이든 예고편이든 반복하지 않는다 — 예고편은 끝나면 끝 화면으로 넘어간다.
  const video = createVideo(HERO_VIDEO_URL);
  const texture = createVideoTexture(video);

  const uniforms: HeroUniforms = {
    uTex: { value: texture },
    // 끝 화면 영상이 오기 전까지는 예고편 마지막 장면(암전)을 그대로 쓴다.
    uAmbient: { value: texture },
    uTime: { value: 0 },
    uZoom: { value: 1.0 },
    uShake: { value: 0 },
    uWarp: { value: 0 },
    uProg: { value: 0 },
    uAspect: { value: 16 / 9 },
    uGlitch: { value: 0 },
    uEnd: { value: 0 },
    uScale: { value: new THREE.Vector2(1, 1) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return { renderer, scene, camera, video, texture, uniforms, ambient: null };
}

/** 끝 화면 바탕 영상을 준비한다. 한 번만 만들고 자원과 함께 남겨 둔다. */
function prepareAmbient(resources: HeroResources) {
  if (resources.ambient) return resources.ambient;
  const video = createVideo(AMBIENT_VIDEO_URL);
  video.loop = true;
  const texture = createVideoTexture(video);
  resources.ambient = { video, texture };
  return resources.ambient;
}

/**
 * 캔버스를 붙이고 렌더 루프를 돌린다. 떼어 낼 손잡이를 돌려준다.
 * 예고편이 끝나면(또는 틀 수 없으면) onEnd(다시 틀 수 있는가)를 부른다.
 */
function mount(container: HTMLElement, onEnd: (canReplay: boolean) => void): HeroPlayer | undefined {
  const isReducedMotion = prefersReducedMotion();
  // HeroPin 트랙 안에 있을 때만 스크럽하고, 아니면 예고편으로 한 번 튼다.
  const track = container.closest<HTMLElement>("[data-pin-track]");
  const sticky = track?.querySelector<HTMLElement>("[data-pin-sticky]") ?? null;
  const isScrub = Boolean(track && sticky) && !isReducedMotion;

  let isDead = false;
  let frame = 0;
  let isVisible = true;

  const mode: Mode = isScrub ? "scrub" : "trailer";
  const resources = resourceCache[mode] ?? createResources();
  if (!resources) {
    onEnd(false); // WebGL 불가 — 정지 화면 위에 바로 끝 화면
    return undefined;
  }
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
  if (hasFrame) {
    try {
      video.currentTime = 0; // 처음 온 것처럼 첫 장면부터(홈으로 돌아오면 예고편을 다시 튼다)
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
    if (video.videoWidth) videoAspect = video.videoWidth / video.videoHeight;
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

  // 예고편 끝: 한 번만 알리고 바탕을 끝 화면 영상으로 돌린다
  let endedAt = -1;
  const finish = () => {
    if (endedAt >= 0 || isDead) return;
    endedAt = performance.now();
    needsRedraw = true;
    const ambient = resources.ambient;
    if (ambient) {
      uniforms.uAmbient.value = ambient.texture;
      ambient.video.play().catch(() => {});
    }
    onEnd(video.currentTime > 0.1);
  };
  // 예고편이 실제로 흐르기 시작하면 그제야 끝 화면 영상을 받기 시작한다.
  const handlePlaying = () => {
    if (!isScrub) prepareAmbient(resources);
  };
  video.addEventListener("playing", handlePlaying);
  const startTimer = isScrub
    ? 0
    : window.setTimeout(() => {
        if (video.currentTime < 0.1) finish();
      }, START_TIMEOUT_MS);

  if (isScrub) {
    window.addEventListener("scroll", readProgress, { passive: true });
    window.addEventListener("resize", readProgress);
    window.addEventListener("pageshow", readProgress);
    readProgress();
  } else {
    uniforms.uEnd.value = 0;
    uniforms.uAmbient.value = texture;
    video.addEventListener("ended", finish);
    video.addEventListener("error", finish);
    video.play().catch(finish);
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
    if (endedAt >= 0) {
      const since = now - endedAt;
      // 끝 화면 영상이 아직 첫 장면을 못 받았으면 암전을 붙잡는다.
      const isAmbientReady = (resources.ambient?.video.readyState ?? 0) >= 2;
      uniforms.uEnd.value = isAmbientReady ? clamp01((since - END_FADE_DELAY_MS) / END_FADE_MS) : 0;
      // 로고가 뜰 때 바탕도 한 번 크게 깨지고 잦아든다. 그 뒤로는 조용하다(로고 뒤가 깜박이지 않게).
      const burst = Math.max(0, 1 - since / END_GLITCH_MS);
      uniforms.uGlitch.value = burst * burst;
    } else {
      uniforms.uEnd.value = 0;
      uniforms.uGlitch.value = 0;
    }

    if (!isVisible || document.hidden || isLeaving) return;
    const isMoving =
      Math.abs(target - current) > 0 || shake > 0.002 || uniforms.uGlitch.value > 0.002 || uniforms.uEnd.value > 0;
    const hasNewFrame = texture.version !== lastTextureVersion;
    if (needsRedraw || hasNewFrame || isMoving || now - lastRenderedAt >= 33) {
      renderer.render(scene, camera);
      lastTextureVersion = texture.version;
      lastRenderedAt = now;
      needsRedraw = false;
    }
  };
  frame = requestAnimationFrame(tick);

  const replay = () => {
    if (isScrub || isDead) return;
    endedAt = -1;
    uniforms.uEnd.value = 0;
    uniforms.uAmbient.value = texture;
    resources.ambient?.video.pause();
    try {
      video.currentTime = 0;
    } catch {
      // 아직 옮길 수 없으면 처음 자리 그대로다.
    }
    video.play().catch(finish);
  };

  const dispose = () => {
    isDead = true;
    cancelAnimationFrame(frame);
    window.clearTimeout(startTimer);
    video.removeEventListener("playing", handlePlaying);
    video.removeEventListener("ended", finish);
    video.removeEventListener("error", finish);
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
      resources.ambient?.video.pause();
    } catch {
      // 문서에서 떨어진 영상이면 던진다. 멈출 것이 없으니 넘어간다.
    }
    // 자원은 버리지 않는다 — 다음에 홈으로 오면 그대로 다시 붙인다.
    canvas.remove();
  };

  return { replay, dispose };
}

interface HeroVideoProps {
  /** 예고편이 끝났다(틀 수 없을 때·동작 줄이기 포함). canReplay 는 「예고편 다시 보기」를 띄워도 되는가. */
  onEnd: (canReplay: boolean) => void;
  /** 바뀔 때마다 예고편을 처음부터 다시 튼다. */
  replayKey: number;
  /** 끝 화면인가 — 포스터만 보일 때(WebGL 불가) 바탕을 어둡게 누른다. */
  isEnded: boolean;
}

/** 히어로 배경. three.js 를 부르므로 lazy 로 떼어 쓰고, 받는 동안 Hero 가 같은 HeroVideoFrame 을 보여 준다. */
export default function HeroVideo({ onEnd, replayKey, isEnded }: HeroVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HeroPlayer | null>(null);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // 동작 줄이기: 예고편 없이 포스터 위 끝 화면만.
    if (prefersReducedMotion()) {
      onEndRef.current(false);
      return;
    }
    // WebGL 문맥 생성은 주 스레드를 1초 넘게 막아 첫 화면을 늦춘다. 처음엔 한가할 때 만든다(포스터가 이미 깔려 있다).
    let isCancelled = false;
    const start = () => {
      if (!isCancelled) playerRef.current = mount(container, (canReplay) => onEndRef.current(canReplay)) ?? null;
    };
    let cancelIdle: (() => void) | null = null;
    if (resourceCache.scrub || resourceCache.trailer) start();
    else cancelIdle = runWhenIdle(start, 1200, 200);
    return () => {
      isCancelled = true;
      cancelIdle?.();
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  // 처음 값(0)에는 이미 예고편이 돌고 있다. 그 뒤로 바뀔 때만 다시 튼다.
  useEffect(() => {
    if (replayKey > 0) playerRef.current?.replay();
  }, [replayKey]);

  return <HeroVideoFrame boxRef={containerRef} isEnded={isEnded} />;
}
