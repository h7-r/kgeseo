import { exposeDevHook } from "@/debug/devHooks";
import { readMigrated, removeStorage, writeStorage } from "@/engine/storage";

// 서버 창구(USR-110 · 전역-002 · 전역-003). 진행 상태 쪽은 아직 localStorage 로 흉내만 낸다 —
// 서버가 준비되면 mockServer 를 fetch 구현으로 바꾸기만 하면 화면 코드는 그대로다.
// 잠금·해금 판단은 반드시 서버 값으로 한다(GRD-13). 클라이언트 플래그는 새로고침 한 번으로 우회된다.
//
// 제안 엔드포인트:
//   GET  /me/progress       → getProgress()
//   POST /me/avatar         → saveAvatar()
//   GET  /me/name-check     → checkInvestigatorName()
//   POST /me/tutorial/done  → completeTutorial()
//   POST /me/consent        → saveConsent()   갱신이 아니라 append(S1-006)
//   GET  /me/consent        → getConsentHistory()
// 모든 함수는 Promise 를 돌려주고 실패하면 던진다. 화면은 실패를 '게스트 신규'로 해석한다.

const PROGRESS_KEY = "waegok.progress.v1";
const LEGACY_PROGRESS_KEY = "왜곡.진행.v1";
const FAILURE_KEY = "waegok.serverFailures";
const LEGACY_FAILURE_KEY = "왜곡.서버실패";
// 동의 이력은 덮어쓰지 않고 쌓는다(S1-006). 약관이 개정되면 새 줄이 쌓이고 옛 줄은 남아야 한다.
const CONSENT_KEY = "waegok.consentHistory.v1";
const LEGACY_CONSENT_KEY = "왜곡.동의이력.v1";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class BackendError extends Error {
  readonly status: number | null;
  readonly detail: string;

  constructor(message: string, status: number | null, detail: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BackendError";
    this.status = status;
    this.detail = detail;
  }
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function readDetail(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("detail" in body)) return undefined;
  const { detail } = body;
  return detail === null || detail === undefined ? undefined : String(detail);
}

// 응답 모양은 백엔드 계약을 믿는다. 여기서 검사하지 않는다.
async function backendRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { Accept: "application/json", ...init.headers },
    });
  } catch (cause) {
    const message = errorMessage(cause);
    throw new BackendError(`Backend 요청 실패 (network): ${message}`, null, message, { cause });
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = readDetail(body) ?? response.statusText ?? "알 수 없는 오류";
    throw new BackendError(`Backend 요청 실패 (${response.status}): ${detail}`, response.status, detail);
  }

  return body as T;
}

export interface GoogleUser {
  name?: string;
  email?: string;
  picture?: string;
}

export interface AnonymousSessionResponse {
  data: { anonymous_session_id: string };
}

export interface CaseBundleObject {
  object_id: string;
  interaction?: { type: string };
}

export interface CaseBundleZone {
  zone_id: string;
  objects: CaseBundleObject[];
}

export interface CaseBundleResponse {
  data: { case_id: string; entry_zone_id: string; zones: CaseBundleZone[] };
}

export interface PlaySessionState {
  completed_puzzle_ids: string[];
  flags: Record<string, unknown>;
}

export interface PlaySessionResponse {
  data: { play_session_id: string; case_id: string; state: PlaySessionState };
}

/** 조회(GET) 응답에만 completed_at 이 있다. */
export interface PlaySessionReadResponse {
  data: PlaySessionResponse["data"] & { completed_at: string | null };
}

export interface InteractionRequest {
  client_event_id: string;
  client_timestamp: string;
  zone_id: string;
  action: string;
  target_type: string;
  target_id: string;
  payload: Record<string, unknown>;
}

