import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { RIVER_FILM } from "@/data/videos";
import { PAGE_CHANGE_EVENT } from "@/lib/pageEvents";

import { NOISE } from "./glsl";
import { followHomeScroll } from "./homeScroll";
import { journeyInput } from "./journey";
import { storyAt, type StoryState } from "./story";

// 홈 배경 — 실제 나주맵을 고화질로 찍어 둔 필름을 스크롤로 넘긴다. 진행도 0~1 이 곧 필름의 시각이다.
// 필름은 멈춰 있어도 살아 있어야 해서, 왜곡(아지랑이)과 필름 전체를 덮는 반투명 막은 이 패스가 실시간으로 얹는다.

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  ${NOISE}
  uniform sampler2D tFilm;
  uniform vec2 uViewport;
  uniform vec2 uCover;
  uniform float uDistort;
  uniform float uPulse;
  uniform vec3 uVeil;
  uniform vec3 uRim;
  uniform float uTopInset;
  varying vec2 vUv;

  const float FILM_VISIBILITY = 0.42;
  const vec2 FRAME_INSET = vec2(18.0, 18.0);

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  float roundedBox(vec2 p, vec2 halfSize, float radius) {
    vec2 q = abs(p) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  }

  // 화면을 가득 채우게 필름을 잘라 읽는다.
  vec2 filmUv(vec2 uv) { return (uv - 0.5) * uCover + 0.5; }

  void main() {
    vec2 uv = vUv;
    vec2 centered = vUv - 0.5;
    float aspect = uViewport.x / uViewport.y;
    float d = uDistort;
    float g = uPulse;

    vec2 flow = vec2(valueNoise(vUv * vec2(4.0, 7.0) + uTime * 0.12), valueNoise(vUv * vec2(6.0, 4.0) - uTime * 0.1)) - 0.5;
    uv += flow * d * 0.005;

    // 구역 바뀜 — 렌즈가 잠깐 숨을 쉰다. 끊겨 보이지 않게 어긋남 없이 부드럽게만.
    uv -= centered * g * 0.03 * (0.3 + dot(centered, centered) * 3.0);

    vec2 spread = normalize(centered + 1e-4) * (d * 0.0008 + g * 0.004);
    vec3 col = vec3(
      texture2D(tFilm, filmUv(uv + spread)).r,
      texture2D(tFilm, filmUv(uv)).g,
      texture2D(tFilm, filmUv(uv - spread)).b
    );

    float vignette = smoothstep(1.2, 0.35, length(centered * vec2(aspect * 0.75, 1.0)));
    col *= mix(0.72, 1.0, vignette);

    // 필름 전체에 씌운 반투명 막 — 영상은 옅게 비치고 글이 앞에 선다.
    col = mix(uVeil, col, FILM_VISIBILITY);

    // 막의 테두리. 머리글 아래부터 화면 가장자리를 따라 한 줄.
    vec2 frameCenter = vec2(uViewport.x * 0.5, (uViewport.y - uTopInset) * 0.5);
    vec2 frameHalf = vec2(uViewport.x * 0.5, (uViewport.y - uTopInset) * 0.5) - FRAME_INSET;
    float frameEdge = abs(roundedBox(vUv * uViewport - frameCenter, frameHalf, 18.0));
    col += uRim * (1.0 - smoothstep(0.4, 1.4, frameEdge)) * 0.26;
    // 그레인 — 어두운 하늘의 계단을 지운다.
    col += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 100.0) - 0.5) * (0.022 + g * 0.06);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** 구역이 바뀐 뒤 일그러짐이 사는 시간(초). */
const PULSE_DURATION = 0.55;
/** 필름 초당 칸 수 — 칸 가운데를 짚어야 브라우저가 앞뒤 칸을 헷갈리지 않는다. */
const FILM_FPS = 30;

/** 한 번에 쫓아가는 빠르기의 한도(칸/초). 구역을 건너뛰어도 칸을 뭉텅이로 넘지 않아 필름이 이어져 보인다. */
const MAX_CHASE_FRAMES_PER_SECOND = 75;

