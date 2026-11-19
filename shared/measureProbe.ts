/**
 * 실기기 측정기(미르 11/12) — 주소에 `?measure` 를 붙여 열면 게임을 그대로 플레이하는 동안 로딩 시간 · 그래픽 메모리 추정 ·
 * JS 메모리 · 프레임 · 그래픽 연결 끊김을 재서 화면 왼쪽 아래 단추로 보여 준다. 결과 글을 복사해 보내면 된다.
 * 안내 · 여는 단추는 /check.html.
 *
 * - 한 번 켜면 이 탭을 닫을 때까지 켜져 있다(sessionStorage — 주소에서 `?measure` 가 빠져도). 로비 ↔ 나주를 오가도 이어지고 방문마다 한 줄씩 쌓인다 — 재입장 때 얼마나 느는지 본다.
 *   `?measure=off` 로 끈다.
 * - 2초마다 기록을 저장한다 — 메모리 부족으로 탭이 죽어도 다음에 열면 「끝까지 못 감」으로 남아 있다.
 * - 그래픽 메모리는 페이지가 직접 읽을 수 없다. WebGL 에 올리는 그림 · 버퍼의 크기를 가로채 더한 「올린 양」이다
 *   (실제 그래픽 프로세스 사용량은 이보다 크다 — 크롬 작업 관리자 값과 함께 본다).
 * - 아무 데도 보내지 않는다. 게임 코드(저장 · 베타 기록)는 건드리지 않는다. React 를 쓰지 않는다(게임 모듈보다 먼저 돈다).
 */

const FLAG_KEY = "kgeseo.measure";
const RUNS_KEY = "kgeseo.measure.runs";
const MAX_RUNS = 12;
const SAVE_MS = 2000;

type Page = "main" | "naju";

interface Run {
  /** 방문마다 하나 — 저장할 때 자기 줄만 바꿔 쓴다 */
  id: string;
  page: Page;
  path: string;
  /** navigate · reload · back_forward — 뒤로 가기로 되살아나면 bfcache */
  nav: string;
  startedAt: string;
  /** 첫 그리기까지(초) · 프레임이 안정될 때까지(초) */
  firstDrawS: number | null;
  stableS: number | null;
  seconds: number;
  canvas: string;
  /** 올린 양(MB) — 그림(압축 안 됨) · 그림(압축) · 버퍼 · 렌더 버퍼, 그리고 가장 많았을 때의 합 */
  texMb: number;
  compressedTexMb: number;
  bufferMb: number;
  renderbufferMb: number;
  peakGpuMb: number;
  textures: number;
  bigTextures: number;
  /** JS 메모리(MB, 크롬 계열만) */
  heapMb: number | null;
  peakHeapMb: number | null;
  fps: number | null;
  lowFps: number | null;
  /** 0.1초 · 1초 넘게 멈춘 횟수 */
  stalls: number;
  longStalls: number;
  /** 화면이 보이는데 게임이 그리지 않은 시간(초) — 멈춤 메뉴 · 그래픽 끊김 · 굳음 */
  idleS: number;
  contextLost: number;
  /** 페이지를 정상으로 떠났나 — false 로 남아 있으면 탭이 죽었거나 강제로 닫혔다 */
  closed: boolean;
}

const MB = 1048576;
const round1 = (value: number) => Math.round(value * 10) / 10;

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** 주소 · 탭 표시를 보고 켤지 정한다. 켜졌으면 true */
function isEnabled(): boolean {
  const store = storage();
  if (!store) return false;
  const param = new URLSearchParams(window.location.search).get("measure");
  // 저장 공간이 꽉 찼거나 막혀 있어도 게임 부팅을 막지 않는다(Codex 리뷰 7)
  try {
    if (param === "off") {
      store.removeItem(FLAG_KEY);
      store.removeItem(RUNS_KEY);
      return false;
    }
    if (param !== null) store.setItem(FLAG_KEY, "1");
    return store.getItem(FLAG_KEY) === "1";
  } catch {
    return param !== null && param !== "off";
  }
}

function loadRuns(): Run[] {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(RUNS_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as Run[]) : [];
  } catch {
    return [];
  }
}

// ── WebGL 가로채기 ────────────────────────────────────────────────────────────

