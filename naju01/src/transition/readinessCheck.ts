/**
 * 「정말 다 떴나」 판정. 로딩 영상은 이게 「됐다」 할 때만 걷힌다.
 *
 * 파일을 다 받은 것은 시작일 뿐이다. 걷힌 뒤에 늦게 뜨는 것은 대개 해석·셰이더 컴파일·GPU 업로드·
 * lazy 조각·글꼴이다. 그래서 네 관문을 차례로 모두 통과해야 「됐다」 고 하고, 하나라도 흔들리면 처음부터 다시 본다.
 *   1 조용함   0.8초 동안 아무것도 안 받는다(로딩 관리자·fetch/XHR·새 리소스·글꼴·캔버스)
 *   2 데우기   씬 전체(화면 밖까지)의 텍스처·셰이더·지오메트리를 GPU 에 올린다
 *   3 안정     1.5초 동안 큰 프레임 끊김도, 새 셰이더 프로그램도 없다
 *   4 최소 시간 — 막 쪽에서 센다
 * 그래도 안 끝나면 최대 시간 뒤에 걷는다. 막이 영영 안 걷히는 것이 제일 나쁘다.
 */
import * as THREE from "three";
import { _roots } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

/** 전환 영상이 있는 public 폴더. 영상 표와 감시 제외가 같은 값을 써야 한다. */
export const TRANSITION_VIDEO_DIR = "/transitions/";

/** 다 떴을 때의 상태 글이자 돌려주는 값 */
export const READY = "됨";

// 모델·그림 파일만 센다 — 서버 API 같은 건 렌더와 상관없다
const RESOURCE_EXTENSIONS =
  /\.(glb|gltf|bin|png|jpe?g|webp|avif|ktx2|basis|hdr|exr|wasm|drc|fbx|obj|mtl|woff2?|ttf|otf)(\?|#|$)/i;
const QUIET_MS = 800;
const STALE_REQUEST_MS = 30000;

const pendingRequests = new Map<number, number>(); // 번호 → 시작 시각
let requestSerial = 0;
let lastReceivedAt = 0;
let lastReceivedName = ""; // 진단용

function isResource(url: unknown): boolean {
  try {
    return RESOURCE_EXTENSIONS.test(new URL(String(url), location.href).pathname);
  } catch {
    return false;
  }
}

// 전환 영상 자신이 세지면 막이 자기 영상 때문에 안 걷힌다
function isTransitionVideo(url: unknown): boolean {
  const text = String(url);
  return text.includes(TRANSITION_VIDEO_DIR) || text.includes(encodeURI(TRANSITION_VIDEO_DIR));
}

function markReceived(id: number) {
  pendingRequests.delete(id);
  lastReceivedAt = performance.now();
}

let isWatching = false;
function startWatching() {
  if (isWatching || typeof window === "undefined") return;
  isWatching = true;

  // three 의 FileLoader(GLB·bin)가 fetch 를 쓴다
  const originalFetch = window.fetch?.bind(window);
  if (originalFetch) {
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      // URL 객체는 원래도 세지 않았다(.url 이 없다) — three 로더는 문자열·Request 로 부른다
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : undefined;
      if (!isResource(url) || isTransitionVideo(url)) return originalFetch(input, init);
      const id = ++requestSerial;
      pendingRequests.set(id, performance.now());
      const done = () => markReceived(id);
      // 머리만 오고 몸통은 아직일 수 있다 — 몸통을 다 읽을 때까지 걸린 요청으로 둔다
      return originalFetch(input, init).then(
        (response) => {
          response.clone().arrayBuffer().then(done, done);
          return response;
        },
        (error: unknown) => {
          done();
          throw error;
        },
      );
    };
  }

  // 오래된 로더는 XHR 을 쓴다
  const trackedXhrs = new WeakSet<XMLHttpRequest>();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: [boolean?, (string | null)?, (string | null)?]
  ) {
    if (isResource(url) && !isTransitionVideo(url)) trackedXhrs.add(this);
    else trackedXhrs.delete(this);
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    if (trackedXhrs.has(this)) {
      const id = ++requestSerial;
      pendingRequests.set(id, performance.now());
      this.addEventListener("loadend", () => markReceived(id), { once: true });
    }
    return originalSend.call(this, body);
  };

  // 받아진 파일 전부(스크립트 조각·그림·CSS) — lazy 로 늦게 붙는 화면 조각을 잡는다
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        if (entry.initiatorType === "video" || isTransitionVideo(entry.name)) continue;
        lastReceivedAt = performance.now();
        lastReceivedName = `${entry.initiatorType} ${entry.name.slice(-60)}`;
      }
    }).observe({ type: "resource", buffered: false });
  } catch {
    // 옛 브라우저 — 위 둘로 버틴다
  }
}
// 이 파일을 읽는 순간(= main 이 뜨는 순간) 깔아야 첫 요청부터 센다
startWatching();

