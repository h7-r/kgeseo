/**
 * 동행 NPC 용 플레이 세션. NPC 턴은 content_version 을 고정한 세션에서만 돈다(레거시 세션은 늘 409).
 *
 * - 케이스 · 버전이 정해지지 않았으면(나주 콘텐츠 미게시) 세션을 만들지 않는다 → NPC 말 걸기 비활성, 추종은 그대로.
 * - 409 CASE_VERSION_UNAVAILABLE 은 재생성으로 풀리지 않는다 → 비활성(게임 계속).
 * - 404(세션 없음)만 새로 만든다. 410(익명 세션 만료)은 익명 세션부터 다시.
 * - 시작할 때마다 익명 세션(게스트 쿠키)부터 받는다 — 플레이 API 는 쿠키로 주인을 가린다(#47, 계약 v0.4.16 §10-7).
 * React · 별칭을 쓰지 않는다(node --test).
 */
import {
  CompanionApiError,
  createAnonymousSession,
  createPinnedPlaySession,
  errorCode,
  loadPlaySession,
  type PlaySessionData,
} from "./companionApi.ts";

export interface CompanionSessionConfig {
  caseId: string;
  contentVersion: number;
}

export type CompanionSessionStatus =
  | { phase: "off"; reason: "not-configured" }
  | { phase: "starting" }
  | {
      phase: "ready";
      playSessionId: string;
      caseId: string;
      contentVersion: number;
      hintLevels: Record<string, number>;
    }
  | { phase: "unavailable"; reason: UnavailableReason };

/** 화면에 내지 않는다 — 콘솔 · 검사용 구분 */
export type UnavailableReason =
  "case-version-unavailable" | "case-not-found" | "case-content-unavailable" | "server-unreachable" | "unexpected";

interface StoredRecord {
  anonymousSessionId: string | null;
  playSessionId: string | null;
  caseId: string;
  contentVersion: number;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SESSION_STORAGE_KEY = "kgeseo.naju.npc-session.v1";

function readRecord(store: KeyValueStore | null): StoredRecord | null {
  try {
    const raw = store?.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.caseId !== "string" || typeof record.contentVersion !== "number") return null;
    return {
      anonymousSessionId: typeof record.anonymousSessionId === "string" ? record.anonymousSessionId : null,
      playSessionId: typeof record.playSessionId === "string" ? record.playSessionId : null,
      caseId: record.caseId,
      contentVersion: record.contentVersion,
    };
  } catch {
    return null;
  }
}