/** 픽셀당 바이트 — 모르는 형식은 4(RGBA8)로 친다 */
function bytesPerPixel(format: number): number {
  switch (format) {
    case 0x8229: // R8
    case 0x1903: // RED
    case 0x1909: // LUMINANCE
    case 0x1906: // ALPHA
      return 1;
    case 0x822b: // RG8
    case 0x81a5: // DEPTH_COMPONENT16
    case 0x822d: // R16F
      return 2;
    case 0x881a: // RGBA16F
      return 8;
    case 0x8814: // RGBA32F
      return 16;
    case 0x822e: // R32F
    case 0x822f: // RG16F
      return 4;
    case 0x8cad: // DEPTH32F_STENCIL8
      return 8;
    default:
      return 4;
  }
}

/** 압축 형식의 픽셀당 바이트(없으면 null — 압축이 아니다) */
function compressedBytesPerPixel(format: number): number | null {
  // S3TC DXT1(0.5) · DXT3/5(1), sRGB 판
  if (format === 0x83f0 || format === 0x83f1 || format === 0x8c4c || format === 0x8c4d) return 0.5;
  if (format === 0x83f2 || format === 0x83f3 || format === 0x8c4e || format === 0x8c4f) return 1;
  // RGTC · BPTC(BC7)
  if (format >= 0x8dbb && format <= 0x8dbe) return format <= 0x8dbc ? 0.5 : 1;
  if (format >= 0x8e8c && format <= 0x8e8f) return 1;
  // ETC2 / EAC
  if (format >= 0x9270 && format <= 0x9279) return format === 0x9278 || format === 0x9279 ? 1 : 0.5;
  // ETC1 · PVRTC
  if (format === 0x8d64) return 0.5;
  if (format >= 0x8c00 && format <= 0x8c03) return 0.5;
  // ASTC — 4x4 가 1, 큰 블록은 더 작다. 넉넉히 1 로 친다
  if ((format >= 0x93b0 && format <= 0x93bd) || (format >= 0x93d0 && format <= 0x93dd)) return 1;
  return null;
}

interface Tally {
  tex: number;
  compressedTex: number;
  buffer: number;
  renderbuffer: number;
  peak: number;
  textures: number;
  bigTextures: number;
  firstDrawAt: number | null;
  contextLost: number;
  /** 그래픽 연결이 끊길 때마다 오른다 — 끊기기 전에 적은 것은 지울 때 빼지 않는다 */
  generation: number;
  /** 지난 프레임 뒤로 게임이 그렸나 */
  hasDrawn: boolean;
}

const tally: Tally = {
  tex: 0,
  compressedTex: 0,
  buffer: 0,
  renderbuffer: 0,
  peak: 0,
  textures: 0,
  bigTextures: 0,
  firstDrawAt: null,
  contextLost: 0,
  generation: 0,
  hasDrawn: false,
};

/** 그래픽 연결이 끊겼다 — 올린 것이 모두 사라졌으니 합계를 비운다(되살아나 다시 올리면 새로 센다) */
function noteContextLost() {
  tally.contextLost += 1;
  tally.generation += 1;
  tally.tex = 0;
  tally.compressedTex = 0;
  tally.buffer = 0;
  tally.renderbuffer = 0;
  tally.textures = 0;
  tally.bigTextures = 0;
}

interface TextureNote {
  bytes: number;
  isCompressed: boolean;
  isBig: boolean;
  /** 기본 단(0)의 크기 — 밉맵을 만들면 1/3 을 더한다 */
  base: number;
  hasMips: boolean;
  generation: number;
}

interface SizeNote {
  bytes: number;
  generation: number;
}

type Gl = WebGL2RenderingContext;