interface CanvasState {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
}

function liveCanvases(): CanvasState[] {
  const result: CanvasState[] = [];
  try {
    _roots.forEach((root, canvas) => {
      if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) return;
      const state = root?.store?.getState?.();
      if (state?.gl && state?.scene && state?.camera)
        result.push({ gl: state.gl, scene: state.scene, camera: state.camera });
    });
  } catch {
    // R3F 내부가 바뀌었으면 캔버스 유무만 본다
  }
  return result;
}

/** 관문 1 — 조용하면 null, 아니면 무엇 때문인지(진단 글) */
function quietBlocker(isLoading: () => boolean): string | null {
  const now = performance.now();
  for (const [id, startedAt] of pendingRequests) if (now - startedAt > STALE_REQUEST_MS) pendingRequests.delete(id);
  if (!document.querySelector("canvas")) return "캔버스 없음";
  if (liveCanvases().length === 0) return "3D 준비 전";
  if (isLoading()) return "모델 · 텍스처 받는 중";
  if (pendingRequests.size) return `파일 ${pendingRequests.size}개 받는 중`;
  if (now - lastReceivedAt < QUIET_MS) return `파일 막 받음(${lastReceivedName})`;
  if (document.fonts && document.fonts.status !== "loaded") return "글꼴 받는 중";
  return null;
}

/** 관문 2 — 씬 전체를 GPU 에 올리고 컴파일한다 */
async function warmUp() {
  const target = new THREE.WebGLRenderTarget(4, 4);
  for (const { gl, scene, camera } of liveCanvases()) {
    const textures = new Set<THREE.Texture>();
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      const material = (object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }).material;
      if (!material) return;
      for (const item of Array.isArray(material) ? material : [material]) if (item) materials.add(item);
    });
    materials.forEach((material) => {
      for (const value of Object.values(material) as unknown[]) if (value instanceof THREE.Texture) textures.add(value);
      const uniforms = (material as THREE.Material & { uniforms?: Record<string, THREE.IUniform> }).uniforms;
      if (uniforms)
        for (const uniform of Object.values(uniforms)) if (uniform?.value?.isTexture) textures.add(uniform.value);
    });
    textures.forEach((texture) => {
      try {
        gl.initTexture(texture);
      } catch {
        // 비디오·캔버스 텍스처 등
      }
    });

    // 숨은 것까지 전부. 병렬 컴파일 확장이 있으면 끝날 때까지 기다린다
    try {
      if (gl.compileAsync) await gl.compileAsync(scene, camera);
      else gl.compile(scene, camera);
    } catch (error) {
      console.warn("[로딩검사] 셰이더 미리 컴파일 실패 — 계속 간다", error);
    }

    // 화면 밖 물체는 아직 GPU 에 없다 — 컬링을 끄고 보이지 않는 4×4 판에 한 번 그려 버퍼를 올린다
    const unculled: THREE.Object3D[] = [];
    scene.traverse((object) => {
      if (object.frustumCulled) {
        object.frustumCulled = false;
        unculled.push(object);
      }
    });
    const previousTarget = gl.getRenderTarget();
    const previousAutoClear = gl.autoClear;
    try {
      gl.setRenderTarget(target);
      gl.autoClear = true;
      gl.render(scene, camera);
    } catch (error) {
      console.warn("[로딩검사] 미리 그리기 실패 — 계속 간다", error);
    } finally {
      gl.setRenderTarget(previousTarget);
      gl.autoClear = previousAutoClear;
      unculled.forEach((object) => {
        object.frustumCulled = true;
      });
    }
  }
  target.dispose();
}

