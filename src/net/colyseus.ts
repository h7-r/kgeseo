// 본부실 로비 연결 — 로비 설계 v0.19 2·3·4절.
//   입장권 발급(FastAPI) → 매칭(joinOrCreate) → 이동·인사 주고받기 → 퇴장 → 구독 해제.
// 화면(본부실 연결은 3단계)은 enter()/exit() 만 부르고, 상태는 subscribe() 로 받는다.
//
// 규칙
// - 방문(visit)마다 번호, 연결 시도(attempt)마다 번호를 둔다. 늦게 온 응답은 번호가 지금과 다르면 버리고,
//   이미 방에 들어갔으면 바로 나간다(4절 「늦은 응답 처리」).
// - 입장부터 응답까지 3초(🟡)를 넘기면 일시적 실패로 본다.
// - 일시적 실패(네트워크·429·503·시간 초과·TICKET_USED·TICKET_STALE·TICKET_EXPIRED·비정상 끊김):
//   「혼자 둘러보는 중」, 첫 실패 기준 +30초·+60초에 다시 시도. Retry-After 가 안 끝난 시도는 건너뛴다.
//   시도마다 새 티켓을 받는다. 「최대 두 번」은 방문당 상한이다(🟡) — 붙었다 끊겼다를 되풀이해도 늘지 않는다.
// - 인증 거절(401·403·ORIGIN_NOT_ALLOWED·TICKET_INVALID·AUTH_MISSING)·방 상한(LOBBY_FULL)·
//   운영 중단(서버 정상 종료 4001 — systemctl stop 등): 이번 방문의 재시도를 끝낸다.
// - 티켓은 메모리에만 두고 매칭 HTTP 의 Authorization 헤더로만 보낸다. SDK 의 client.auth.token 은
//   티켓을 WebSocket 주소(_authToken)에 복사하므로 쓰지 않는다(로비 서버도 그런 연결을 거절한다).
// - SDK 의 자동 재접속은 끈다 — 같은 방 20초 복귀는 이번 베타 범위 밖이다(서버도 reconnect 경로를 닫았다).
import { Client } from "@colyseus/sdk";

export const LOBBY_ROOM_NAME = "lobby";
export const TICKET_PATH = "/api/v1/lobby/ticket";
/** 🟡 입장부터 응답까지 */
export const CONNECT_TIMEOUT_MS = 3000;
/** 첫 실패 기준 다시 시도하는 때(4절) */
export const RETRY_OFFSETS_MS = [30_000, 60_000] as const;
/** 위치 송신 상한 — 서버도 초당 10회까지만 받는다 */
export const MOVE_SEND_INTERVAL_MS = 100;

export type Gait = "idle" | "walk" | "run" | "crouch";

export interface LobbyPose {
  x: number;
  /** 카메라 높이가 아니라 발바닥 높이(PlayerMotionState.footY) */
  y: number;
  z: number;
  ry: number;
  gait: Gait;
}

/** 서버가 검사하는 외형(lobby/README.md 「외형」) */
export interface LobbyLook {
  catalog: string;
  gender: "masculine" | "feminine";
  hair: string;
  top: string;
  bottom: string;
  shoes: string;
  colors: Record<"skin" | "hair" | "cloth" | "bottom" | "shoes", string>;
  body: Record<string, number>;
}

/** 방 상태의 한 사람(서버 lobby/src/state.ts 의 Player) */
export interface RemotePlayerView {
  nickname: string;
  /** 검사한 외형 JSON. "" 이면 받는 쪽이 기본 외형으로 그린다 */
  look: string;
  placed: boolean;
  x: number;
  y: number;
  z: number;
  ry: number;
  gait: string;
}

export type LobbyFailure =
  | "LOGIN_REQUIRED" // 401 — 게스트
  | "NOT_ALLOWED" // 403 — 명단에 없음 또는 다른 출처
  | "RATE_LIMITED" // 429
  | "UNAVAILABLE" // 503 · 접속 실패 · 로비 주소 없음
  | "TIMEOUT"
  | "DISCONNECTED" // 비정상 끊김(1006 등) — 다시 시도
  | "LOBBY_STOPPED" // 로비 운영 중단(서버 정상 종료 4001) — 이번 방문 재시도 끝(4절 표)
  | "LOBBY_FULL"
  | "REJECTED" // 로비 인증 거절(되풀이해도 안 되는 것)
  | "RETRYABLE_REJECT"; // TICKET_USED 등 — 새 티켓으로 다시 시도

export type LobbyStatus =
  | { kind: "idle" }
  | { kind: "connecting"; visit: number; attempt: number }
  | { kind: "connected"; visit: number; sessionId: string }
  /** 「혼자 둘러보는 중」. nextRetryAt 이 있으면 그때 다시 시도한다 */
  | { kind: "solo"; visit: number; reason: LobbyFailure; nextRetryAt: number | null };