function hookWebGl() {
  const proto = (window as { WebGL2RenderingContext?: { prototype: Gl } }).WebGL2RenderingContext?.prototype;
  if (!proto) return;

  const textures = new WeakMap<WebGLTexture, TextureNote>();
  const buffers = new WeakMap<WebGLBuffer, SizeNote>();
  const renderbuffers = new WeakMap<WebGLRenderbuffer, SizeNote>();
  /** 끊기기 전에 적은 기록은 없는 것으로 본다 */
  const live = <T extends { generation: number }>(note: T | undefined) => (note && note.generation === tally.generation ? note : undefined);
  /** 컨텍스트마다 지금 묶인 것 — 그림은 (단위, 대상)별 */
  const bound = new WeakMap<
    object,
    { unit: number; tex: Map<string, WebGLTexture | null>; buf: Map<number, WebGLBuffer | null>; rb: WebGLRenderbuffer | null }
  >();
  const stateOf = (gl: object) => {
    let state = bound.get(gl);
    if (!state) {
      state = { unit: 0, tex: new Map(), buf: new Map(), rb: null };
      bound.set(gl, state);
    }
    return state;
  };
  const touchPeak = () => {
    const total = tally.tex + tally.compressedTex + tally.buffer + tally.renderbuffer;
    if (total > tally.peak) tally.peak = total;
  };
  /** 큐브맵 면(0x8515 ~ 0x851A)은 큐브 그림(0x8513) 하나로 본다 */
  const texTarget = (target: number) => (target >= 0x8515 && target <= 0x851a ? 0x8513 : target);
  const currentTexture = (gl: object, target: number) => {
    const state = stateOf(gl);
    return state.tex.get(`${state.unit}:${texTarget(target)}`) ?? null;
  };
  const setTextureBytes = (
    texture: WebGLTexture | null,
    bytes: number,
    isCompressed: boolean,
    base: number,
    isBig: boolean,
    hasMips: boolean,
  ) => {
    if (!texture) return;
    const prev = live(textures.get(texture));
    if (prev) {
      if (prev.isCompressed) tally.compressedTex -= prev.bytes;
      else tally.tex -= prev.bytes;
      if (prev.isBig && !isBig) tally.bigTextures -= 1;
    } else tally.textures += 1;
    if (isBig && !prev?.isBig) tally.bigTextures += 1;
    textures.set(texture, { bytes, isCompressed, isBig, base, hasMips, generation: tally.generation });
    if (isCompressed) tally.compressedTex += bytes;
    else tally.tex += bytes;
    touchPeak();
  };

  /** 원래 함수를 부르기 전에 after 로 크기만 적는다 — 측정이 실패해도 게임 호출은 그대로 간다 */
  const wrap = <K extends keyof Gl>(name: K, after: (gl: Gl, args: unknown[]) => void) => {
    const original = proto[name] as unknown as (...args: unknown[]) => unknown;
    if (typeof original !== "function") return;
    (proto as unknown as Record<string, unknown>)[name as string] = function (this: Gl, ...args: unknown[]) {
      try {
        after(this, args);
      } catch {
        // 측정은 게임을 막지 않는다
      }
      return original.apply(this, args);
    };
  };

  wrap("activeTexture", (gl, [unit]) => {
    stateOf(gl).unit = (unit as number) - 0x84c0;
  });
  wrap("bindTexture", (gl, [target, texture]) => {
    const state = stateOf(gl);
    state.tex.set(`${state.unit}:${texTarget(target as number)}`, (texture as WebGLTexture | null) ?? null);
  });
  wrap("texStorage2D", (gl, [target, levels, format, width, height]) => {
    const w = width as number;
    const h = height as number;
    const faces = target === 0x8513 ? 6 : 1;
    const compressed = compressedBytesPerPixel(format as number);
    const perPixel = compressed ?? bytesPerPixel(format as number);
    const mips = (levels as number) > 1 ? 4 / 3 : 1;
    const bytes = w * h * perPixel * mips * faces;
    setTextureBytes(currentTexture(gl, target as number), bytes, compressed !== null, bytes, w * h >= 2048 * 2048, true);
  });
  wrap("texStorage3D", (gl, [target, levels, format, width, height, depth]) => {
    const compressed = compressedBytesPerPixel(format as number);
    const perPixel = compressed ?? bytesPerPixel(format as number);
    const bytes = (width as number) * (height as number) * (depth as number) * perPixel * ((levels as number) > 1 ? 4 / 3 : 1);
    setTextureBytes(currentTexture(gl, target as number), bytes, compressed !== null, bytes, false, true);
  });
  wrap("texImage2D", (gl, args) => {
    const [target, level, format] = args as number[];
    if (level !== 0) return;
    let w = 0;
    let h = 0;
    if (args.length >= 9) {
      w = args[3] as number;
      h = args[4] as number;
    } else {
      const source = args[5] as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | null;
      w = source?.videoWidth ?? source?.width ?? 0;
      h = source?.videoHeight ?? source?.height ?? 0;
    }
    // 큐브맵은 면마다 불린다 — 한 면 크기 × 6 으로 한 번만 적는다
    const faces = texTarget(target) === 0x8513 ? 6 : 1;
    const bytes = w * h * bytesPerPixel(format) * faces;
    // 기본 단을 다시 올렸다 — 밉맵은 generateMipmap 이 다시 불릴 때 더한다
    setTextureBytes(currentTexture(gl, target), bytes, false, bytes, w * h >= 2048 * 2048, false);
  });
  wrap("compressedTexImage2D", (gl, [target, level, format, width, height]) => {
    if (level !== 0) return;
    const perPixel = compressedBytesPerPixel(format as number) ?? 1;
    // 압축 그림은 밉맵을 파일에 담아 온다 — 1/3 을 미리 더한다. 큐브맵은 면마다 불리니 한 면 × 6 으로 한 번만 적는다
    const faces = texTarget(target as number) === 0x8513 ? 6 : 1;
    const bytes = (width as number) * (height as number) * perPixel * (4 / 3) * faces;
    setTextureBytes(currentTexture(gl, target as number), bytes, true, bytes, false, true);
  });
  wrap("generateMipmap", (gl, [target]) => {
    const texture = currentTexture(gl, target as number);
    const note = texture ? live(textures.get(texture)) : undefined;
    if (!texture || !note || note.hasMips) return;
    setTextureBytes(texture, note.base * (4 / 3), note.isCompressed, note.base, note.isBig, true);
  });
  wrap("deleteTexture", (_gl, [texture]) => {
    const note = texture ? live(textures.get(texture as WebGLTexture)) : undefined;
    if (!note) return;
    if (note.isCompressed) tally.compressedTex -= note.bytes;
    else tally.tex -= note.bytes;
    if (note.isBig) tally.bigTextures -= 1;
    tally.textures -= 1;
    textures.delete(texture as WebGLTexture);
  });

  wrap("bindBuffer", (gl, [target, buffer]) => {
    stateOf(gl).buf.set(target as number, (buffer as WebGLBuffer | null) ?? null);
  });
  wrap("bufferData", (gl, [target, data, , srcOffset, length]) => {
    const buffer = stateOf(gl).buf.get(target as number);
    if (!buffer) return;
    let bytes = 0;
    if (typeof data === "number") bytes = data;
    else if (data) {
      const view = data as ArrayBufferView & { BYTES_PER_ELEMENT?: number; length?: number };
      bytes = (data as ArrayBuffer).byteLength;
      // WebGL2 — 배열의 일부만 올리는 꼴(srcOffset · length, 요소 수 단위)
      if (typeof srcOffset === "number" && typeof view.length === "number") {
        const each = view.BYTES_PER_ELEMENT ?? 1;
        const count = typeof length === "number" && length > 0 ? length : view.length - srcOffset;
        bytes = Math.max(0, count) * each;
      }
    }
    tally.buffer += bytes - (live(buffers.get(buffer))?.bytes ?? 0);
    buffers.set(buffer, { bytes, generation: tally.generation });
    touchPeak();
  });
  wrap("deleteBuffer", (_gl, [buffer]) => {
    if (!buffer) return;
    tally.buffer -= live(buffers.get(buffer as WebGLBuffer))?.bytes ?? 0;
    buffers.delete(buffer as WebGLBuffer);
  });

  wrap("bindRenderbuffer", (gl, [, renderbuffer]) => {
    stateOf(gl).rb = (renderbuffer as WebGLRenderbuffer | null) ?? null;
  });
  const noteRenderbuffer = (gl: Gl, samples: number, format: number, width: number, height: number) => {
    const renderbuffer = stateOf(gl).rb;
    if (!renderbuffer) return;
    const bytes = width * height * bytesPerPixel(format) * Math.max(1, samples);
    tally.renderbuffer += bytes - (live(renderbuffers.get(renderbuffer))?.bytes ?? 0);
    renderbuffers.set(renderbuffer, { bytes, generation: tally.generation });
    touchPeak();
  };
  wrap("renderbufferStorage", (gl, [, format, width, height]) =>
    noteRenderbuffer(gl, 1, format as number, width as number, height as number),
  );
  wrap("renderbufferStorageMultisample", (gl, [, samples, format, width, height]) =>
    noteRenderbuffer(gl, samples as number, format as number, width as number, height as number),
  );
  wrap("deleteRenderbuffer", (_gl, [renderbuffer]) => {
    if (!renderbuffer) return;
    tally.renderbuffer -= live(renderbuffers.get(renderbuffer as WebGLRenderbuffer))?.bytes ?? 0;
    renderbuffers.delete(renderbuffer as WebGLRenderbuffer);
  });

  const noteDraw = () => {
    tally.hasDrawn = true;
    if (tally.firstDrawAt === null) tally.firstDrawAt = performance.now();
  };
  wrap("drawElements", noteDraw);
  wrap("drawArrays", noteDraw);
  wrap("drawElementsInstanced", noteDraw);
  wrap("drawArraysInstanced", noteDraw);
}

