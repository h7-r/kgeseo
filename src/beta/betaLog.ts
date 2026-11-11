/**
 * 베타 분석 기록(beta_events) — 로그인한 계정(베타 참가자는 모두 회원, 미르 11/11)의 플레이를 쌓아 보낸다. 참여 코드(`?pc=`)는 있으면 함께 붙는다.
 * 로그인하지 않았고 코드도 없으면 보내지 않는다(서버도 저장하지 않는다).
 * 기록마다 만든 때의 계정(acct)을 찍고, 서버는 지금 로그인 쿠키와 같을 때만 그 계정으로 저장한다 — 공용 PC 에서 계정이 바뀌어도
 * 앞사람 기록이 다음 사람 계정에 붙지 않는다. 계정을 확인하기 전의 기록은 페이지 안에 잡아 두었다가 확인되면 찍어 넣는다.
 *
 * - 게임 진행 · 진행 API(interactions) · 로그인 저장(game-save)과 따로 간다. 여기서 난 오류는 밖으로 던지지 않고, 게임은 전송을 기다리지 않는다.
 * - 참여 코드는 주소의 `?pc=` 로 한 번 받아 이 출처(localStorage)에 보관한다 — 본편 → 나주(/naju01/)는 같은 출처라 그대로 이어진다.
 * - 보내지 못한 기록은 localStorage 에 남겨 다음 페이지 · 새로 고침에서 같은 event_id 로 다시 보낸다(서버가 중복을 거른다).
 * - 페이지를 떠날 때는 keepalive + text/plain(사전 요청 없음)으로 한 번 더 보낸다. 성공을 확인할 수 없으니 대기열에서는 지우지 않는다.
 * - 끄기: 빌드 변수 VITE_BETA_LOG=off · 서버가 disabled 로 답하면 이 페이지에서는 그만 보낸다.
 *
 * 이 파일은 React · 별칭(@/)을 쓰지 않는다 — node --test 로 바로 돈다(naju01/tests/betaLog.test.ts).
 */

export type BetaEventType =
  | "beta_entry"
  | "stage_reached"
  | "run_state"
  | "objective_state"
  | "puzzle_attempt"
  | "help_event"
  | "npc_turn"
  | "story_exposure"
  | "activity_snapshot"
  | "client_error"
  | "survey_link";

export type BetaPage = "main" | "naju";

export interface BetaEvent {
  event_id: string;
  type: BetaEventType;
  phase?: string;
  pc?: string;
  run_id?: string;
  run_index?: number;
  tab_id?: string;
  seq?: number;
  client_ts: string;
  objective_id?: string;
  page?: BetaPage;
  build?: string;
  /** 만든 때의 계정 id — 로그인하지 않았으면 "" (서버가 쿠키 계정과 맞춰 본다) */
  acct?: string;
  data?: Record<string, unknown>;
}

export interface TrackFields {
  objective_id?: string | null;
  data?: Record<string, unknown>;
  /** 나주 회차를 붙인다(기본: 나주 페이지면 붙임) */
  withRun?: boolean;
  /** 곧바로 보낸다(엔딩 · 설문처럼 놓치면 안 되는 것) */
  urgent?: boolean;
}

export interface BetaRun {
  id: string;
  index: number;
}

/** 저장소 · 시계 · 전송을 바꿔 끼울 수 있게(시험) */
export interface BetaEnv {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  session: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  now: () => number;
  fetch: typeof fetch | null;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export const PC_PATTERN = /^[A-Z0-9-]{4,16}$/;
const PHASE_PATTERN = /^[a-z0-9_]{1,32}$/;
const OBJECTIVE_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;

export const KEYS = {
  pc: "waegok.beta.pc",
  queue: "waegok.beta.q",
  run: "waegok.beta.run",
  runReset: "waegok.beta.runReset",
  tab: "waegok.beta.tab",
  seq: "waegok.beta.seq",
  dropped: "waegok.beta.dropped",
  account: "waegok.beta.account",
  /** 지금 계정 기록을 정한 물음 표(물은 시각) */
  accountAt: "waegok.beta.accountAt",
} as const;

/** 다른 계정 · 다른 코드의 기록을 그 사람이 돌아올 때까지 남겨 두는 기간 */
export const FOREIGN_KEEP_MS = 24 * 3600 * 1000;

/** 대기열 상한 — 넘으면 오래된 것부터 버리고 그 수를 다음 기록에 적는다 */
export const QUEUE_CAP = 300;
/** 한 번에 보내는 수(서버 상한 50) */
export const BATCH = 50;
/** 이만큼 쌓이면 바로 보낸다 */
const FLUSH_AT = 20;
/** 평소 보내는 간격 */
export const FLUSH_MS = 10_000;
/** data 직렬화 상한(서버 2048바이트) */
const DATA_LIMIT = 2000;
/** 본문 상한(서버 64KB · keepalive 는 브라우저가 대기 중인 것을 합쳐 64KB) */
const BODY_LIMIT = 60_000;
const KEEPALIVE_LIMIT = 48_000;
const MAX_BACKOFF_MS = 60_000;

/** 참여 코드를 대문자 · 공백 없이. 형식이 아니면 null */
export function normalizeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return PC_PATTERN.test(code) ? code : null;
}

