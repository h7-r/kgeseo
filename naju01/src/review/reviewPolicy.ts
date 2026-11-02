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
// base=empty — 빈 지형(10/19 에이전트 시험). 작업대 실행 구성 NAJU-01-EMPTY 가 붙인다
// trial — 에이전트 시험 배치 화면(작업대 「에이전트 시험」이 붙인다)
const PUBLIC_PARAMS = new Set(["aihub", "src", "r", "base", "trial"]);

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

export type VisualRequestType =
  | "kgeseo-review-capture"
  | "kgeseo-review-view"
  | "kgeseo-review-inspection"
  | "kgeseo-review-scene"
  | "kgeseo-review-place-start"
  | "kgeseo-review-place-adjust"
  | "kgeseo-review-place-cancel"
  | "kgeseo-review-place-commit"
  | "kgeseo-review-proposals"
  | "kgeseo-review-proposal-edit-start";
export const VISUAL_REQUEST_TYPES: readonly VisualRequestType[] = [
  "kgeseo-review-capture",
  "kgeseo-review-view",
  "kgeseo-review-inspection",
  "kgeseo-review-scene",
  "kgeseo-review-place-start",
  "kgeseo-review-place-adjust",
  "kgeseo-review-place-cancel",
  "kgeseo-review-place-commit",
  "kgeseo-review-proposals",
  "kgeseo-review-proposal-edit-start",
];

/** 좌표 한 점(미터) — 검수_배치편집_프로토콜_1015 §1 */
export interface ReviewPointM {
  x: number;
  y: number;
  z: number;
}

/** 배치할 라이브러리 에셋 — url 은 같은 출처의 .glb 경로만 */
export interface PlacementAsset {
  id: string;
  url: string;
  nameKo: string;
  source?: "public" | "khs" | "palette" | "catalog";
  sha256?: string;
}

/** 서버에 저장된 배치 변경안(placements[] 한 줄) — 게임은 asset·position·rotationY·scale·status·groundSnap 만 쓴다 */
export interface PlacementProposal {
  id: string;
  asset: PlacementAsset;
  /** groundSnap 이면 y 가 없을 수 있다(게임이 그 자리 땅 높이에 세운다) — 규약 §6 */
  position: { x: number; y?: number; z: number };
  rotationY: number;
  scale: number;
  status: "proposed" | "withdrawn" | "applied";
  groundSnap?: boolean;
  [key: string]: unknown;
}

export interface VisualRequest {
  type: VisualRequestType;
  projectId: string;
  sessionId: string;
  requestId: string;
  viewId?: string;
  enabled?: boolean;
  /** kgeseo-review-scene — 0 = 묶음 해제 · 1..5 = 씬 */
  scene?: number;
  /** kgeseo-review-place-start */
  asset?: PlacementAsset;
  at?: ReviewPointM;
  /** place-start · place-adjust — 도 */
  rotationY?: number;
  scale?: number;
  /** place-adjust */
  position?: ReviewPointM;
  mode?: "move" | "rotate";
  /** kgeseo-review-proposals */
  proposals?: PlacementProposal[];
  /** kgeseo-review-proposal-edit-start — 고칠 변경안 id(서버 placements[].id) */
  proposalId?: string;
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

// ── 배치 편집 메시지 검사(10/15) — 키 목록·모양을 엄격히 본다. 모르는 키·자유 문자열 주소는 받지 않는다 ──
/** 메시지 type 별로 봉투(type·projectId·sessionId·requestId) 말고 더 받을 수 있는 키 */
const EXTRA_KEYS: Record<VisualRequestType, readonly string[]> = {
  "kgeseo-review-capture": ["viewId"],
  "kgeseo-review-view": ["viewId"],
  "kgeseo-review-inspection": ["enabled"],
  "kgeseo-review-scene": ["scene"],
  "kgeseo-review-place-start": ["asset", "at", "rotationY", "scale"],
  "kgeseo-review-place-adjust": ["position", "rotationY", "scale", "mode"],
  "kgeseo-review-place-cancel": [],
  "kgeseo-review-place-commit": [],
  "kgeseo-review-proposals": ["proposals"],
  "kgeseo-review-proposal-edit-start": ["proposalId"],
};
const ASSET_KEYS = new Set(["id", "url", "nameKo", "source", "sha256"]);
const ASSET_SOURCES = new Set(["public", "khs", "palette", "catalog"]);
/** 서버 placements[] 기록의 키(프로토콜 §3) — 이 밖의 키가 오면 거절한다 */
const PROPOSAL_KEYS = new Set([
  "id",
  "at",
  "reviewer",
  "note",
  "projectRevision",
  "gameRevision",
  "runtimeId",
  "sceneNo",
  "zoneId",
  "asset",
  "position",
  "rotationY",
  "scale",
  "status",
  "appliedAt",
  "manifestEntryId",
  // 규약 §6 — AI 초안 가져오기·변경안 고치기
  "groundSnap",
  "origin",
  "trialId",
  "reqId",
  "replaces",
]);
const PROPOSAL_STATUS = new Set(["proposed", "withdrawn", "applied"]);
/** 좌표 한도(m) — 맵(80 × 50 m) 바깥 먼 곳·무한대 값을 막는다 */
const COORD_LIMIT_M = 1000;
export const PLACEMENT_SCALE_RANGE: readonly [number, number] = [0.05, 20];
export const MAX_PROPOSALS = 300;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  ![...value].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);