export interface InteractionResult {
  result_type: string;
  [field: string]: unknown;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// 실제 백엔드 연결 확인용. 아래 모의 서버와는 따로 동작한다.
export const getBackendHealth = () => backendRequest<unknown>("/api/v1/health");
export const getDatabaseReadiness = () => backendRequest<unknown>("/api/v1/health/ready");
export const signInWithGoogle = (credential: string) =>
  backendRequest<GoogleUser>("/api/v1/auth/google", jsonInit("POST", { credential }));

// 소화전 자물쇠 vertical slice 용 실제 백엔드 API.
export const createAnonymousSession = () =>
  backendRequest<AnonymousSessionResponse>("/api/v1/anonymous-sessions", { method: "POST" });
export const getCaseBundle = (caseId: string) =>
  backendRequest<CaseBundleResponse>(`/api/v1/cases/${encodeURIComponent(caseId)}/bundle`);
export const createPlaySession = (anonymousSessionId: string, caseId: string) =>
  backendRequest<PlaySessionResponse>(
    "/api/v1/play-sessions",
    jsonInit("POST", { anonymous_session_id: anonymousSessionId, case_id: caseId }),
  );
export const getPlaySession = (playSessionId: string) =>
  backendRequest<PlaySessionReadResponse>(`/api/v1/play-sessions/${encodeURIComponent(playSessionId)}`);
export const submitInteraction = (playSessionId: string, interaction: InteractionRequest) =>
  backendRequest<InteractionResult>(
    `/api/v1/play-sessions/${encodeURIComponent(playSessionId)}/interactions`,
    jsonInit("POST", interaction),
  );

// 부팅 때 실패를 재현하려고 저장소에 남긴다. 콘솔: __game.forceServerFailure(true)
let forceFailure = readMigrated(FAILURE_KEY, LEGACY_FAILURE_KEY) === "1";

function setForceFailure(value = true) {
  forceFailure = value;
  if (value) writeStorage(FAILURE_KEY, "1");
  else removeStorage(FAILURE_KEY);
  console.log(`[모의서버] 강제실패 = ${value} (새로고침해도 유지)`);
}

exposeDevHook("forceServerFailure", setForceFailure);

/** 서버가 돌려주는 진행 상태. 이 모양이 계약서다. */
export interface Progress {
  /** 계정 없이 플레이 중인가(USR-005) */
  isGuest: boolean;
  /** S2 를 마쳤는가(USR-111) */
  hasAvatar: boolean;
  investigatorName: string | null;
  /** S5 훈련실을 마쳤는가(전역-003 · S5-013) */
  tutorialDone: boolean;
  /** 이어하기 후보(전역-004) */
  recentPlaySession: string | null;
  /** 필수 약관에 모두 동의했는가(S1-006) */
  termsAgreed: boolean;
  /** 만 14세 미만 분기용. 연도만 받는다(USR-003). */
  birthYear: number | null;
  marketingAgreed: boolean;
  avatarCombination?: unknown;
}

const DEFAULT_PROGRESS: Progress = {
  isGuest: true,
  hasAvatar: false,
  investigatorName: null,
  tutorialDone: false,
  recentPlaySession: null,
  termsAgreed: false,
  birthYear: null,
  marketingAgreed: false,
};

export type ConsentKey = "terms" | "privacy" | "marketing";

export interface ConsentItem {
  key: ConsentKey;
  /** 화면에 보이는 항목 이름 */
  name: string;
  required: boolean;
  agreed: boolean;
}

/** 누가 · 언제 · 어느 버전에 · 무엇에 동의했는가 */
export interface ConsentRecord {
  termsVersion: string;
  /** 지금은 클라이언트가 찍지만 실제 서버에서는 서버 시각으로 덮어써야 한다. */
  agreedAt: string;
  birthYear?: number | null;
  items: ConsentItem[];
}

export interface NameCheckResult {
  available: boolean;
  reason?: string;
}

const LEGACY_PROGRESS_FIELDS: Record<string, string> = {
  게스트: "isGuest",
  아바타있음: "hasAvatar",
  조사관명: "investigatorName",
  튜토리얼완료: "tutorialDone",
  최근플레이세션: "recentPlaySession",
  약관동의: "termsAgreed",
  생년: "birthYear",
  마케팅동의: "marketingAgreed",
  조합: "avatarCombination",
};

const LEGACY_CONSENT_FIELDS: Record<string, string> = {
  약관버전: "termsVersion",
  동의시각: "agreedAt",
  생년: "birthYear",
  항목: "items",
};

const LEGACY_CONSENT_ITEM_FIELDS: Record<string, string> = {
  키: "key",
  이름: "name",
  필수: "required",
  동의: "agreed",
};

const LEGACY_CONSENT_KEYS: Record<string, ConsentKey> = {
  이용약관: "terms",
  개인정보: "privacy",
  마케팅: "marketing",
};

function renameFields(value: unknown, fields: Record<string, string>): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [fields[key] ?? key, field]));
}