// ── 프레임 ────────────────────────────────────────────────────────────────────

const frames = {
  count: 0,
  /** 게임이 그린 프레임 사이의 시간 합(ms) */
  time: 0,
  /** 화면이 보이는데 게임이 그리지 않은 시간(ms) */
  idle: 0,
  stalls: 0,
  longStalls: 0,
  /** 최근 프레임 간격(ms) — 느린 쪽 1% 를 본다 */
  recent: [] as number[],
  calm: 0,
  stableAt: null as number | null,
};

/**
 * 게임이 실제로 그린 프레임만 센다 — 측정기의 rAF 만 도는 동안(멈춤 메뉴 · 그래픽 끊김 · frameloop 정지)은
 * FPS 에 넣지 않고 「그리지 않은 시간」으로 따로 쌓는다(Codex 리뷰 7).
 */
function watchFrames() {
  let last = performance.now();
  /** 마지막으로 게임이 그린 프레임의 시각 */
  let lastDrawn: number | null = null;
  // 탭이 가려졌다 돌아온 간격은 버린다 — 보이는 채로 길게 멈춘 것은 그대로 센다
  document.addEventListener("visibilitychange", () => {
    last = performance.now();
    lastDrawn = null;
  });
  const tick = (now: number) => {
    const gap = now - last;
    last = now;
    if (document.visibilityState === "visible" && tally.firstDrawAt !== null) {
      if (tally.hasDrawn) {
        if (lastDrawn !== null) {
          const drawnGap = now - lastDrawn;
          frames.count += 1;
          frames.time += drawnGap;
          if (drawnGap > 100) frames.stalls += 1;
          if (drawnGap > 1000) frames.longStalls += 1;
          frames.recent.push(drawnGap);
          if (frames.recent.length > 3000) frames.recent.shift();
          // 0.05초 안쪽 프레임이 60장 이어지면 「안정」
          frames.calm = drawnGap < 50 ? frames.calm + 1 : 0;
          if (frames.stableAt === null && frames.calm >= 60) frames.stableAt = now;
        }
        lastDrawn = now;
      } else {
        frames.idle += gap;
        // 1초 넘게 안 그리면 이어지는 간격으로 치지 않는다(멈춤 메뉴를 긴 멈춤으로 세지 않게)
        if (lastDrawn !== null && now - lastDrawn > 1000) lastDrawn = null;
      }
    }
    tally.hasDrawn = false;
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
}

// ── 기록 · 화면 ───────────────────────────────────────────────────────────────

function heapMb(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / MB) : null;
}