/** {x,y,z} 미터 — 키는 정확히 셋, 모두 유한수 */
export function isReviewPoint(value: unknown): value is ReviewPointM {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 3 &&
    ["x", "y", "z"].every((key) => isFiniteNumber(value[key]) && Math.abs(value[key] as number) <= COORD_LIMIT_M)
  );
}

/**
 * 같은 출처의 .glb 경로만 — `/naju01/_sf_local/a.glb` 같은 절대 경로나 `_sf_local/khs/b.glb` 같은 상대 경로.
 * 다른 출처(`https://`, `//host`), 상위 폴더(`..`), 역슬래시, 쿼리·조각은 받지 않는다.
 */
export function isPlacementAssetUrl(value: unknown): value is string {
  if (!isText(value, 500)) return false;
  if (value.includes("..") || value.includes("\\") || value.includes("://") || value.startsWith("//")) return false;
  return /^(?:\/|[^/\s?#:])[^\s?#:]*\.glb$/i.test(value);
}

export function isPlacementAsset(value: unknown): value is PlacementAsset {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !ASSET_KEYS.has(key))) return false;
  if (!isText(value.id, 200) || !isText(value.nameKo, 120) || !isPlacementAssetUrl(value.url)) return false;
  if (value.source !== undefined && !ASSET_SOURCES.has(value.source as string)) return false;
  if (value.sha256 !== undefined && !(typeof value.sha256 === "string" && /^[a-f0-9]{64}$/i.test(value.sha256)))
    return false;
  return true;
}

const isPlacementScale = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= PLACEMENT_SCALE_RANGE[0] && value <= PLACEMENT_SCALE_RANGE[1];

/** 변경안 위치 — {x,y,z} 이거나, groundSnap 이면 {x,z}(y 없음 · null) */
function isProposalPosition(value: unknown, groundSnap: boolean): boolean {
  if (isReviewPoint(value)) return true;
  if (!groundSnap || !isPlainObject(value)) return false;
  const keys = Object.keys(value).filter((key) => !(key === "y" && value.y == null));
  return (
    keys.length === 2 &&
    ["x", "z"].every((key) => isFiniteNumber(value[key]) && Math.abs(value[key] as number) <= COORD_LIMIT_M)
  );
}

export function isPlacementProposal(value: unknown): value is PlacementProposal {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !PROPOSAL_KEYS.has(key))) return false;
  if (value.groundSnap !== undefined && typeof value.groundSnap !== "boolean") return false;
  for (const key of ["origin", "trialId", "reqId", "replaces"])
    if (value[key] !== undefined && value[key] !== null && !isText(value[key], 200)) return false;
  return (
    typeof value.id === "string" &&
    ID_PATTERN.test(value.id) &&
    isPlacementAsset(value.asset) &&
    isProposalPosition(value.position, value.groundSnap === true) &&
    isFiniteNumber(value.rotationY) &&
    isPlacementScale(value.scale) &&
    PROPOSAL_STATUS.has(value.status as string)
  );
}

