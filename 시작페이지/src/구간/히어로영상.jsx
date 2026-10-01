import { useEffect, useRef } from "react";
import * as THREE from "three";
import { 칸스타일, 영상어둠 } from "./히어로영상자리.jsx";

/**
 * 히어로 배경 영상 (WebGL 왜곡 · 스크롤 스크럽).
 *
 * 힉스필드(waegok ScrollInvestigation)와 같은 방식:
 *  · 영상은 멈춰 둔다(pause). 재생하지 않는다.
 *  · 히어로핀.jsx 의 트랙을 지나는 진행도(0~1)만큼 currentTime 을 옮긴다(seek).
 *    → 스크롤을 끝까지 내려야 영상도 끝까지 간다. 멈추면 영상도 멈춘다.
 *  · 진행도는 곧장 따라가지 않고 0.2 씩 따라간다(부드러운 스크럽).
 *  · 스크럽용 영상(hero-scrub.mp4)은 모든 프레임이 키프레임이라 seek 가 끊기지 않는다.
 *
 * 셰이더로 얹는 「왜곡」 — 게임 설정에 맞춘 것들:
 *  · 빨려드는 줌 / 렌즈      — 진행할수록 화면 안으로 들어간다
 *  · 흔들림 · 색수차         — 스크롤이 움직일 때만
 *  · 기록 왜곡(글리치 띠)    — 빠르게 스크롤할 때 가로 띠가 옆으로 어긋난다 (「조각난 기록」)
 *  · 봉인 원                 — 가운데서 퍼지는 푸른 고리가 지나가는 자리를 굴절시킨다
 *                              (게임의 「빛나는 원 진입 = 봉인 연출」)
 *  · 현실 → 게임 세계        — 끝에 가까울수록 실사가 셀 셰이딩(단계 색 + 윤곽선)으로 바뀐다
 *  · 필름 그레인             — 게임 후처리와 같은 결의 잔 알갱이
 */

/* ── 조절 값 ── */
const 줌목표 = 1.2; // 끝까지 스크롤했을 때 줌 배율
/* 영상이 핀 구간의 몇 % 지점에서 끝나나. 나머지는 끝 장면을 붙잡고 있다가 풀린다
   → "영상 끝까지 본 다음에야" 아래로 넘어간다 (1 이면 풀리는 순간 딱 끝) */
const 영상끝지점 = 0.85;
const 흔들게인 = 5; // 스크럽 속도 → 흔들림 세기 (22 → 12 → 8 → 5 — 더 줄여 달라는 의견)
/* 흔들림 구역 [진행도 중심, 폭, 세기] — 처음에 세게, 중간에 약하게 한 번 더 */
const 흔들림들 = [
  [0.1, 0.08, 1.0],
  [0.5, 0.1, 0.5],
];
const 세계변환 = 0.28; // 끝에서 게임 세계(셀 셰이딩)로 바뀌는 정도 0~1 (0 이면 끔) — 0.45 는 화질이 뭉개져 보였다

