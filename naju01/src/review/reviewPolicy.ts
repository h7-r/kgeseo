/**
 * reviewPolicy.ts — 검수 실행의 주소·관측 규칙 (옛 검수정책.js 이식)
 *   브라우저 부작용 없이 node --test 로 검사할 수 있게 순수 함수만 둔다(tools/review/game-bridge.test.mjs).
 *
 * [옛 이름 → 새 이름]
 *   검수주소읽기 → readReviewUrl · 검수에서막을키 → shouldBlockKeyInReview · 검수측정읽기 → readReviewMetrics
 *   검수오류문장 → reviewErrorText · 검수복귀메시지 → reviewReturnMessage · 검수시각요청읽기 → readVisualRequest
 *   검수물체식별 → identifyReviewObject · 식별자 → ID_PATTERN · 토큰형식 → TOKEN_PATTERN · 설정허용 → ALLOWED_PARAMS · 공개설정 → PUBLIC_PARAMS
 *   측정 입력 키: X/Z/EL/자리/거리/최악ms/삼각형/드로우콜/텍스처수/형상수/힙MB/지형출처
 *     → x/z/elevation/placeName/distance/worstFrameMs/triangles/drawCalls/textures/geometryCount/jsHeapMB/terrainSource
 *     (NajuSceneReport 의 이름을 그대로 쓴다. textures·geometryCount·jsHeapMB 는 보고에 없어 ReviewBridge 가 gl.info 에서 덧붙인다)
 */

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;
const TOKEN_PATTERN = /^[a-zA-Z0-9_-]{20,200}$/;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const ALLOWED_PARAMS = new Set([
  "review",
  "reviewProject",
  "reviewSession",
  "reviewKind",
  "reviewMode",
  "gameRevision",
]);
const PUBLIC_PARAMS = new Set(["aihub", "src", "r"]);

export type ReviewMode = "normal" | "diagnostic";
export type ReviewKind = "space" | "play";
export type RuntimeProfile = "naju-base-v1" | "naju-public-sf-v1";

export interface ReviewRun {
  projectId: string;
  sessionId: string;
  token: string;
  mode: ReviewMode;
  kind: ReviewKind;
  gameRevision: string;
  runtimeProfile: RuntimeProfile;
  errors: string[];
  valid: boolean;
}

/** `/naju01/?review=1&…#reviewToken=…` 를 읽는다. 개발 서버가 아니거나 검수 주소가 아니면 null */
export function readReviewUrl(href: string | null | undefined, isDev = false): ReviewRun | null {
  if (!isDev || !href) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!/^\/naju01(?:\/|$)/.test(url.pathname) || url.searchParams.get("review") !== "1") return null;
  const q = url.searchParams;
  const token = new URLSearchParams(url.hash.slice(1)).get("reviewToken") || "";
  const projectId = q.get("reviewProject") || "";
  const sessionId = q.get("reviewSession") || "";
  const mode = q.get("reviewMode") || "normal";
  const kind = q.get("reviewKind") || "space";
  const gameRevision = q.get("gameRevision") || "";
  // 5174 의 공개 에셋 구성만 정확히 재현한다. 이름이 같은 AI허브 전시의 기본 경로(src 없음)나
  // 검수 진열/면수 모드는 이 실행 구성에 포함하지 않는다.
  // TODO: `r=15` 는 게임(publicAssetManifest.ts)이 읽지 않는 값이다 — 작업대(tools/review/data.mjs)의 주소와 맞추려고 그대로 둔다.
  const isPublicSwap = q.has("aihub") && q.get("aihub") === "" && q.get("src") === "sf" && q.get("r") === "15";
  const runtimeProfile: RuntimeProfile = isPublicSwap ? "naju-public-sf-v1" : "naju-base-v1";
  const extra = [...q.keys()].filter((key) => !ALLOWED_PARAMS.has(key) && !(isPublicSwap && PUBLIC_PARAMS.has(key)));
  const errors: string[] = [];
  if (!ID_PATTERN.test(projectId) || !ID_PATTERN.test(sessionId)) errors.push("검수 대상 또는 실행 식별자가 없습니다.");
  if (!TOKEN_PATTERN.test(token)) errors.push("검수 실행 키가 없습니다. 검수 작업대에서 다시 여세요.");
  if (!["normal", "diagnostic"].includes(mode) || !["space", "play"].includes(kind))
    errors.push("검수 실행 종류가 올바르지 않습니다.");
  if (!gameRevision || gameRevision.length > 200) errors.push("게임 버전을 확인할 수 없습니다.");
  if (mode === "normal" && extra.length)
    errors.push("정상 검수에서는 추가 개발 설정을 사용할 수 없습니다. 작업대에서 다시 여세요.");
  if ([...PUBLIC_PARAMS].some((key) => q.has(key)) && !isPublicSwap)
    errors.push("검수 작업대에 등록된 공개 에셋 구성으로 다시 여세요. AI허브 자료 미리보기는 연결하지 않습니다.");
  if ([...new Set(q.keys())].some((key) => q.getAll(key).length !== 1))
    errors.push("실행 설정이 중복되어 있습니다. 검수 작업대에서 다시 여세요.");
  return {
    projectId,
    sessionId,
    token,
    mode: mode as ReviewMode,
    kind: kind as ReviewKind,
    gameRevision,
    runtimeProfile,
    errors,
    valid: errors.length === 0,
  };
}

