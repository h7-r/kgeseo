/**
 * 그래픽 품질 고르기의 저장 · 자동 판정(미르 11/12) — 엔트리의 첫 고르기 팝업(qualityChooser)과 게임(src/engine/quality)이 같이 쓴다.
 * 게임 모듈을 부르지 않는다 — 엔트리가 3D 를 받기 전에 읽는다. React 를 쓰지 않는다(node --test).
 */
export type QualityMode = "standard" | "low";
export type QualityChoice = QualityMode | "auto";
export const QUALITY_KEY = "kgeseo.quality.v1";

/** 설정 창에서 고른 값. 고른 적 없으면 「자동」 */
export function readQualityChoice(): QualityChoice {
  try {
    const saved = localStorage.getItem(QUALITY_KEY);
    return saved === "low" || saved === "standard" ? saved : "auto";
  } catch {
    return "auto";
  }
}

/** 한 번이라도 골랐나(자동 포함) — 처음 온 사람에게만 고르기 팝업을 띄운다 */
export function hasQualityChoice(): boolean {
  try {
    return localStorage.getItem(QUALITY_KEY) !== null;
  } catch {
    return false;
  }
}

/** 고른 값을 저장한다 — 다음에 열 때부터 적용된다. 못 적었으면 false */
export function saveQualityChoice(choice: QualityChoice): boolean {
  try {
    // 「자동」도 적어 둔다 — 지우면 처음 온 사람으로 보여 고르기 팝업이 다시 뜬다(Codex 리뷰 10)
    localStorage.setItem(QUALITY_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

/**
 * 내장 그래픽 · 소프트웨어 렌더러의 이름 — 그래픽 메모리를 시스템 메모리에서 나눠 쓰는 기기들.
 * 인텔 Arc · 애플 실리콘 · 외장(GeForce · Radeon RX)은 걸리지 않는다. 모델 번호 없는 「Radeon(TM) Graphics」 · Vega 는 내장이다.
 */
const WEAK_GPU =
  /Intel.{0,24}(HD Graphics|UHD Graphics|Iris)|Radeon\(TM\) Graphics|Radeon(?! RX).{0,12}Vega|SwiftShader|llvmpipe|Basic Render|Mali|Adreno|PowerVR/i;

export const isWeakGpuName = (name: string) => WEAK_GPU.test(name);

export function readGpuName(): string {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return "";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return "";
  }
}

/** 기기를 보고 고른다 — 내장 그래픽이거나 메모리 4GB 이하면 저사양(브라우저가 알려 주는 메모리 값은 8 이 상한이다) */
export function detectQuality(gpuName: string, deviceMemory: number | undefined): QualityMode {
  if (isWeakGpuName(gpuName)) return "low";
  if (deviceMemory !== undefined && deviceMemory <= 4) return "low";
  return "standard";
}


type QualitySource = "주소" | "설정" | "자동";

/** 이 페이지에 적용할 품질 — 주소(?q=) → 설정에서 고른 값 → 기기 자동 */
export function resolveQuality(): { mode: QualityMode; source: QualitySource; gpu: string } {
  try {
    const q = new URLSearchParams(location.search).get("q");
    if (q === "low") return { mode: "low", source: "주소", gpu: "" };
    if (q === "standard" || q === "pc" || q === "high") return { mode: "standard", source: "주소", gpu: "" };
    const choice = readQualityChoice();
    if (choice !== "auto") return { mode: choice, source: "설정", gpu: "" };
    const gpu = readGpuName();
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return { mode: detectQuality(gpu, memory), source: "자동", gpu };
  } catch {
    // 브라우저가 아닌 환경(빌드 중 등)에서는 기본 모드
    return { mode: "standard", source: "자동", gpu: "" };
  }
}