export interface GreetEvent {
  sid: string;
  id: number;
}

/** 때리기 방송 — 보낸 사람(sid)·주먹(jab·cross)·서버가 맞았다고 본 사람(hit, 없으면 헛손질) */
export interface PunchEvent {
  sid: string;
  motion: "jab" | "cross";
  hit?: string;
}

/** createLobbyConnection 이 쓰는 방의 최소 모양(시험에서 가짜로 바꿔 끼운다) */
export interface LobbyRoomLike {
  readonly sessionId: string;
  readonly state: unknown;
  reconnection: { enabled: boolean };
  send(type: string, message: unknown): void;
  leave(consented?: boolean): Promise<number>;
  /** 돌려준 함수로 이 구독만 끊는다 */
  onMessage(type: string, callback: (payload: never) => void): unknown;
  /** SDK 의 신호 — `remove` 로 이 구독만 끊는다(SDK 자신의 정리 구독은 남겨야 한다) */
  onLeave: ((callback: (code: number) => void) => unknown) & { remove?: (callback: (code: number) => void) => void };
}

/** 서버 정상 종료(@colyseus/shared-types CloseCode.SERVER_SHUTDOWN) — 운영 중단으로 본다 */
export const SERVER_SHUTDOWN_CODE = 4001;
/** 인사 번호 개수(1~3) — 로비 서버 GREET_IDS 와 같아야 한다 */
export const GREET_COUNT = 3;

export interface LobbyConnectionOptions {
  /** 로비 서버 주소(VITE_LOBBY_URL). 비어 있으면 늘 혼자 진행 */
  lobbyUrl: string;
  /** API 주소 만들기(@/config/env 의 apiUrl) */
  apiUrl: (path: string) => string;
  /** 입장 때 보낼 외형과 첫 자리 */
  getJoinOptions: () => { look: LobbyLook | null; pose: LobbyPose | null };
  fetch?: typeof fetch;
  /** 매칭 HTTP 헤더로만 티켓을 넣는 방 열기. 기본은 SDK Client */
  joinRoom?: (endpoint: string, headers: Record<string, string>, options: object) => Promise<LobbyRoomLike>;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const RETRYABLE_REASONS = new Set(["TICKET_USED", "TICKET_STALE", "TICKET_EXPIRED"]);
const PERMANENT_REASONS = new Set(["ORIGIN_NOT_ALLOWED", "TICKET_INVALID", "AUTH_MISSING"]);

class AttemptFailure extends Error {
  readonly reason: LobbyFailure;
  readonly retryAfterSec: number | null;

  constructor(reason: LobbyFailure, retryAfterSec: number | null = null) {
    super(reason);
    this.reason = reason;
    this.retryAfterSec = retryAfterSec;
  }
}

const RETRYABLE_FAILURES = new Set<LobbyFailure>([
  "RATE_LIMITED",
  "UNAVAILABLE",
  "TIMEOUT",
  "DISCONNECTED",
  "RETRYABLE_REJECT",
]);

function classifyJoinError(error: unknown): AttemptFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "LOBBY_FULL") return new AttemptFailure("LOBBY_FULL");
  if (RETRYABLE_REASONS.has(message)) return new AttemptFailure("RETRYABLE_REJECT");
  if (PERMANENT_REASONS.has(message)) return new AttemptFailure("REJECTED");
  return new AttemptFailure("UNAVAILABLE");
}

const sdkJoinRoom = async (endpoint: string, headers: Record<string, string>, options: object) =>
  (await new Client(endpoint, { headers }).joinOrCreate(LOBBY_ROOM_NAME, options)) as unknown as LobbyRoomLike;

