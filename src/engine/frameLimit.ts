/**
 * 프레임 제한의 셈 — 화면 주사율과 상한으로 「몇 번째 화면 갱신마다 그릴지」를 정한다. React · 별칭을 쓰지 않는다(node --test).
 *
 * 시간으로만 끊으면(「16.7ms 지났으면 그린다」) 144Hz 화면에서 두 번 · 세 번 갱신을 번갈아 건너뛰어 걸음이 고르지 않다.
 * 그래서 갱신 N 번에 한 번씩 고르게 그린다. 상한에 딱 떨어지지 않는 주사율은 상한 바로 위로 — 144Hz 에 60 이면 72fps,
 * 165Hz 는 82fps, 90 · 100Hz 는 그대로(반으로 자르면 45 · 50fps 라 오히려 답답하다).
 */

/** 0 = 제한 없음(화면 주사율 그대로) */
export type FrameLimit = 0 | 60 | 120;

export const FRAME_LIMIT_OPTIONS: readonly FrameLimit[] = [60, 120, 0];

export const FRAME_LIMIT_LABELS: Record<FrameLimit, string> = { 60: "60", 120: "120", 0: "제한 없음" };

export const isFrameLimit = (value: unknown): value is FrameLimit => value === 0 || value === 60 || value === 120;

/** 어림한 주사율이 조금 낮게 잡혀도(119.4Hz) 한 칸 덜 건너뛰지 않게 주는 여유 */
const FLOOR_SLACK = 0.05;

/**
 * refreshMs = 화면 갱신 간격(ms). 돌려주는 값 N = 갱신 N 번에 한 번 그린다(1 = 매번).
 * 상한 아래로는 내려가지 않는다 — 60 밑으로 떨어지면 답답하고, 나주의 자동 해상도(PerformanceMonitor 50 ~ 58fps)가 느린 기기로 읽는다
 */
export function refreshesPerFrame(refreshMs: number, limit: number): number {
  if (!(limit > 0) || !(refreshMs > 0)) return 1;
  return Math.max(1, Math.floor(1000 / refreshMs / limit + FLOOR_SLACK));
}

/**
 * 최근 갱신 간격들에서 화면 주사율의 간격을 어림한다 — 그리기가 밀려 두세 배로 벌어진 간격이 섞여도 흔들리지 않게 아래쪽(20%)을 본다.
 * 표본이 모자라면 null.
 */
export function estimateRefreshMs(deltas: readonly number[], minSamples = 20): number | null {
  if (deltas.length < minSamples) return null;
  const sorted = [...deltas].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.2)];
}

const QUERY = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
const FPS_PARAM = QUERY.get("fps");
/** ?fps=off · 60 · 120(· 측정용으로 20 ~ 240 사이 아무 값) — 설정보다 먼저다 */
const FORCED_LIMIT: number | null =
  FPS_PARAM === "off" ? 0 : FPS_PARAM !== null && +FPS_PARAM >= 20 && +FPS_PARAM <= 240 ? +FPS_PARAM : null;

/** 지금 쓸 상한(0 = 제한 없음) — 주소 스위치가 있으면 그 값 */
export const activeFrameLimit = (setting: FrameLimit): number => FORCED_LIMIT ?? setting;

/** 얼지 않았을 때의 Canvas frameloop — 상한이 있으면 FrameLimiter 가 그릴 때를 정한다 */
export const frameloopFor = (limit: number): "always" | "demand" => (limit > 0 ? "demand" : "always");