const 정점셰이더 = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }
`;

/* GLSL 변수 이름은 영어만 된다(주석은 한글 가능) */
const 조각셰이더 = `
  precision mediump float;
  uniform sampler2D uTex;
  uniform float uTime, uZoom, uShake, uWarp, uProg, uAspect, uWorld;
  uniform vec2 uScale, uTexel;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main(){
    vec2 uv = (vUv - 0.5) * uScale + 0.5;                 /* cover 맞춤 */
    uv = (uv - 0.5) / uZoom + 0.5;                        /* 줌인 */
    float rad = distance(uv, vec2(0.5));
    uv += (vec2(0.5) - uv) * uWarp * 0.18 * rad;          /* 빨려드는 렌즈 */

    /* 흔들림 — 화면 전체 지터 + 난류 (예전보다 약하게) */
    uv += uShake * 0.005 * vec2(sin(uTime * 38.0), sin(uTime * 30.0 + 1.7)); /* 화면 전체 떨림 폭 0.011 → 0.0075 → 0.005 */
    uv += uShake * 0.003 * vec2(sin(uv.y * 42.0 + uTime * 22.0), sin(uv.x * 38.0 - uTime * 19.0)); /* 물결 떨림 0.007 → 0.005 → 0.003 */

    /* 기록 왜곡 — 빠르게 스크롤할 때만 가로 띠 몇 줄이 옆으로 어긋난다 */
    float band = floor(vUv.y * 36.0);
    float n = hash(vec2(band, floor(uTime * 14.0)));
    uv.x += step(1.0 - uShake * 0.08, n) * (n - 0.5) * 0.035 * uShake; /* 어긋나는 띠도 줄였다 */

    /* 봉인 원 — 진행도만큼 가운데서 퍼지는 고리. 지나가는 자리가 굴절된다 */
    vec2 q = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
    float ringR = uProg * 1.15;
    float ring = exp(-pow((length(q) - ringR) / 0.035, 2.0)) * sin(3.14159 * clamp(uProg, 0.0, 1.0));
    vec2 d = normalize(uv - vec2(0.5) + vec2(1e-4));
    uv += d * ring * 0.012;

    /* 색수차 */
    float ca = uShake * 0.004 + uWarp * 0.0025 + ring * 0.003; /* 색 번짐을 줄여 화질을 지킨다 */
    float r = texture2D(uTex, uv + d * ca).r;
    vec3  g = texture2D(uTex, uv).rgb;
    float b = texture2D(uTex, uv - d * ca).b;
    vec3 col = vec3(r, g.g, b);

    /* 현실 → 게임 세계 — 단계 색(셀 셰이딩) + 부드러운 윤곽선 */
    float world = uWorld * smoothstep(0.55, 0.95, uProg);
    if (world > 0.001) {
      float lx = lum(texture2D(uTex, uv + vec2(uTexel.x * 1.5, 0.0)).rgb) - lum(texture2D(uTex, uv - vec2(uTexel.x * 1.5, 0.0)).rgb);
      float ly = lum(texture2D(uTex, uv + vec2(0.0, uTexel.y * 1.5)).rgb) - lum(texture2D(uTex, uv - vec2(0.0, uTexel.y * 1.5)).rgb);
      float edge = smoothstep(0.06, 0.2, length(vec2(lx, ly)));
      vec3 toon = floor(col * 9.0 + 0.5) / 9.0; /* 단계 6 → 9 — 색이 덜 뭉개진다 */
      vec3 cel = mix(toon, vec3(0.03, 0.06, 0.13), edge * 0.75);
      col = mix(col, cel, world);
    }

    col += vec3(0.38, 0.65, 0.98) * ring * 0.3;           /* 봉인 원의 푸른 빛 */
    col += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 100.0) - 0.5) * (0.016 + uShake * 0.025); /* 그레인 — 0.035 는 화질이 떨어져 보였다 */
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* 모드별로 하나씩만 — 쪽을 오가도 다시 만들지 않는다 */
const 보관 = {};