function gpuName(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return "WebGL 없음";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return "읽지 못함";
  }
}

/** 설정 창에서 고른 그래픽 품질(src/engine/quality.ts 와 같은 열쇠) — 고른 적 없으면 자동 */
function savedQuality(): string {
  try {
    return window.localStorage.getItem("kgeseo.quality.v1") ?? "자동";
  } catch {
    return "모름";
  }
}

function deviceLines(): string[] {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return [
    `그래픽 장치: ${gpuName()}`,
    `기기 메모리(브라우저가 알려 준 값, 최대 8): ${nav.deviceMemory ?? "모름"}GB · 코어 ${nav.hardwareConcurrency ?? "모름"}`,
    `화면: ${window.screen.width}×${window.screen.height} · 창 ${window.innerWidth}×${window.innerHeight} · 배율 ${window.devicePixelRatio}`,
    `브라우저: ${navigator.userAgent}`,
    `그래픽 품질(설정 저장값 · 주소): ${savedQuality()} · ${new URLSearchParams(window.location.search).get("q") ?? "-"}`,
  ];
}

function runLine(run: Run, index: number, runs: Run[]): string {
  const total = run.texMb + run.compressedTexMb + run.bufferMb + run.renderbufferMb;
  // 마지막 줄은 지금 보고 있는 방문이다 — 그 앞의 닫히지 않은 줄만 「못 감」
  const state = run.closed ? "정상 종료" : index === runs.length - 1 ? "진행 중" : "끝까지 못 감(탭이 죽었거나 강제로 닫힘)";
  return [
    `[${index + 1}] ${run.page === "naju" ? "나주" : "본편"} ${run.path} · ${run.nav} · ${run.startedAt} · ${run.seconds}초 · ${state}`,
    `    로딩: 첫 그리기 ${run.firstDrawS ?? "-"}초 · 안정 ${run.stableS ?? "-"}초 · 캔버스 ${run.canvas}`,
    `    그래픽에 올린 양: ${Math.round(total)}MB(최고 ${Math.round(run.peakGpuMb)}MB) = 그림 ${Math.round(run.texMb)} + 압축 그림 ${Math.round(run.compressedTexMb)} + 버퍼 ${Math.round(run.bufferMb)} + 렌더 버퍼 ${Math.round(run.renderbufferMb)} · 그림 ${run.textures}장(2048 이상 ${run.bigTextures}장)`,
    `    JS 메모리(배열 포함): ${run.heapMb ?? "모름"}MB(최고 ${run.peakHeapMb ?? "모름"}MB)`,
    `    프레임: 평균 ${run.fps ?? "-"} · 느린 1% ${run.lowFps ?? "-"} · 0.1초 넘게 멈춤 ${run.stalls}번 · 1초 넘게 ${run.longStalls}번 · 그리지 않은 시간 ${run.idleS}초 · 그래픽 연결 끊김 ${run.contextLost}번`,
  ].join("\n");
}