function chaseStep(gap: number, step: number, lastFrame: number): number {
  const eased = gap * (1 - Math.exp(-step * 4));
  const limit = (MAX_CHASE_FRAMES_PER_SECOND * step) / Math.max(1, lastFrame);
  return THREE.MathUtils.clamp(eased, -limit, limit);
}

/** 필름을 통째로 받아 둔다. 스트리밍으로 두면 못 받은 자리로 넘길 때마다 화면이 멈춘다. */
function useFilmVideo(onFail: () => void): HTMLVideoElement | null {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) {
      onFail();
      return undefined;
    }
    const controller = new AbortController();
    let objectUrl = "";
    fetch(RIVER_FILM.src, { signal: controller.signal, priority: "low" })
      .then((response) => {
        if (!response.ok) throw new Error(`필름을 받지 못했습니다: ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        const element = document.createElement("video");
        element.muted = true;
        element.playsInline = true;
        element.preload = "auto";
        element.src = objectUrl;
        element.addEventListener("loadeddata", () => setVideo(element), { once: true });
        element.addEventListener("error", onFail, { once: true });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) onFail();
        if (import.meta.env.DEV && !controller.signal.aborted) console.warn(error);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [onFail]);

  return video;
}

interface FilmPlaneProps {
  video: HTMLVideoElement;
  reducedMotion: boolean;
  followHome: boolean;
  onFirstFrame: () => void;
  beat: { current: number };
}

function FilmPlane({ video, reducedMotion, followHome, onFirstFrame, beat }: FilmPlaneProps) {
  const { size, invalidate } = useThree();
  const progressRef = useRef(-1);
  const story = useMemo<StoryState>(() => ({ distort: 0, game: 0 }), []);
  const lastSectionRef = useRef(-1);
  const pulseStartRef = useRef(-10);

  const texture = useMemo(() => {
    const filmTexture = new THREE.VideoTexture(video);
    filmTexture.generateMipmaps = true;
    filmTexture.minFilter = THREE.LinearMipmapLinearFilter;
    filmTexture.magFilter = THREE.LinearFilter;
    return filmTexture;
  }, [video]);
  useEffect(() => () => texture.dispose(), [texture]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          tFilm: { value: texture },
          uViewport: { value: new THREE.Vector2(1, 1) },
          uCover: { value: new THREE.Vector2(1, 1) },
          uDistort: { value: 0 },
          uPulse: { value: 0 },
          uVeil: { value: new THREE.Color("#04081a") },
          uTopInset: { value: 0 },
          uRim: { value: new THREE.Color("#9fb2ea") },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        depthTest: false,
        depthWrite: false,
      }),
    [texture],
  );
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const viewportAspect = size.width / size.height;
    const filmAspect = video.videoWidth / video.videoHeight;
    material.uniforms.uViewport.value.set(size.width, size.height);
    material.uniforms.uTopInset.value = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    // 창이 필름보다 넓으면 위아래를, 좁으면 좌우를 자른다.
    material.uniforms.uCover.value.set(Math.min(1, viewportAspect / filmAspect), Math.min(1, filmAspect / viewportAspect));
  }, [material, size, video]);

  // 새 칸이 풀리면 VideoTexture 가 알아서 올린다. 여기서는 동작 줄이기의 한 장 그리기와 첫 칸 알림만 맡는다.
  useEffect(() => {
    let isFirst = true;
    const handleSeeked = () => {
      invalidate();
      if (isFirst) {
        isFirst = false;
        onFirstFrame();
      }
    };
    video.addEventListener("seeked", handleSeeked);
    video.currentTime = 0.5 / FILM_FPS;
    return () => video.removeEventListener("seeked", handleSeeked);
  }, [video, texture, invalidate, onFirstFrame]);

  useEffect(() => {
    const snap = () => {
      progressRef.current = -1;
    };
    window.addEventListener(PAGE_CHANGE_EVENT, snap);
    return () => window.removeEventListener(PAGE_CHANGE_EVENT, snap);
  }, []);

  useEffect(() => (followHome ? followHomeScroll(invalidate) : undefined), [followHome, invalidate]);

  useFrame(({ clock }, delta) => {
    beat.current = performance.now();
    const step = Math.min(delta, 0.1);
    const goal = journeyInput.progress;
    const lastFrame = Math.max(0, Math.floor(video.duration * FILM_FPS) - 1);
    progressRef.current =
      progressRef.current < 0 || reducedMotion
        ? goal
        : progressRef.current + chaseStep(goal - progressRef.current, step, lastFrame);

    const frame = Math.min(lastFrame, Math.round(progressRef.current * lastFrame));
    const wanted = (frame + 0.5) / FILM_FPS;
    // 앞선 넘김이 끝나기 전에 또 넘기면 영영 그려지지 않는다. 끝난 뒤 그때의 자리로 넘긴다.
    if (!video.seeking && Math.abs(video.currentTime - wanted) > 0.4 / FILM_FPS) video.currentTime = wanted;

    const uniforms = material.uniforms;
    if (!reducedMotion) uniforms.uTime.value += step;
    storyAt(progressRef.current, story);
    uniforms.uDistort.value = reducedMotion ? 0 : story.distort;

    const now = clock.getElapsedTime();
    if (journeyInput.section !== lastSectionRef.current) {
      if (lastSectionRef.current !== -1 && !reducedMotion) pulseStartRef.current = now;
      lastSectionRef.current = journeyInput.section;
    }
    const age = (now - pulseStartRef.current) / PULSE_DURATION;
    uniforms.uPulse.value =
      age < 0 || age > 1
        ? 0
        : THREE.MathUtils.smoothstep(age, 0, 0.08) * (1 - age) ** 2 + 0.35 * Math.exp(-(((age - 0.5) / 0.06) ** 2));
  });

  return (
    <mesh frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

interface RiverFilmProps {
  visible?: boolean;
  reducedMotion?: boolean;
  /** true 면 홈 스크롤을 직접 읽는다. */
  followHome?: boolean;
  /** 화면을 맡을 수 있는지 — false 면 바깥(SiteBackdrop)이 구역 바탕을 원래대로 돌린다. */
  onReadyChange?: (ready: boolean) => void;
}

/** 그려야 하는데 이만큼(ms) 프레임이 없으면 멈춘 것으로 본다. */
const STALL_LIMIT = 2500;

export default function RiverFilm({ visible = true, reducedMotion = false, followHome = true, onReadyChange }: RiverFilmProps) {
  const beat = useRef(0);
  const notifyRef = useRef(onReadyChange);
  const readyRef = useRef(false);
  useEffect(() => {
    notifyRef.current = onReadyChange;
  }, [onReadyChange]);
  const report = useMemo(
    () => (ready: boolean) => {
      if (readyRef.current === ready) return;
      readyRef.current = ready;
      notifyRef.current?.(ready);
    },
    [],
  );
  const handleFail = useMemo(() => () => report(false), [report]);
  const handleFirstFrame = useMemo(() => () => report(true), [report]);
  const video = useFilmVideo(handleFail);

  useEffect(() => () => report(false), [report]);

  useEffect(() => {
    if (!visible || reducedMotion || !video) return undefined;
    const since = performance.now();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const last = Math.max(beat.current, since);
      if (performance.now() - last > STALL_LIMIT) report(false);
      else if (beat.current > since) report(true);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [visible, reducedMotion, video, report]);

  if (!video) return null;
  const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio;

  return (
    <Canvas
      dpr={Math.min(1.5, Math.max(1, devicePixelRatio))}
      frameloop={!visible ? "never" : reducedMotion ? "demand" : "always"}
      gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", handleFail);
      }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <FilmPlane
        video={video}
        reducedMotion={reducedMotion}
        followHome={followHome && visible}
        onFirstFrame={handleFirstFrame}
        beat={beat}
      />
    </Canvas>
  );
}