/** 새 물건이 처음 그려지면 늘어난다 */
function programCount(): number {
  return liveCanvases().reduce((sum, { gl }) => sum + (gl.info?.programs?.length ?? 0), 0);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

/**
 * 「다 떴다」 가 될 때까지 기다린다. READY 또는 「시간 초과: …」 를 돌려준다.
 * @param isLoading   three 로딩 관리자가 일하는 중인가(막이 useProgress 로 넘긴다)
 * @param onStatus    지금 무엇을 기다리는지(막의 작은 상태 글)
 * @param isCancelled 막이 사라졌으면 그만둔다
 */
export async function waitUntilReady(
  isLoading: () => boolean,
  onStatus: ((status: string) => void) | undefined,
  isCancelled: () => boolean,
  { maxSeconds = 60 }: { maxSeconds?: number } = {},
): Promise<string> {
  const startedAt = performance.now();
  // 숨은 탭은 그리기를 멈춘다 — 그동안 시간이 흘러 버리면 돌아왔을 때 덜 뜬 화면으로 걷힌다
  let hiddenTotal = 0;
  let hiddenSince: number | null = document.visibilityState === "hidden" ? performance.now() : null;
  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") hiddenSince ??= performance.now();
    else if (hiddenSince != null) {
      hiddenTotal += performance.now() - hiddenSince;
      hiddenSince = null;
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  const elapsedSeconds = () =>
    (performance.now() - startedAt - hiddenTotal - (hiddenSince != null ? performance.now() - hiddenSince : 0)) / 1000;
  const remainingSeconds = () => maxSeconds - elapsedSeconds();
  let lastReason = "";
  const report = (status: string) => {
    lastReason = status;
    onStatus?.(status);
    exposeDevHook("loadingCheck", { waitingFor: status, elapsedSeconds: elapsedSeconds().toFixed(1) });
  };
  const finish = () => {
    report(READY);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    return READY;
  };

  let attempt = 0;
  while (!isCancelled()) {
    if (remainingSeconds() <= 0) break;
    attempt += 1;

    // 관문 1 — 0.8초 내리 조용해야 한다
    let quietSince: number | null = null;
    while (!isCancelled() && remainingSeconds() > 0) {
      const reason = quietBlocker(isLoading);
      if (reason) {
        quietSince = null;
        report(reason);
      } else {
        quietSince ??= performance.now();
        if (performance.now() - quietSince >= QUIET_MS) break;
        report("마무리 확인 중");
      }
      await sleep(100);
    }
    if (isCancelled() || remainingSeconds() <= 0) break;

    report("그래픽 데우는 중");
    await warmUp();
    if (isCancelled()) break;

    // 관문 3 — 1.5초와 프레임 10장을 둘 다 채운다(아주 느린 기계는 6초까지 모은다)
    report("화면 안정 확인 중");
    const intervals: number[] = [];
    const initialPrograms = programCount();
    let breakReason: string | null = null;
    const windowStart = performance.now();
    let previous = performance.now();
    while (
      !isCancelled() &&
      (performance.now() - windowStart < 1500 || intervals.length < 10) &&
      performance.now() - windowStart < 6000
    ) {
      await nextFrame();
      const now = performance.now();
      intervals.push(now - previous);
      previous = now;
      const sorted = [...intervals].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const limit = Math.max(100, median * 2.5);
      const latest = intervals[intervals.length - 1];
      if (intervals.length > 3 && latest > limit) {
        breakReason = `프레임 끊김 ${Math.round(latest)}ms`;
        break;
      }
      if (programCount() !== initialPrograms) {
        breakReason = "새 셰이더가 생김(처음 그려지는 물건)";
        break;
      }
      const reason = quietBlocker(isLoading);
      if (reason) {
        breakReason = reason;
        break;
      }
    }
    if (isCancelled()) break;
    if (!breakReason && intervals.length >= 10) return finish();
    // 다섯 번째부터는 끊김·새 셰이더는 봐준다(느린 기계·재질을 계속 만드는 물건). 관문 1 과 데우기는 끝까지 지킨다.
    if (attempt >= 5 && !quietBlocker(isLoading)) {
      console.warn(
        `[로딩검사] 안정 확인을 ${attempt}번 넘기지 못했다(${breakReason || "프레임이 너무 적음"}) — 다 받고 데운 상태라 걷는다`,
      );
      return finish();
    }
    report(breakReason || "프레임이 너무 적음");
    console.info(`[로딩검사] 안정 확인 ${attempt}번째 실패 — ${breakReason || "프레임이 너무 적음"}`);
  }
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  if (!isCancelled()) {
    console.warn(`[로딩검사] ${maxSeconds}초 안에 다 뜨지 않아 막을 걷는다 — 마지막으로 기다리던 것: ${lastReason}`);
  }
  return `시간 초과: ${lastReason}`;
}