function reportText(runs: Run[]): string {
  return ["「왜곡」 실기기 측정 결과", ...deviceLines(), "", ...runs.map(runLine)].join("\n");
}

function mountPanel(read: () => Run[]) {
  const host = document.createElement("div");
  host.setAttribute("data-measure-probe", "");
  host.style.cssText =
    "position:fixed;left:10px;bottom:10px;z-index:2147483600;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#f2eee4;";
  const pill = document.createElement("button");
  pill.type = "button";
  pill.style.cssText =
    "all:unset;cursor:pointer;padding:5px 10px;border-radius:999px;background:rgba(12,15,22,.88);border:1px solid rgba(242,238,228,.3);";
  const panel = document.createElement("div");
  panel.hidden = true;
  panel.style.cssText =
    "margin-bottom:8px;width:min(720px,calc(100vw - 20px));max-height:60vh;overflow:auto;padding:12px 14px;border-radius:10px;background:rgba(12,15,22,.96);border:1px solid rgba(242,238,228,.3);";
  const text = document.createElement("pre");
  text.style.cssText = "margin:0 0 10px;white-space:pre-wrap;word-break:break-all;user-select:text;";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "결과 복사";
  copy.style.cssText =
    "all:unset;cursor:pointer;padding:6px 14px;border-radius:6px;background:#f2eee4;color:#0c0f16;font-weight:700;";
  const note = document.createElement("span");
  note.style.cssText = "margin-left:10px;opacity:.75;";
  note.textContent = "이 글을 그대로 보내 주세요. 끄려면 주소 끝에 ?measure=off";
  panel.append(text, copy, note);
  host.append(panel, pill);

  const refresh = () => {
    const runs = read();
    const now = runs[runs.length - 1];
    const total = now ? now.texMb + now.compressedTexMb + now.bufferMb + now.renderbufferMb : 0;
    pill.textContent = `측정 중 · ${runs.length}번째 · ${now?.seconds ?? 0}초 · 그래픽 ${Math.round(total)}MB · 결과 보기`;
    if (!panel.hidden) text.textContent = reportText(runs);
  };
  pill.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    refresh();
  });
  copy.addEventListener("click", () => {
    const body = reportText(read());
    const done = (label: string) => {
      copy.textContent = label;
      window.setTimeout(() => (copy.textContent = "결과 복사"), 1600);
    };
    if (navigator.clipboard?.writeText)
      navigator.clipboard.writeText(body).then(
        () => done("복사됨"),
        () => done("복사 실패 — 글을 끌어서 복사해 주세요"),
      );
    else done("복사 실패 — 글을 끌어서 복사해 주세요");
  });
  // 마우스가 게임에 잠겨 있어도 열 수 있게 — F9
  window.addEventListener("keydown", (event) => {
    if (event.code !== "F9") return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) document.exitPointerLock?.();
    refresh();
  });
  const attach = () => document.body.append(host);
  if (document.body) attach();
  else window.addEventListener("DOMContentLoaded", attach, { once: true });
  return refresh;
}