function writeRecord(store: KeyValueStore | null, record: StoredRecord) {
  try {
    store?.setItem(SESSION_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // 저장이 막혀도 이번 플레이는 이어 간다
  }
}

function unavailableReason(error: unknown): UnavailableReason {
  if (!(error instanceof CompanionApiError)) return "unexpected";
  if (error.status === null || (error.status >= 502 && error.status <= 504)) return "server-unreachable";
  const code = errorCode(error);
  if (code === "CASE_VERSION_UNAVAILABLE") return "case-version-unavailable";
  if (code === "Case not found.") return "case-not-found";
  if (code === "Case content is unavailable.") return "case-content-unavailable";
  return "unexpected";
}

export function createCompanionSession(options: {
  config: CompanionSessionConfig | null;
  storage?: KeyValueStore | null;
  log?: (message: string, detail?: unknown) => void;
  /** 세션 생성 · 조회 응답의 asset_base_path(없으면 null) — 런타임이 setAssetVersionPath 로 넘긴다 */
  onAssetBasePath?: (path: string | null) => void;
}) {
  const storage = options.storage ?? null;
  const log = options.log ?? (() => {});
  let status: CompanionSessionStatus = options.config
    ? { phase: "starting" }
    : { phase: "off", reason: "not-configured" };
  const listeners = new Set<() => void>();
  let starting: Promise<CompanionSessionStatus> | null = null;

  const set = (next: CompanionSessionStatus) => {
    status = next;
    for (const listener of listeners) listener();
    return next;
  };

  const ready = (record: StoredRecord, data: PlaySessionData) => {
    // 에셋 경로를 상태보다 먼저 알린다 — ready 를 듣고 읽는 에셋이 이 판의 경로를 쓰게
    options.onAssetBasePath?.(data.asset_base_path ?? null);
    return set({
      phase: "ready",
      playSessionId: record.playSessionId as string,
      caseId: record.caseId,
      contentVersion: record.contentVersion,
      hintLevels: { ...(data.state.hint_levels ?? {}) },
    });
  };

  async function createFresh(config: CompanionSessionConfig, issuedAnonymousId: string) {
    let anonymousSessionId: string | null = issuedAnonymousId;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!anonymousSessionId) anonymousSessionId = await createAnonymousSession();
      try {
        const data = await createPinnedPlaySession(anonymousSessionId, config.caseId, config.contentVersion);
        const record: StoredRecord = {
          anonymousSessionId,
          playSessionId: data.play_session_id,
          caseId: config.caseId,
          contentVersion: config.contentVersion,
        };
        writeRecord(storage, record);
        return ready(record, data);
      } catch (error) {
        // 익명 세션이 없거나 만료됐으면 한 번만 새로 받아 다시 만든다
        const status = error instanceof CompanionApiError ? error.status : null;
        if (attempt === 0 && (status === 404 || status === 410) && errorCode(error)?.startsWith("Anonymous")) {
          anonymousSessionId = null;
          continue;
        }
        throw error;
      }
    }
    throw new CompanionApiError(null, "ANONYMOUS_SESSION_RETRY_EXHAUSTED", null);
  }

  async function startOnce(config: CompanionSessionConfig): Promise<CompanionSessionStatus> {
    set({ phase: "starting" });
    const stored = readRecord(storage);
    // 케이스 · 버전이 같은 기록만 이어 쓴다. 버전 없는 옛 기록은 NPC 용으로 쓰지 않는다.
    const reusable =
      stored && stored.caseId === config.caseId && stored.contentVersion === config.contentVersion ? stored : null;
    try {
      // 게스트 쿠키를 먼저 받는다(계약 v0.4.16 §10-7) — 조회 · 생성 모두 쿠키로 주인을 가린다.
      // 쿠키가 살아 있으면 같은 익명 세션이, 로그인 중이면 호환용 익명 세션이 온다(권한 아님)
      const anonymousSessionId = await createAnonymousSession();
      if (reusable?.playSessionId) {
        try {
          const data = await loadPlaySession(reusable.playSessionId);
          if (data.case_id === config.caseId) {
            const record = { ...reusable, anonymousSessionId };
            writeRecord(storage, record);
            return ready(record, data);
          }
        } catch (error) {
          // 세션이 없어졌을 때만 새로 만든다(남의 · 옛 소유자 없는 세션도 404). 그 밖(409 · 500 · 연결)은 아래에서 상태로 바꾼다
          if (!(error instanceof CompanionApiError && error.status === 404)) throw error;
          log("저장된 동행 세션이 없어 새로 만든다");
        }
      }
      return await createFresh(config, anonymousSessionId);
    } catch (error) {
      const reason = unavailableReason(error);
      log(`동행 NPC 세션을 쓸 수 없다(${reason})`, error);
      return set({ phase: "unavailable", reason });
    }
  }

  return {
    getStatus: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** 여러 번 불러도 한 번만 돈다 */
    start(): Promise<CompanionSessionStatus> {
      if (!options.config) return Promise.resolve(status);
      starting ??= startOnce(options.config).finally(() => {
        starting = null;
      });
      return starting;
    },
    /** NPC · Hint 가 404(세션 없음)를 받았을 때 — 저장 기록을 버리고 새 세션을 만든다 */
    async recreate(): Promise<CompanionSessionStatus> {
      if (!options.config) return status;
      const stored = readRecord(storage);
      writeRecord(storage, {
        anonymousSessionId: stored?.anonymousSessionId ?? null,
        playSessionId: null,
        caseId: options.config.caseId,
        contentVersion: options.config.contentVersion,
      });
      return this.start();
    },
    /** 버전 고정 세션에서 온 CASE_VERSION_UNAVAILABLE 등 — 재시도로 풀리지 않으니 끈다 */
    disable(reason: UnavailableReason) {
      set({ phase: "unavailable", reason });
    },
    /** Hint 응답이 바꾼 힌트 단계를 반영한다(state_changes 대신 결과 값) */
    noteHintLevel(puzzleId: string, level: number) {
      if (status.phase !== "ready") return;
      set({ ...status, hintLevels: { ...status.hintLevels, [puzzleId]: level } });
    },
  };
}

export type CompanionSession = ReturnType<typeof createCompanionSession>;