/* 캔버스를 붙이고 렌더 루프를 돌린다. 떼어 낼 때 부를 정리 함수를 돌려준다. */
function 붙이기(el) {
  const 정지 = matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* 히어로핀 트랙 안에 있을 때만 스크럽. 아니면(다른 곳에 쓰일 때) 그냥 반복 재생 */
  const 트랙 = el.closest("[data-핀트랙]");
  const 스티키 = 트랙?.querySelector("[data-핀스티키]");
  const 스크럽 = !!(트랙 && 스티키) && !정지;

  let dead = false;
  let frame = 0;
  let visible = true;

  /* ★ 성능: 렌더러·영상·텍스처를 **한 번만** 만들어 두고 다시 쓴다.
     전에는 홈으로 돌아올 때마다 WebGL 문맥을 새로 만들고(문맥 생성 + 셰이더 컴파일
     + 첫 텍스처 업로드) 7~12MB 영상을 다시 붙였다 — 쪽 이동 직후 긴 작업의 주범.
     떠날 땐 멈추고 캔버스만 떼어 둔다. */
  const 모드 = 스크럽 ? "스크럽" : "반복";
  let 자원 = 보관[모드];
  if (!자원) {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: false, antialias: false, powerPreference: "low-power" });
    } catch (e) {
      return; // WebGL 불가 → 섹션 바탕색이 그대로 보인다
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 1.5 → 2 — 레티나에서 흐릿했다
    renderer.setClearColor(0x43587f, 1);
    renderer.debug.checkShaderErrors = !import.meta.env.PROD;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    camera.position.z = 1;
    const video = document.createElement("video");
    /* 스크럽이 아닐 때(동작 줄이기 등)도 같은 영상을 쓴다 — 따로 두던 반복 영상 파일은 public 에 없어 404 가 났다 */
    video.src = "/hero-scrub.mp4";
    video.muted = true;
    video.loop = !스크럽;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.preload = "auto";
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const uniform = {
      uTex: { value: tex },
      uTime: { value: 0 },
      uZoom: { value: 1.0 },
      uShake: { value: 0 },
      uWarp: { value: 0 },
      uProg: { value: 0 },
      uAspect: { value: 16 / 9 },
      uWorld: { value: 정지 ? 0 : 세계변환 },
      uScale: { value: new THREE.Vector2(1, 1) },
      uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
    };
    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.ShaderMaterial({ uniforms: uniform, vertexShader: 정점셰이더, fragmentShader: 조각셰이더 });
    scene.add(new THREE.Mesh(geo, mat));
    자원 = 보관[모드] = { renderer, scene, camera, video, tex, uniform };
  }
  const { renderer, scene, camera, video, tex, uniform } = 자원;

  /* ★ 성능(쪽 전환): 다른 쪽으로 가는 순간 **바로** 그리기를 멈춘다.
     라우터는 새 페이지를 React 「전환」으로 그리는데, 그동안 이 페이지는 아직 붙어 있어서
     전엔 떼어질 때까지 매 프레임 셰이더를 돌리고 영상도 계속 풀었다(GPU 를 새 페이지와 나눠 씀).
     Navigation API 의 navigate 사건은 주소가 바뀌기 **직전**에 알려 준다 — 메인이 아닌 곳으로
     가면 멈춘다. (이 API 가 없는 브라우저는 예전처럼 떼어질 때 멈춘다 — 동작은 같다) */
  let 떠나는중 = false;
  const 떠남 = (e) => {
    try {
      if (new URL(e.destination.url).pathname === location.pathname) return; // 같은 쪽(? 뒤만 바뀜)은 그대로
    } catch (오류) { return; }
    떠나는중 = true;
    try { video.pause(); } catch (오류) {}
  };
  window.navigation?.addEventListener?.("navigate", 떠남);

  const cv = renderer.domElement;
  const 이미있음 = video.readyState >= 2;
  cv.style.cssText = `position:absolute;inset:0;width:100%;height:100%;opacity:${이미있음 ? 1 : 0};transition:opacity .8s ease`;
  el.appendChild(cv);
  if (이미있음 && 스크럽) { try { video.currentTime = 0; } catch (e) {} } // 처음 온 것처럼 첫 장면부터

  let 영상비 = 16 / 9;
  let 다시그림 = true; // 크기가 바뀌었거나 막 붙었을 때 — 다음 프레임에 꼭 한 장 그린다
  const 맞춤 = () => {
    /* ★ 성능: 그림판(캔버스 버퍼)을 **화면에 실제로 보이는 크기**로 잡는다.
       [전엔] clientWidth(= 1920 설계 크기)로 잡았다. 이 칸은 무대 배율(scale)로 줄여
       보여 주니, 1440 창이면 화면엔 1440×862 로 보이는데 1920×1149 를 그리고 있었다
       (레티나면 3840×2298 = 880만 픽셀). 셰이더가 픽셀마다 영상을 5~9번 읽으니 GPU 가 포화됐다.
       getBoundingClientRect 는 배율이 적용된 크기라, 보이는 만큼만 그린다.
       (보이는 픽셀 수 × 기기 배율 그대로라 선명함은 같다 — 오히려 줄여 보일 때 뭉개짐이 없다)
       CSS 크기(width/height 100%)는 그대로 두고 버퍼 크기만 바꾼다 → setSize(…, false) */
    const 상자 = el.getBoundingClientRect();
    const w = Math.round(상자.width), h = Math.round(상자.height);
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    다시그림 = true;
    const r = w / h;
    uniform.uAspect.value = r;
    uniform.uScale.value.set(Math.min(1, r / 영상비), Math.min(1, 영상비 / r));
  };
  const ro = new ResizeObserver(맞춤);
  ro.observe(el);
  /* 창 폭이 바뀌면 배율이 바뀐다 — 칸의 설계 크기(1920)는 그대로라 ResizeObserver 로는 못 잡는다 */
  window.addEventListener("resize", 맞춤);

  const io = new IntersectionObserver(([v]) => { visible = v.isIntersecting; });
  io.observe(el);

  /* ── 스크롤 진행도 (힉스필드와 같은 식) ── */
  const clamp = (n) => Math.max(0, Math.min(1, n));
  let target = 0;
  let current = 0;
  const 읽기 = () => {
    if (!스크럽) return;
    const box = 트랙.getBoundingClientRect();
    const 거리 = Math.max(1, 트랙.offsetHeight - 스티키.offsetHeight);
    target = clamp(-box.top / 거리);
  };
  /* ── 영상 시각 정하기: 「스스로 흐르되, 스크롤이 앞서면 따라간다」 ──
     [전엔] 영상 시각 = 스크롤 위치. 그래서 스크롤을 안 하면 첫 장면에 멈춰 있었다.
     [지금] 영상은 기본으로 **제 속도로 재생**된다(스크롤 안 해도 흐른다).
       · 스크롤이 영상보다 앞서면(빨리 내리면) 멈추고 그 자리로 찾아가 따라잡는다.
       · 스크롤을 멈추면 그 자리에서 다시 제 속도로 흐른다.
       · 끝까지 가면: 맨 위(스크롤 전)라면 처음부터 다시, 아니면 끝 장면을 붙잡는다.
     핀이 풀리는 조건(스크롤 끝)은 그대로라 「끝까지 봐야 내려간다」도 그대로다. */
  const seek = () => {
    if (!스크럽 || dead || 떠나는중 || video.readyState < 1 || video.seeking || !video.duration) return;
    if (!visible) { if (!video.paused) video.pause(); return; } // 안 보이면 쉰다
    const 끝 = Math.max(0, video.duration - 0.06);
    const t = Math.min(Math.min(1, current / 영상끝지점) * video.duration, 끝);
    if (!Number.isFinite(t)) return;
    if (t > video.currentTime + 0.05) {
      /* 스크롤이 앞섰다 → 멈추고 찾아간다 (seeked 가 다시 불러 계속 따라간다) */
      if (!video.paused) video.pause();
      video.currentTime = t;
    } else if (video.paused) {
      if (video.ended || video.currentTime >= 끝 - 0.01) {
        if (current < 0.02) { video.currentTime = 0; video.play().catch(() => {}); } // 맨 위면 반복
      } else {
        video.play().catch(() => {}); // 그 자리부터 제 속도로
      }
    }
  };
  const 준비 = () => {
    if (video.videoWidth) {
      영상비 = video.videoWidth / video.videoHeight;
      uniform.uTexel.value.set(1 / video.videoWidth, 1 / video.videoHeight);
    }
    맞춤();
    읽기();
    seek();
    tex.needsUpdate = true;
  };
  const 데이터됨 = () => { 준비(); cv.style.opacity = "1"; };
  const 찾음 = () => { tex.needsUpdate = true; seek(); };
  video.addEventListener("loadedmetadata", 준비);
  video.addEventListener("loadeddata", 데이터됨);
  video.addEventListener("seeked", 찾음);
  if (이미있음) 준비();

  if (스크럽) {
    window.addEventListener("scroll", 읽기, { passive: true });
    window.addEventListener("resize", 읽기);
    window.addEventListener("pageshow", 읽기);
    읽기();
  } else {
    video.play().catch(() => {});
  }

  const ease = (x) => 1 - Math.pow(1 - x, 3); // 처음 확, 뒤로 천천히
  let shake = 0;
  /* ★ 성능: 「바뀐 게 있을 때만」 그린다.
     [전엔] 아무것도 안 바뀌어도 매 rAF(60~120번/초) 셰이더 전체를 다시 그렸다.
     그런데 영상은 초당 30장이라, 두 번에 한 번은 **똑같은 그림**을 또 그린 셈이다.
     [지금] 아래 중 하나라도 있으면 그린다.
       · 영상에 새 장면이 들어왔다(VideoTexture 가 새 장면마다 version 을 올린다)
       · 스크롤을 따라가는 중이다 / 흔들림이 남아 있다
       · 크기가 바뀌었거나 막 붙었다
       · 마지막으로 그린 지 33ms(≈30장/초)가 지났다 — 끝 장면을 붙잡고 있을 때도
         그레인(잔 알갱이)이 영상과 같은 30장/초로 계속 일렁이게 */
  let 지난판 = -1;
  let 지난그림 = 0;


  const tick = (now) => {
    if (dead) return;
    frame = requestAnimationFrame(tick);

    let p = 0;
    let 속도 = 0;
    if (스크럽) {
      const 차이 = target - current;
      current += 차이 * 0.2;
      if (Math.abs(target - current) < 0.0004) current = target;
      seek();
      p = current;
      속도 = Math.abs(차이);
    }

    /* 흔들림 — 스크롤이 움직일 때만. 흔들림 구역에서는 더 세게 */
    let 구역 = 0;
    for (const [c, w, a] of 흔들림들) { const x = (p - c) / w; 구역 += a * Math.exp(-x * x); }
    const 목표흔들 = 정지 ? 0 : Math.min(1, Math.min(1, 속도 * 흔들게인) * (0.35 + 구역));
    shake += (목표흔들 - shake) * 0.2;

    uniform.uTime.value = now / 1000;
    uniform.uZoom.value = 1 + (줌목표 - 1) * ease(p);
    uniform.uShake.value = shake;
    uniform.uWarp.value = 정지 ? 0 : shake * (0.5 + (1 - p) * 0.5);
    uniform.uProg.value = 정지 ? 0 : p;

    if (!visible || document.hidden || 떠나는중) return;
    const 움직임중 = Math.abs(target - current) > 0 || shake > 0.002;
    const 새장면 = tex.version !== 지난판;
    if (다시그림 || 새장면 || 움직임중 || now - 지난그림 >= 33) {
      renderer.render(scene, camera);
      지난판 = tex.version;
      지난그림 = now;
      다시그림 = false;
    }
  };
  frame = requestAnimationFrame(tick);

  return () => {
    dead = true;
    cancelAnimationFrame(frame);
    ro.disconnect();
    io.disconnect();
    window.removeEventListener("resize", 맞춤);
    window.navigation?.removeEventListener?.("navigate", 떠남);
    window.removeEventListener("scroll", 읽기);
    window.removeEventListener("resize", 읽기);
    window.removeEventListener("pageshow", 읽기);
    video.removeEventListener("loadedmetadata", 준비);
    video.removeEventListener("loadeddata", 데이터됨);
    video.removeEventListener("seeked", 찾음);
    try { video.pause(); } catch (e) {}
    /* 버리지 않는다 — 다음에 홈으로 오면 그대로 다시 붙인다 (보관 참고) */
    cv.remove();
  };
}