export function createLobbyConnection(options: LobbyConnectionOptions) {
  const {
    lobbyUrl,
    apiUrl,
    getJoinOptions,
    fetch: fetchFn = (...args: Parameters<typeof fetch>) => fetch(...args),
    joinRoom = sdkJoinRoom,
    now = () => Date.now(),
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;

  let status: LobbyStatus = { kind: "idle" };
  let visit = 0;
  let attempt = 0;
  let room: LobbyRoomLike | null = null;
  let firstFailureAt: number | null = null;
  let retriesUsed = 0;
  let retryAfterUntil = 0;
  let retryTimer: unknown = null;
  let lastMoveSentAt = -Infinity;
  const statusListeners = new Set<(status: LobbyStatus) => void>();
  const greetListeners = new Set<(event: GreetEvent) => void>();
  const punchListeners = new Set<(event: PunchEvent) => void>();

  const setStatus = (next: LobbyStatus) => {
    status = next;
    statusListeners.forEach((listener) => listener(next));
  };

  const clearRetry = () => {
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = null;
  };

  /** 내가 붙인 구독만 끊는 함수(지금 방). SDK 가 스스로 붙인 정리 구독(onLeave → destroy)은 건드리지 않는다 */
  let unsubscribeRoom: (() => void) | null = null;

  /**
   * 방을 정리한다. 퇴장 응답은 기다리지 않는다(4절 「퇴장 응답을 기다리지 않고 출동」).
   * removeAllListeners 는 쓰지 않는다 — SDK 의 onLeave → destroy()(상태 해석기 정리)까지 지운다.
   */
  const dropRoom = (target: LobbyRoomLike | null) => {
    if (!target) return;
    void target.leave(true).catch(() => undefined);
  };

  async function requestTicket(): Promise<string> {
    let response: Response;
    try {
      response = await fetchFn(apiUrl(TICKET_PATH), {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new AttemptFailure("UNAVAILABLE");
    }
    if (response.status === 401) throw new AttemptFailure("LOGIN_REQUIRED");
    if (response.status === 403) throw new AttemptFailure("NOT_ALLOWED");
    if (response.status === 429) {
      const seconds = Number(response.headers.get("Retry-After"));
      throw new AttemptFailure("RATE_LIMITED", Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    }
    if (!response.ok) throw new AttemptFailure("UNAVAILABLE");
    const body = (await response.json().catch(() => null)) as { ticket?: unknown } | null;
    if (!body || typeof body.ticket !== "string" || !body.ticket) throw new AttemptFailure("UNAVAILABLE");
    return body.ticket;
  }

  async function connectOnce(myVisit: number, myAttempt: number) {
    const isCurrent = () => visit === myVisit && attempt === myAttempt;
    const ticket = await requestTicket();
    if (!isCurrent()) return;
    let joined: LobbyRoomLike;
    try {
      joined = await joinRoom(lobbyUrl, { Authorization: `Bearer ${ticket}` }, getJoinOptions());
    } catch (error) {
      throw classifyJoinError(error);
    }
    // 시간 초과·퇴장 뒤에 늦게 성공한 연결은 바로 닫고 화면에 붙이지 않는다
    if (!isCurrent()) {
      dropRoom(joined);
      return;
    }
    joined.reconnection.enabled = false;
    room = joined;
    // 이번 장애는 끝났다. 재시도 횟수(retriesUsed)는 방문 단위 상한이라 되돌리지 않는다 —
    // 붙었다 끊겼다를 되풀이해도 한 방문에서 두 번까지만 다시 시도한다(🟡 설계 4절 「최대 두 번」을 방문당으로 해석)
    firstFailureAt = null;
    const unbindGreet = joined.onMessage("greet", ((payload: GreetEvent) => {
      if (room === joined) greetListeners.forEach((listener) => listener(payload));
    }) as (payload: never) => void);
    const unbindPunch = joined.onMessage("punch", ((payload: PunchEvent) => {
      if (room === joined) punchListeners.forEach((listener) => listener(payload));
    }) as (payload: never) => void);
    const handleLeave = (code: number) => {
      // 우리가 정리한 방이면(room 이 이미 바뀜) 아무것도 안 한다
      if (room !== joined || visit !== myVisit) return;
      room = null;
      unsubscribeRoom = null;
      fail(myVisit, new AttemptFailure(code === SERVER_SHUTDOWN_CODE ? "LOBBY_STOPPED" : "DISCONNECTED"));
    };
    joined.onLeave(handleLeave);
    unsubscribeRoom = () => {
      if (typeof unbindGreet === "function") unbindGreet();
      if (typeof unbindPunch === "function") unbindPunch();
      joined.onLeave.remove?.(handleLeave);
    };
    setStatus({ kind: "connected", visit: myVisit, sessionId: joined.sessionId });
  }

  function fail(myVisit: number, failure: AttemptFailure) {
    if (visit !== myVisit) return;
    const at = now();
    firstFailureAt ??= at;
    if (failure.retryAfterSec !== null) retryAfterUntil = Math.max(retryAfterUntil, at + failure.retryAfterSec * 1000);
    if (!RETRYABLE_FAILURES.has(failure.reason)) {
      clearRetry();
      setStatus({ kind: "solo", visit: myVisit, reason: failure.reason, nextRetryAt: null });
      return;
    }
    scheduleRetry(myVisit, failure.reason);
  }

  /** 첫 실패 기준 +30초·+60초 중 아직 쓰지 않았고 Retry-After 뒤인 첫 때 */
  function scheduleRetry(myVisit: number, reason: LobbyFailure) {
    clearRetry();
    const base = firstFailureAt ?? now();
    let nextAt: number | null = null;
    while (retriesUsed < RETRY_OFFSETS_MS.length) {
      const candidate = base + RETRY_OFFSETS_MS[retriesUsed];
      if (candidate >= retryAfterUntil) {
        nextAt = candidate;
        break;
      }
      // Retry-After 가 끝나기 전인 시도는 건너뛴다
      retriesUsed += 1;
    }
    setStatus({ kind: "solo", visit: myVisit, reason, nextRetryAt: nextAt });
    if (nextAt === null) return;
    retryTimer = setTimer(
      () => {
        retryTimer = null;
        if (visit !== myVisit) return;
        retriesUsed += 1;
        startAttempt(myVisit);
      },
      Math.max(0, nextAt - now()),
    );
  }

  function startAttempt(myVisit: number) {
    attempt += 1;
    const myAttempt = attempt;
    setStatus({ kind: "connecting", visit: myVisit, attempt: myAttempt });
    const timeout = setTimer(() => {
      if (visit !== myVisit || attempt !== myAttempt) return;
      attempt += 1; // 이 시도의 늦은 응답을 버린다
      fail(myVisit, new AttemptFailure("TIMEOUT"));
    }, CONNECT_TIMEOUT_MS);
    connectOnce(myVisit, myAttempt)
      .catch((error: unknown) => {
        if (visit !== myVisit || attempt !== myAttempt) return;
        attempt += 1;
        fail(myVisit, error instanceof AttemptFailure ? error : new AttemptFailure("UNAVAILABLE"));
      })
      .finally(() => clearTimer(timeout));
  }

  const connection = {
    /** 본부실에 들어섰다(씬과 플레이어 좌표가 준비된 뒤). 이미 방문 중이면 아무것도 안 한다 */
    enter() {
      if (status.kind !== "idle") return;
      visit += 1;
      firstFailureAt = null;
      retriesUsed = 0;
      retryAfterUntil = 0;
      lastMoveSentAt = -Infinity;
      if (!lobbyUrl) {
        setStatus({ kind: "solo", visit, reason: "UNAVAILABLE", nextRetryAt: null });
        return;
      }
      startAttempt(visit);
    },
    /** 본부실을 떠났다(복도·기차·나주·페이지 이탈). 여러 번 불려도 한 번만 처리한다 */
    exit() {
      if (status.kind === "idle") return;
      visit += 1; // 진행 중인 요청·재시도의 응답을 모두 버린다
      attempt += 1;
      clearRetry();
      const leaving = room;
      room = null;
      unsubscribeRoom?.();
      unsubscribeRoom = null;
      dropRoom(leaving);
      setStatus({ kind: "idle" });
    },
    /** 위치 송신 — 연결돼 있을 때만, 초당 10회까지 */
    sendMove(pose: LobbyPose) {
      if (!room) return false;
      const at = now();
      if (at - lastMoveSentAt < MOVE_SEND_INTERVAL_MS) return false;
      lastMoveSentAt = at;
      room.send("move", pose);
      return true;
    },
    /** 인사 — 서버가 1~3 과 3초 쿨다운을 다시 검사한다 */
    sendGreet(id: number) {
      if (!room || !Number.isInteger(id) || id < 1 || id > GREET_COUNT) return false;
      room.send("greet", { id });
      return true;
    },
    /** 때리기 — 주먹이 닿는 순간에 한 번. 서버가 간격·거리·방향을 다시 검사해 맞음을 정한다 */
    sendPunch(motion: "jab" | "cross", target: string | null) {
      if (!room) return false;
      room.send("punch", target ? { motion, target } : { motion });
      return true;
    },
    /** 같은 방 사람들(나 포함). 연결 전이면 비어 있다 */
    players(): ReadonlyMap<string, RemotePlayerView> {
      const state = room?.state as { players?: ReadonlyMap<string, RemotePlayerView> } | undefined;
      return state?.players ?? new Map<string, RemotePlayerView>();
    },
    status: () => status,
    subscribe(listener: (status: LobbyStatus) => void) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    onGreet(listener: (event: GreetEvent) => void) {
      greetListeners.add(listener);
      return () => {
        greetListeners.delete(listener);
      };
    },
    onPunch(listener: (event: PunchEvent) => void) {
      punchListeners.add(listener);
      return () => {
        punchListeners.delete(listener);
      };
    },
    /** 화면이 사라질 때. 퇴장하고 구독을 모두 끊는다 */
    dispose() {
      connection.exit();
      statusListeners.clear();
      greetListeners.clear();
      punchListeners.clear();
    },
  };
  return connection;
}

export type LobbyConnection = ReturnType<typeof createLobbyConnection>;