// 옛 한글 필드 이름으로 저장된 기록도 영어 필드로 옮겨 읽는다.
function toConsentRecord(raw: unknown): ConsentRecord {
  const record = renameFields(raw, LEGACY_CONSENT_FIELDS);
  const items = Array.isArray(record.items) ? record.items : [];
  return {
    ...(record as Partial<ConsentRecord>),
    items: items.map((rawItem) => {
      const item = renameFields(rawItem, LEGACY_CONSENT_ITEM_FIELDS);
      const key = typeof item.key === "string" ? (LEGACY_CONSENT_KEYS[item.key] ?? item.key) : item.key;
      return { ...item, key } as ConsentItem;
    }),
  } as ConsentRecord;
}

function readProgress(): Partial<Progress> | null {
  try {
    const raw: unknown = JSON.parse(readMigrated(PROGRESS_KEY, LEGACY_PROGRESS_KEY) || "null");
    return raw === null ? null : (renameFields(raw, LEGACY_PROGRESS_FIELDS) as Partial<Progress>);
  } catch {
    return null;
  }
}

function writeProgress(progress: Progress) {
  writeStorage(PROGRESS_KEY, JSON.stringify(progress));
}

function readConsentHistory(): ConsentRecord[] {
  try {
    const raw: unknown = JSON.parse(readMigrated(CONSENT_KEY, LEGACY_CONSENT_KEY) || "[]");
    return Array.isArray(raw) ? raw.map(toConsentRecord) : [];
  } catch {
    return [];
  }
}

const mockServer = {
  async getProgress(): Promise<Progress> {
    await delay(120);
    if (forceFailure) throw new Error("진행 상태 조회 실패(모의)");
    return { ...DEFAULT_PROGRESS, ...(readProgress() || {}) };
  },

  async updateProgress(patch: Partial<Progress>): Promise<Progress> {
    await delay(80);
    const next = { ...DEFAULT_PROGRESS, ...(readProgress() || {}), ...patch };
    writeProgress(next);
    return next;
  },

  /** 튜토리얼 완료는 서버가 기록한다(S5-013). */
  async completeTutorial() {
    return this.updateProgress({ tutorialDone: true });
  },

  /** 조합 검증은 원래 서버 몫이다(S2-009 · S2-010). 지금은 통과시킨다. */
  async saveAvatar(combination: unknown, investigatorName: string) {
    return this.updateProgress({ hasAvatar: true, avatarCombination: combination, investigatorName });
  },

  /** 필수 항목이 하나라도 빠지면 서버가 거절한다(USR-003 · S1-006). */
  async saveConsent(record: ConsentRecord) {
    await delay(120);
    if (forceFailure) throw new Error("동의 저장 실패(모의)");
    const missingRequired = (record.items || []).some((item) => item.required && !item.agreed);
    if (missingRequired) throw new Error("필수 항목에 동의하지 않았습니다.");

    const history = readConsentHistory();
    history.push(record);
    // 저장 공간이 막혀 있어도 진행은 막지 않는다.
    writeStorage(CONSENT_KEY, JSON.stringify(history));

    const marketing = (record.items || []).find((item) => item.key === "marketing");
    return this.updateProgress({
      termsAgreed: true,
      birthYear: record.birthYear ?? null,
      marketingAgreed: !!marketing?.agreed,
    });
  },

  async getConsentHistory(): Promise<ConsentRecord[]> {
    await delay(60);
    return readConsentHistory();
  },

  /** 금칙어 목록은 클라이언트로 내려보내지 않고 판정 결과만 준다(S2-008). */
  async checkInvestigatorName(name: string | null | undefined): Promise<NameCheckResult> {
    await delay(100);
    const length = [...(name || "")].length;
    if (length < 2 || length > 12) return { available: false, reason: "2~12자로 정해 주세요." };
    return { available: true };
  },
};

/** 화면 코드는 이 이름만 쓴다. 구현이 바뀌어도 여기만 갈아끼운다. */
export const server = mockServer;

/** 화면 구석 표시용 */
export const isMockServer = true;