export function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** UTF-8 바이트 수 — 서버 상한(data 2048바이트 · 본문 64KB)은 글자 수가 아니라 바이트다(한글 한 자 = 3바이트) */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** data 를 서버 상한 안으로 — 긴 글은 자르고, 그래도 크면 표시만 남긴다 */
export function clampData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    trimmed[key.slice(0, 40)] = typeof value === "string" && value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  try {
    if (byteLength(JSON.stringify(trimmed)) <= DATA_LIMIT) return trimmed;
  } catch {
    return { unserializable: true };
  }
  return { truncated: true, keys: Object.keys(trimmed).slice(0, 20) };
}

/** 본문 상한(서버 64KB) 안에서, 최대 limit 개까지 앞에서부터 묶는다 */
export function takeBatch(queue: BetaEvent[], limit: number, maxBytes = BODY_LIMIT): BetaEvent[] {
  const batch: BetaEvent[] = [];
  let bytes = byteLength('{"events":[]}');
  for (const event of queue) {
    if (batch.length >= limit) break;
    const size = byteLength(JSON.stringify(event)) + (batch.length ? 1 : 0);
    if (batch.length > 0 && bytes + size > maxBytes) break;
    batch.push(event);
    bytes += size;
  }
  return batch;
}

/** 저장소 읽기 — 막혀 있으면(사생활 모드 · 차단) null */
function getRaw(store: BetaEnv["storage"], key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function readJson<T>(store: BetaEnv["storage"], key: string, fallback: T): T {
  try {
    const raw = getRaw(store, key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** 저장소 쓰기 — 막혔으면(사생활 모드 · 용량) false */
function writeJson(store: BetaEnv["storage"], key: string, value: unknown): boolean {
  try {
    if (!store) return false;
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeRaw(store: BetaEnv["storage"], key: string) {
  try {
    store?.removeItem(key);
  } catch {
    /* 무시 */
  }
}

export interface BetaLogOptions {
  page: BetaPage;
  apiOrigin: string;
  build?: string;
  /** 주소 문자열(location.href) — `?pc=` 를 읽는다 */
  href?: string;
  env?: Partial<BetaEnv>;
  enabled?: boolean;
}

export function createBetaLog() {
  let env: BetaEnv | null = null;
  let page: BetaPage = "main";
  let apiOrigin = "";
  let build = "";
  let pc: string | null = null;
  let tabId = "";
  let seq = 0;
  let memoryQueue: BetaEvent[] = [];
  /** 저장소 쓰기가 실패했다 — 이 페이지에서는 메모리 대기열만 쓴다 */
  let isMemoryOnly = false;
  /** 이 페이지의 회차 — 한 번 정하면 페이지가 끝날 때까지 고정(다른 탭의 처음부터 다시가 바꾸지 않게) */
  let pageRun: BetaRun | null = null;
  let isStopped = false;
  let isSending = false;
  let backoffMs = 0;
  let nextAllowedAt = 0;
  let timer: unknown = null;
  let sentCount = 0;
  let failCount = 0;
  /** 거절된 묶음을 반으로 줄여 가며 문제 기록을 가린다 */
  let batchLimit = BATCH;
  /** 이 페이지의 계정 — undefined: 아직 모름 · null: 로그인 안 함 · 문자열: 계정 id */
  let account: string | null | undefined = undefined;
  /** 계정을 확인하기 전의 기록(페이지 안에만) */
  let pending: Array<{ event: BetaEvent; withRun: boolean }> = [];

  const store = () => env?.storage ?? null;

  function loadQueue(): BetaEvent[] {
    const stored = readJson<BetaEvent[]>(store(), KEYS.queue, []);
    return Array.isArray(stored) ? stored : [];
  }

  function saveQueue(queue: BetaEvent[]) {
    memoryQueue = queue;
    if (isMemoryOnly || !store()) return;
    if (!writeJson(store(), KEYS.queue, queue)) isMemoryOnly = true;
  }

  function currentQueue(): BetaEvent[] {
    // 다른 페이지 · 탭이 같은 저장소를 쓴다 — 저장소를 쓸 수 있으면 그쪽이 기준
    return isMemoryOnly || !store() ? memoryQueue : loadQueue();
  }

  function noteDropped(count: number) {
    if (count <= 0) return;
    const before = Number(getRaw(store(), KEYS.dropped) ?? 0) || 0;
    try {
      store()?.setItem(KEYS.dropped, String(before + count));
    } catch {
      /* 무시 */
    }
  }

  function readRun(): BetaRun | null {
    const run = readJson<BetaRun | null>(store(), KEYS.run, null);
    return run && typeof run.id === "string" && typeof run.index === "number" ? run : null;
  }

  function schedule(ms: number) {
    if (!env || isStopped) return;
    if (timer !== null) env.clearTimer(timer);
    timer = env.setTimer(() => {
      timer = null;
      void flush();
      schedule(FLUSH_MS);
    }, ms);
  }

  async function flush(): Promise<void> {
    if (!env || isStopped || isSending || !env.fetch) return;
    if (env.now() < nextAllowedAt) return;
    if (account === undefined) return;
    if (isParticipantChanged() || isAccountChanged()) return;
    const queue = pruneForeign();
    const mine = queue.filter(isMine);
    if (mine.length === 0) return;
    const batch = takeBatch(mine, batchLimit);
    const sentIds = new Set(batch.map((event) => event.event_id));
    isSending = true;
    try {
      const response = await env.fetch(`${apiOrigin}/api/v1/beta-events`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
      });
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as { disabled?: boolean } | null;
        saveQueue(currentQueue().filter((event) => !sentIds.has(event.event_id)));
        sentCount += batch.length;
        backoffMs = 0;
        batchLimit = BATCH;
        if (body?.disabled) stop();
        // 더 남았으면 이어서
        else if (currentQueue().some(isMine)) schedule(200);
      } else if (response.status === 400 || response.status === 413 || response.status === 422) {
        // 거절 — 묶음이면 반으로 줄여 다시(멀쩡한 기록을 함께 잃지 않게), 하나만 남았으면 그것만 버리고 센다
        failCount += 1;
        if (batch.length > 1) {
          batchLimit = Math.max(1, Math.floor(batch.length / 2));
          schedule(200);
        } else {
          saveQueue(currentQueue().filter((event) => !sentIds.has(event.event_id)));
          noteDropped(1);
          batchLimit = BATCH;
          if (currentQueue().some(isMine)) schedule(200);
        }
      } else {
        const retryAfter = Number(response.headers.get("Retry-After"));
        backoffMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(MAX_BACKOFF_MS, (backoffMs || 2000) * 2);
        nextAllowedAt = env.now() + backoffMs;
        failCount += 1;
      }
    } catch {
      backoffMs = Math.min(MAX_BACKOFF_MS, (backoffMs || 2000) * 2);
      nextAllowedAt = env.now() + backoffMs;
      failCount += 1;
    } finally {
      isSending = false;
    }
  }

  /** 페이지를 떠난다 — 남은 것을 keepalive 로 한 번 더(지우지는 않는다 — 다음 페이지가 같은 event_id 로 다시 보내면 서버가 거른다) */
  function flushOnLeave() {
    if (!env || isStopped || !env.fetch) return;
    if (account === undefined) return;
    if (isParticipantChanged() || isAccountChanged()) return;
    const queue = currentQueue().filter(isMine);
    if (queue.length === 0) return;
    // keepalive 본문은 브라우저가 64KB 로 묶는다 — 그 안에서
    const batch = takeBatch(queue, BATCH, KEEPALIVE_LIMIT);
    try {
      void env.fetch(`${apiOrigin}/api/v1/beta-events`, {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ events: batch }),
      }).catch(() => {});
    } catch {
      /* 무시 */
    }
  }

  /** 이 페이지(지금 계정 · 코드)의 기록인가 — 남의 것은 보내지 않는다(서버도 쿠키 계정과 다르면 버린다) */
  function isMine(event: BetaEvent): boolean {
    return (event.pc ?? null) === pc && (event.acct ?? "") === (account ?? "");
  }

  /** 남의 기록은 그 사람이 돌아올 때까지 하루만 둔다 */
  function pruneForeign(): BetaEvent[] {
    if (!env) return [];
    const now = env.now();
    const queue = currentQueue();
    const kept = queue.filter((event) => isMine(event) || now - Date.parse(event.client_ts) < FOREIGN_KEEP_MS);
    if (kept.length !== queue.length) {
      noteDropped(queue.length - kept.length);
      saveQueue(kept);
    }
    return kept;
  }

  /** 다른 탭에서 다른 계정을 확인했다(같은 브라우저 쿠키가 바뀌었다) — 이 페이지는 더 쌓지도 보내지도 않는다 */
  function isAccountChanged(): boolean {
    if (account === undefined || !store()) return false;
    const stored = getRaw(store(), KEYS.account);
    if (stored === null || stored === (account ?? "")) return false;
    stop();
    return true;
  }

  /** 계정 · 회차를 찍어 대기열에 넣는다 */
  function enqueue(event: BetaEvent, withRun: boolean) {
    event.acct = account ?? "";
    const run = withRun ? api.run() : null;
    if (run) {
      event.run_id = run.id;
      event.run_index = run.index;
    }
    let queue = currentQueue();
    queue.push(event);
    if (queue.length > QUEUE_CAP) {
      noteDropped(queue.length - QUEUE_CAP);
      queue = queue.slice(queue.length - QUEUE_CAP);
    }
    saveQueue(queue);
    return queue.length;
  }

  /** 다른 탭이 다른 참여 코드로 들어왔다 — 이 페이지(앞사람)는 더 쌓지도 보내지도 않는다 */
  function isParticipantChanged(): boolean {
    // 대기열 쓰기가 막혀 메모리 대기열로 가도 코드 읽기는 된다 — 늘 확인한다
    if (!store()) return false;
    const stored = normalizeCode(getRaw(store(), KEYS.pc));
    if (!stored || stored === pc) return false;
    stop();
    return true;
  }

  function stop() {
    isStopped = true;
    if (env && timer !== null) env.clearTimer(timer);
    timer = null;
  }

  function nextSeq(): number {
    seq += 1;
    try {
      env?.session?.setItem(KEYS.seq, String(seq));
    } catch {
      /* 무시 */
    }
    return seq;
  }

  const api = {
    init(options: BetaLogOptions): boolean {
      if (env) return api.isActive();
      env = {
        storage: options.env?.storage !== undefined ? options.env.storage : safeStorage("localStorage"),
        session: options.env?.session !== undefined ? options.env.session : safeStorage("sessionStorage"),
        now: options.env?.now ?? (() => Date.now()),
        fetch: options.env?.fetch !== undefined ? options.env.fetch : typeof fetch === "function" ? fetch.bind(globalThis) : null,
        setTimer: options.env?.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
        clearTimer: options.env?.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
      };
      page = options.page;
      apiOrigin = options.apiOrigin.replace(/\/$/, "");
      build = (options.build ?? "").slice(0, 40);
      if (options.enabled === false) {
        isStopped = true;
        return false;
      }
      // 주소의 코드가 먼저 — 다른 코드로 다시 들어오면 바꾼다(같은 기기를 다른 참가자가 쓰는 경우)
      let fromUrl: string | null = null;
      try {
        if (options.href) fromUrl = normalizeCode(new URL(options.href).searchParams.get("pc"));
      } catch {
        fromUrl = null;
      }
      const stored = normalizeCode(getRaw(store(), KEYS.pc));
      pc = fromUrl ?? stored;
      if (fromUrl && fromUrl !== stored) {
        try {
          store()?.setItem(KEYS.pc, fromUrl);
        } catch {
          /* 무시 */
        }
        if (stored) {
          // 참가자가 바뀌었다 — 앞사람의 회차를 잇지 않고, 못 보낸 앞사람 기록은 버린다(지금 쿠키 주인으로 붙지 않게)
          removeRaw(store(), KEYS.run);
          removeRaw(env.session, KEYS.runReset);
          const leftover = loadQueue().length;
          if (!writeJson(store(), KEYS.queue, [])) {
            // 지우지 못했다 — 이 페이지는 빈 메모리 대기열로(앞사람 기록을 다시 읽지 않게)
            isMemoryOnly = true;
          }
          noteDropped(leftover);
        }
      }
      tabId = getRaw(env.session, KEYS.tab) ?? "";
      if (!tabId) {
        tabId = uuid();
        try {
          env.session?.setItem(KEYS.tab, tabId);
        } catch {
          /* 무시 */
        }
      }
      seq = Number(getRaw(env.session, KEYS.seq) ?? 0) || 0;
      memoryQueue = isMemoryOnly ? [] : loadQueue();
      schedule(1500);
      return true;
    },
    isActive: () => !!env && !isStopped,
    /**
     * 이 페이지의 계정을 알았다(/me) — 로그인 안 했고 참여 코드도 없으면 그만 쌓는다.
     * 앞서 이 브라우저에서 본 계정과 다르면(공용 PC) 회차를 잇지 않는다. 잡아 둔 기록에 계정 · 회차를 찍어 넣고 보낸다.
     */
    setAccount(accountId: string | null, ticket?: string | null) {
      if (!env || isStopped || account !== undefined) return;
      const id = accountId || null;
      const before = getRaw(store(), KEYS.account);
      const appliedAt = getRaw(store(), KEYS.accountAt);
      // 더 나중에 물은 다른 탭이 이미 다른 계정을 정했다 — 이 답은 낡았다(쿠키가 이미 바뀌었다). 덮어쓰지 않고 이 페이지는 멈춘다.
      // 늦게 물은 쪽이 이긴다 — 답이 도착한 차례가 아니라 물은 차례로 가린다
      if (ticket != null && appliedAt !== null && appliedAt > ticket && before !== (id ?? "")) {
        pending = [];
        stop();
        return;
      }
      // 앞 계정과 다르거나, 주인을 모르는 회차(계정 기록이 없던 때 만든 것)면 잇지 않는다
      if (before !== (id ?? "")) {
        removeRaw(store(), KEYS.run);
        removeRaw(env.session, KEYS.runReset);
        pageRun = null;
      }
      try {
        store()?.setItem(KEYS.account, id ?? "");
        if (ticket != null && (appliedAt === null || ticket > appliedAt)) store()?.setItem(KEYS.accountAt, ticket);
      } catch {
        /* 무시 */
      }
      account = id;
      if (!id && !pc) {
        pending = [];
        stop();
        return;
      }
      const held = pending;
      pending = [];
      for (const { event, withRun } of held) enqueue(event, withRun);
      void flush();
    },
    /** 계정을 확인했나(undefined 면 아직) */
    account: () => account,
    /**
     * /me 를 묻기 직전에 받는 물음 표 — 「물은 시각(자릿수 고정) . 무작위 id」 글자. 글자 크기 비교가 곧 물은 차례다
     * (같은 브라우저의 탭은 같은 시계). 함께 쓰는 수를 읽고 올리지 않으므로 두 탭이 같은 표를 받을 일이 없다.
     */
    accountTicket(): string | null {
      if (!env || !store()) return null;
      return `${String(Math.max(0, Math.floor(env.now()))).padStart(15, "0")}.${uuid()}`;
    },
    participantCode: () => pc,
    page: () => page,
    tabId: () => tabId,
    /** 이 페이지의 나주 회차(처음 부를 때 저장소에서 읽거나 만든다 — 첫 회차 0) */
    run(): BetaRun | null {
      if (!api.isActive()) return null;
      if (pageRun) return pageRun;
      // 계정을 확인하기 전에는 정하지 않는다(공용 PC 에서 앞사람 회차를 잇지 않게)
      if (account === undefined) return null;
      pageRun = readRun();
      if (!pageRun) {
        pageRun = { id: uuid(), index: 0 };
        writeJson(store(), KEYS.run, pageRun);
      }
      return pageRun;
    },
    /** 「처음부터 다시」가 성공했다 — 이 탭에서 다음에 나주가 열릴 때 새 회차로(다른 탭에는 번지지 않게 탭 저장소에) */
    markRunReset() {
      try {
        env?.session?.setItem(KEYS.runReset, "1");
      } catch {
        /* 무시 */
      }
    },
    /** 나주가 열렸다 — 이 탭의 처음부터 다시 뒤면 새 회차. 새로 만들었으면 true */
    consumeRunReset(): boolean {
      if (!api.isActive() || !env) return false;
      if (getRaw(env.session, KEYS.runReset) !== "1") return false;
      removeRaw(env.session, KEYS.runReset);
      const before = pageRun ?? readRun();
      pageRun = { id: uuid(), index: before ? before.index + 1 : 0 };
      writeJson(store(), KEYS.run, pageRun);
      return true;
    },
    track(type: BetaEventType, phase?: string | null, fields: TrackFields = {}): void {
      try {
        if (!api.isActive() || !env) return;
        if (isParticipantChanged() || isAccountChanged()) return;
        const withRun = fields.withRun ?? page === "naju";
        const event: BetaEvent = {
          event_id: uuid(),
          type,
          client_ts: new Date(env.now()).toISOString(),
          pc: pc ?? undefined,
          tab_id: tabId,
          seq: nextSeq(),
          page,
        };
        if (phase && PHASE_PATTERN.test(phase)) event.phase = phase;
        if (fields.objective_id && OBJECTIVE_PATTERN.test(fields.objective_id)) event.objective_id = fields.objective_id;
        if (build) event.build = build;
        const data = clampData(fields.data);
        if (data && Object.keys(data).length > 0) event.data = data;
        if (account === undefined) {
          // 계정을 확인하기 전 — 페이지 안에 잡아 둔다(확인되면 계정 · 회차를 찍어 넣는다)
          if (pending.length < QUEUE_CAP) pending.push({ event, withRun });
          return;
        }
        const length = enqueue(event, withRun);
        if (fields.urgent || length >= FLUSH_AT) void flush();
      } catch {
        // 기록이 게임을 막으면 안 된다
      }
    },
    flush,
    flushOnLeave,
    /** 버린 기록 수(대기열 넘침 · 형식 오류)를 읽고 0 으로 */
    takeDropped(): number {
      const count = Number(getRaw(store(), KEYS.dropped) ?? 0) || 0;
      if (count > 0) {
        try {
          store()?.removeItem(KEYS.dropped);
        } catch {
          /* 무시 */
        }
      }
      return count;
    },
    stats: () => ({ queued: currentQueue().length, pending: pending.length, sent: sentCount, failures: failCount, stopped: isStopped }),
    stop,
  };
  return api;
}

function safeStorage(name: "localStorage" | "sessionStorage"): Storage | null {
  try {
    const store = (globalThis as Record<string, unknown>)[name] as Storage | undefined;
    if (!store) return null;
    const probe = "waegok.beta.probe";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

/** 화면 · 기기의 대략 — 브라우저 이름 · 운영체제 · 화면 크기(세부 식별 정보는 넣지 않는다) */
export function describeEnvironment(nav: Navigator | undefined = globalThis.navigator, win: Window | undefined = globalThis.window) {
  const ua = nav?.userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "edge"
    : /Whale\//.test(ua)
      ? "whale"
      : /SamsungBrowser\//.test(ua)
        ? "samsung"
        : /Firefox\//.test(ua)
          ? "firefox"
          : /Chrome\//.test(ua)
            ? "chrome"
            : /Safari\//.test(ua)
              ? "safari"
              : "other";
  const versionMatch = ua.match(/(?:Edg|Whale|SamsungBrowser|Firefox|Chrome|Version)\/(\d+)/);
  const os = /Windows/.test(ua)
    ? "windows"
    : /Android/.test(ua)
      ? "android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "ios"
        : /Mac OS X/.test(ua)
          ? (nav?.maxTouchPoints ?? 0) > 1
            ? "ipados"
            : "macos"
          : /Linux/.test(ua)
            ? "linux"
            : "other";
  return {
    browser,
    browser_major: versionMatch ? Number(versionMatch[1]) : null,
    os,
    screen_w: win?.screen?.width ?? null,
    screen_h: win?.screen?.height ?? null,
    view_w: win?.innerWidth ?? null,
    view_h: win?.innerHeight ?? null,
    dpr: win?.devicePixelRatio ?? null,
    touch: (nav?.maxTouchPoints ?? 0) > 0,
    cores: nav?.hardwareConcurrency ?? null,
    memory_gb: (nav as Navigator & { deviceMemory?: number })?.deviceMemory ?? null,
    lang: nav?.language ?? null,
  };
}

/** 한 페이지에 하나 */
export const betaLog = createBetaLog();