export default function 히어로영상() {
  const 칸 = useRef(null);

  useEffect(() => {
    const el = 칸.current;
    if (!el) return;
    /* ★ 성능(첫 화면 LCP): WebGL 문맥 만들기는 이 기계에서 1초 넘게 주 스레드를 막았다
       (getContext + 셰이더 컴파일). 그게 첫 그림보다 먼저 일어나 첫 화면이 늦게 떴다.
       히어로 칸에는 이미 **같은 첫 장면(포스터)** 이 깔려 있으니, 첫 화면을 먼저 그리고
       한가해질 때 문맥을 만든다. 캔버스는 0.8초 동안 포스터 위로 스며들어 바뀌는 순간이 안 보인다.
       두 번째부터(홈으로 돌아올 때)는 보관해 둔 렌더러를 쓰니 기다리지 않고 바로 붙인다. */
    let 정리 = null;
    let 그만 = false;
    const 시작 = () => { if (!그만) 정리 = 붙이기(el) || null; };
    let 예약 = 0;
    const 모드있음 = 보관.스크럽 || 보관.반복;
    if (모드있음) 시작();
    else 예약 = window.requestIdleCallback ? requestIdleCallback(시작, { timeout: 1200 }) : setTimeout(시작, 200);
    return () => {
      그만 = true;
      if (예약) { if (window.cancelIdleCallback) cancelIdleCallback(예약); else clearTimeout(예약); }
      정리?.();
    };
  }, []);

  return (
    <>
      <div ref={칸} style={칸스타일} aria-hidden="true" />
      <div style={영상어둠} aria-hidden="true" />
    </>
  );
}

/* 칸스타일·영상어둠 은 히어로영상자리.js 로 옮겼다 — three 없이 먼저 그릴 수 있게 */