/** 엔트리(본편 · 나주)가 게임 모듈을 부르기 전에 한 번 부른다. `?measure` 가 없으면 아무것도 하지 않는다 */
export function startMeasureProbe(page: Page) {
  if (typeof window === "undefined" || !isEnabled()) return;
  hookWebGl();
  watchFrames();

  const startedAt = performance.now();
  const navEntry = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  const run: Run = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    page,
    path: window.location.pathname,
    nav: navEntry?.type ?? "모름",
    startedAt: new Date().toLocaleTimeString("ko-KR", { hour12: false }),
    firstDrawS: null,
    stableS: null,
    seconds: 0,
    canvas: "-",
    texMb: 0,
    compressedTexMb: 0,
    bufferMb: 0,
    renderbufferMb: 0,
    peakGpuMb: 0,
    textures: 0,
    bigTextures: 0,
    heapMb: null,
    peakHeapMb: null,
    fps: null,
    lowFps: null,
    stalls: 0,
    longStalls: 0,
    idleS: 0,
    contextLost: 0,
    closed: false,
  };
  /** 저장된 방문들 + 이번 방문 — 매번 다시 읽는다(뒤로 가기로 되살아난 사이 다른 페이지가 쌓은 줄을 지우지 않게, Codex 리뷰 7) */
  const allRuns = () => [...loadRuns().filter((saved) => saved.id !== run.id), run].slice(-MAX_RUNS);

  const update = () => {
    run.seconds = Math.round((performance.now() - startedAt) / 1000);
    run.firstDrawS = tally.firstDrawAt === null ? null : round1(tally.firstDrawAt / 1000);
    run.stableS = frames.stableAt === null ? null : round1(frames.stableAt / 1000);
    const canvas = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (canvas) run.canvas = `${canvas.width}×${canvas.height}`;
    run.texMb = round1(tally.tex / MB);
    run.compressedTexMb = round1(tally.compressedTex / MB);
    run.bufferMb = round1(tally.buffer / MB);
    run.renderbufferMb = round1(tally.renderbuffer / MB);
    run.peakGpuMb = round1(tally.peak / MB);
    run.textures = tally.textures;
    run.bigTextures = tally.bigTextures;
    run.heapMb = heapMb();
    if (run.heapMb !== null) run.peakHeapMb = Math.max(run.peakHeapMb ?? 0, run.heapMb);
    if (frames.time > 0) {
      run.fps = round1((frames.count / frames.time) * 1000);
      const slow = [...frames.recent].sort((a, b) => b - a);
      const worst = slow[Math.floor(slow.length * 0.01)] ?? slow[0];
      run.lowFps = worst ? round1(1000 / worst) : null;
    }
    run.stalls = frames.stalls;
    run.longStalls = frames.longStalls;
    run.idleS = Math.round(frames.idle / 1000);
    run.contextLost = tally.contextLost;
  };
  const save = () => {
    update();
    try {
      storage()?.setItem(RUNS_KEY, JSON.stringify(allRuns()));
    } catch {
      // 저장 공간이 없으면 화면에만 보인다
    }
  };

  // webglcontextlost 는 거품이 오르지 않는다 — 잡는 단계로 받는다
  document.addEventListener("webglcontextlost", noteContextLost, true);
  window.addEventListener("pagehide", () => {
    run.closed = true;
    save();
  });
  // 뒤로 가기로 되살아났다(bfcache) — 다시 진행 중으로
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    run.closed = false;
    run.nav = "bfcache 복귀";
  });

  const refresh = mountPanel(() => {
    update();
    return allRuns();
  });
  save();
  window.setInterval(() => {
    save();
    refresh();
  }, SAVE_MS);
}