/** 키 이벤트의 최소 꼴 — 실제 KeyboardEvent 와 검사용 가짜 둘 다 받는다 */
export interface KeyLike {
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: { closest?: (selector: string) => unknown } | null;
}

/** 정상 검수에서 막는 개발 단축키(편집 E · 순간이동 1~5 · 강제 씬 완료 Shift+숫자 · O · N). HUD 입력 중엔 모두 막는다 */
export function shouldBlockKeyInReview(event: KeyLike, mode: string = "normal"): boolean {
  const target = event.target;
  // 기록 입력 중에는 T/V/WASD 등 게임 단축키로 전파하지 않는다.
  if (target?.closest?.("[data-review-hud]")) return true;
  if (mode !== "normal" || event.metaKey || event.ctrlKey || event.altKey) return false;
  return /^Digit[1-5]$/.test(event.code ?? "") || ["KeyE", "KeyO", "KeyN"].includes(event.code ?? "");
}

/** 측정에 쓰는 보고 필드 — NajuSceneReport(useSceneFrame) 의 이름과 같다. 전부 선택이라 부분 보고도 받는다 */
export interface ReviewMetricSource {
  x?: number;
  z?: number;
  elevation?: number;
  placeName?: string;
  distance?: number;
  fps?: number;
  worstFrameMs?: number;
  triangles?: number;
  drawCalls?: number;
  /** gl.info.memory.textures — 보고에 없어 ReviewBridge 가 덧붙인다 */
  textures?: number;
  /** gl.info.memory.geometries */
  geometryCount?: number;
  /** performance.memory.usedJSHeapSize / 1 MiB (Chromium 만) */
  jsHeapMB?: number | null;
  terrainSource?: string;
}

export interface ReviewMetrics {
  position: { x: number | null; z: number | null; elevation: number | null };
  area: string;
  distance: number | null;
  fps: number | null;
  worstFrameMs: number | null;
  triangles: number | null;
  drawCalls: number | null;
  textures: number | null;
  geometryCount: number | null;
  jsHeapMB: number | null;
  terrain: string;
  /** 텍스처 수·JS 힙은 그래픽 메모리 사용량을 뜻하지 않는다 */
  gpuMemoryMeasured: false;
}

/** 보고에서 직렬화 가능한 숫자·문자만 골라 둘째 자리로 반올림한다 */
export function readReviewMetrics(value: ReviewMetricSource | null | undefined): ReviewMetrics | null {
  if (!value) return null;
  const finite = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
  return {
    position: { x: finite(value.x), z: finite(value.z), elevation: finite(value.elevation) },
    area: String(value.placeName || "").slice(0, 100),
    distance: finite(value.distance),
    fps: finite(value.fps),
    worstFrameMs: finite(value.worstFrameMs),
    triangles: finite(value.triangles),
    drawCalls: finite(value.drawCalls),
    textures: finite(value.textures),
    geometryCount: finite(value.geometryCount),
    jsHeapMB: finite(value.jsHeapMB),
    terrain: String(value.terrainSource || "").slice(0, 100),
    gpuMemoryMeasured: false,
  };
}