/** 새 메시지(씬·배치·변경안)의 값 검사 — 문제가 있으면 사람이 읽을 문장, 없으면 "" */
function placementRequestError(request: VisualRequest): string {
  const q = request as unknown as Record<string, unknown>;
  const optionalRotation = q.rotationY === undefined || isFiniteNumber(q.rotationY);
  const optionalScale = q.scale === undefined || isPlacementScale(q.scale);
  switch (request.type) {
    case "kgeseo-review-scene":
      return Number.isInteger(q.scene) && (q.scene as number) >= 0 && (q.scene as number) <= 5
        ? ""
        : "씬 번호는 0~5 사이 정수여야 합니다.";
    case "kgeseo-review-place-start":
      if (!isPlacementAsset(q.asset)) return "배치할 에셋 정보(id·url·nameKo)가 올바르지 않습니다.";
      if (!isReviewPoint(q.at)) return "배치 위치(at: x·y·z 미터)가 올바르지 않습니다.";
      return optionalRotation && optionalScale ? "" : "회전·배율 값이 올바르지 않습니다.";
    case "kgeseo-review-place-adjust":
      if (q.position !== undefined && !isReviewPoint(q.position))
        return "위치(position: x·y·z 미터)가 올바르지 않습니다.";
      if (q.mode !== undefined && q.mode !== "move" && q.mode !== "rotate") return "조작 방식은 move·rotate 만 됩니다.";
      return optionalRotation && optionalScale ? "" : "회전·배율 값이 올바르지 않습니다.";
    case "kgeseo-review-proposals":
      if (!Array.isArray(q.proposals) || q.proposals.length > MAX_PROPOSALS) return "변경안 목록이 올바르지 않습니다.";
      return q.proposals.every(isPlacementProposal) ? "" : "변경안 목록에 올바르지 않은 항목이 있습니다.";
    case "kgeseo-review-proposal-edit-start":
      return typeof q.proposalId === "string" && ID_PATTERN.test(q.proposalId)
        ? ""
        : "고칠 변경안 ID(proposalId)가 올바르지 않습니다.";
    default:
      return "";
  }
}

/** 시각 점검 메시지는 부모 창의 등록된 시점만 받는다. 외부 창·자유 좌표는 받지 않는다(배치 편집 메시지는 검사한 좌표만) */
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
  const allowed = new Set(["type", "projectId", "sessionId", "requestId", ...EXTRA_KEYS[request.type]]);
  const isLegacy =
    request.type === "kgeseo-review-capture" ||
    request.type === "kgeseo-review-view" ||
    request.type === "kgeseo-review-inspection";
  if (Object.keys(request).some((key) => !allowed.has(key)))
    return {
      request,
      error: isLegacy ? "등록된 구역 시점만 사용할 수 있습니다." : "허용되지 않은 값이 들어 있습니다.",
    };
  if (request.type === "kgeseo-review-inspection")
    return typeof request.enabled === "boolean"
      ? { request }
      : { request, error: "시각 점검 설정이 올바르지 않습니다." };
  if (!isLegacy) {
    const error = placementRequestError(request);
    return error ? { request, error } : { request };
  }
  const view = views.find((item) => item.id === request.viewId);
  return view ? { request, view } : { request, error: "등록되지 않은 구역 시점입니다." };
}

/**
 * 맞은 메시 이름 → 땅 표면 계열(빈 자리 고르기용). 식별할 물체면 null.
 *   이름은 plan/meshNames.ts 의 MESH_NAMES 와 같다 — 이 파일은 node --test 가 import 없이 읽어야 해서 글자로 둔다.
 *   돌·바위 무리(path.stones · river.stones · blocker.rock …)는 물체로 본다(반려·수정 대상).
 */
const SURFACE_BY_MESH: Record<string, string> = {
  ground: "ground",
  grass: "ground",
  "ground.pebbles": "ground",
  NAJU01_terrain: "ground",
  path: "path",
  "path.embankment": "path",
  connectorRamp: "path",
  slope: "slope",
  cliffFace: "cliff",
  "cliff.scree": "cliff",
  "zone.sides": "cliff",
  "river.surface": "river",
  "river.farBank": "riverbank",
};
export function classifyReviewSurface(meshName: string | null | undefined): string | null {
  return SURFACE_BY_MESH[String(meshName || "")] ?? null;
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