/** 오류를 500자 문장으로 — 실행 키는 어디에 섞여 있어도 가린다 */
export function reviewErrorText(value: unknown, token = ""): string {
  let text = String((value as { message?: unknown } | null)?.message || value || "알 수 없는 오류");
  if (token) text = text.split(token).join("[검수 키 숨김]");
  return text.replace(/([?#])reviewToken=[^\s&]*/g, "$1reviewToken=[숨김]").slice(0, 500);
}

export interface ReviewReturnMessage {
  type: "kgeseo-review-return";
  projectId: string;
  sessionId: string;
}

/** 부모 화면에 넘기는 것은 검수 대상을 찾을 식별자뿐이다. 실행 키는 포함하지 않는다 */
export function reviewReturnMessage(
  run: Pick<ReviewRun, "projectId" | "sessionId"> | null | undefined,
): ReviewReturnMessage | null {
  if (!run || !ID_PATTERN.test(run.projectId) || !ID_PATTERN.test(run.sessionId)) return null;
  return { type: "kgeseo-review-return", projectId: run.projectId, sessionId: run.sessionId };
}

/** reviewViews.json 한 줄 */
export interface ReviewView {
  id: string;
  zoneId: string;
  zoneName: string;
  label: string;
  /** 세계 유닛(미터 × UNITS_PER_METER) */
  position: [number, number, number];
  target: [number, number, number];
}

export type VisualRequestType = "kgeseo-review-capture" | "kgeseo-review-view" | "kgeseo-review-inspection";
export const VISUAL_REQUEST_TYPES: readonly VisualRequestType[] = [
  "kgeseo-review-capture",
  "kgeseo-review-view",
  "kgeseo-review-inspection",
];

export interface VisualRequest {
  type: VisualRequestType;
  projectId: string;
  sessionId: string;
  requestId: string;
  viewId?: string;
  enabled?: boolean;
}

export interface VisualRequestCheck {
  request: VisualRequest;
  view?: ReviewView;
  error?: string;
}

/** postMessage 의 최소 꼴 — MessageEvent 와 검사용 가짜 둘 다 받는다 */
export interface MessageLike {
  data?: unknown;
  origin?: string;
  source?: unknown;
}

/** 시각 점검 메시지는 부모 창의 등록된 시점만 받는다. 외부 창·자유 좌표는 받지 않는다 */
export function readVisualRequest(
  event: MessageLike | null | undefined,
  run: ReviewRun | null | undefined,
  parent: unknown,
  origin: string,
  views: readonly ReviewView[],
): VisualRequestCheck | null {
  const q = event?.data as Partial<VisualRequest> | null | undefined;
  if (
    !run?.valid ||
    event?.origin !== origin ||
    event?.source !== parent ||
    !q ||
    !VISUAL_REQUEST_TYPES.includes(q.type as VisualRequestType) ||
    q.projectId !== run.projectId ||
    q.sessionId !== run.sessionId ||
    typeof q.requestId !== "string" ||
    !REQUEST_ID_PATTERN.test(q.requestId)
  )
    return null;
  const request = q as VisualRequest;
  if (run.mode !== "diagnostic") return { request, error: "구역 시각 점검은 진단 실행에서만 사용할 수 있습니다." };
  const allowed = new Set([
    "type",
    "projectId",
    "sessionId",
    "requestId",
    request.type === "kgeseo-review-inspection" ? "enabled" : "viewId",
  ]);
  if (Object.keys(request).some((key) => !allowed.has(key)))
    return { request, error: "등록된 구역 시점만 사용할 수 있습니다." };
  if (request.type === "kgeseo-review-inspection")
    return typeof request.enabled === "boolean"
      ? { request }
      : { request, error: "시각 점검 설정이 올바르지 않습니다." };
  const view = views.find((item) => item.id === request.viewId);
  return view ? { request, view } : { request, error: "등록되지 않은 구역 시점입니다." };
}

export interface ReviewObjectIdentityInput {
  meshName?: string | null;
  groupName?: string | null;
  instanceId?: number | null;
  originalInstanceId?: number | null;
}

export interface ReviewObjectIdentity {
  objectId: string;
  name: string;
  meshName: string;
  groupName: string;
  instanceId: number | null;
  originalInstanceId: number | null;
  /** exact = 무리 + 원본 번호까지 · group = 무리 이름만 */
  identityQuality: "exact" | "group";
}

/** 클릭한 메시를 검수 기록용 식별자로 — 무리 이름과 원본 자리 번호가 있으면 정확 식별, 아니면 무리 단위 */
export function identifyReviewObject({
  meshName,
  groupName,
  instanceId,
  originalInstanceId,
}: ReviewObjectIdentityInput): ReviewObjectIdentity {
  const group = String(groupName || meshName || "").slice(0, 160);
  const mapped = Number.isInteger(originalInstanceId) && (originalInstanceId as number) >= 0;
  return {
    objectId: mapped && group ? `${group}#${originalInstanceId}` : `group:${group || "unregistered"}`,
    name: group || "이름 미등록",
    meshName: String(meshName || "").slice(0, 160),
    groupName: group,
    instanceId: Number.isInteger(instanceId) ? (instanceId as number) : null,
    originalInstanceId: mapped ? (originalInstanceId as number) : null,
    identityQuality: mapped && group ? "exact" : "group",
  };
}
