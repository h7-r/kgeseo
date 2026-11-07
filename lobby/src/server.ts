// 검사한 설정으로 로비 서버를 조립한다. index.ts(실행)와 시험이 같이 쓴다.
import { type Client, matchMaker, Server, ServerError } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

import { enforceBetaList, OnlineAccounts } from "./accounts.js";
import { createAuthenticator } from "./authenticate.js";
import { ChatGuard } from "./chat.js";
import type { LobbyConfig } from "./config.js";
import { createLobbyRoom, ROOM_NAME } from "./LobbyRoom.js";
import type { Logger } from "./log.js";
import { configureMatchmaking, createUpgradeCheck } from "./matchmaking.js";
import { RoomCap } from "./roomCap.js";
import { createTestHooks, type TestHooks } from "./testHooks.js";
import { createTicketVerifier } from "./ticket.js";
import { UsedJtiRegistry } from "./usedJti.js";

const SWEEP_INTERVAL_MS = 30_000;
/** 베타 명단을 다시 읽는 간격 — 명단에서 뺀 계정은 이 안에 끊긴다 */
export const BETA_LIST_INTERVAL_MS = 30_000;
/** 같은 계정의 옛 연결이 나가 자리가 빌 때까지 매칭을 기다리는 최대 시간 */
export const EVICT_WAIT_MS = 2000;

export interface LobbyServer {
  server: Server;
  roomCap: RoomCap;
  usedJti: UsedJtiRegistry;
  processStartSec: number;
  hooks: TestHooks | null;
  online: OnlineAccounts;
  /** 베타 명단을 지금 다시 읽어 빠진 계정을 끊는다(주기 작업과 같은 일 — 시험용) */
  enforceBetaList(): Promise<void>;
  listen(host: string, port: number): Promise<void>;
  shutdown(): Promise<void>;
}

export interface CreateLobbyServerOptions {
  log: Logger;
  /** 이 프로세스가 시작한 Unix 초(정수). 시험에서 바꾼다 */
  processStartSec?: number;
  now?: () => number;
  /** 방마다 팀 캐릭터 다섯 명을 둔다(기본 켬, 검토 22회차). 방 인원을 세는 시험은 끈다 */
  teamNpcs?: boolean;
}

export function createLobbyServer(config: LobbyConfig, options: CreateLobbyServerOptions): LobbyServer {
  const { log, now = () => Date.now() / 1000 } = options;
  const processStartSec = options.processStartSec ?? Math.floor(now());
  const hooks = config.testHooks ? createTestHooks() : null;

  configureMatchmaking(config.allowedOrigins);

  const usedJti = new UsedJtiRegistry(now);
  const roomCap = new RoomCap(config.maxRooms);
  const verifyTicket = createTicketVerifier({ secret: config.ticketSecret, processStartSec, now });
  const authenticate = createAuthenticator({
    allowedOrigins: config.allowedOrigins,
    verifyTicket,
    usedJti,
    now,
    onAuthCall: hooks ? (context, event) => hooks.trace.record(context, `auth_${event}`) : undefined,
  });
  // 매칭 인증 거절은 운영에서도 유형만 남긴다(설계 1절 기록 규칙 — 티켓·계정 ID 는 넣지 않는다).
  // 시험 장치가 켜졌으면 요청 번호와 함께 시험 기록에도 남긴다.
  const chatGuard = new ChatGuard();
  const online = new OnlineAccounts<Client>();
  const tracedAuthenticate: typeof authenticate = (token, opts, context) =>
    authenticate(token, opts, context)
      .catch((error: unknown) => {
        const reason = error instanceof ServerError ? error.message : "error";
        log("auth_rejected", { reason });
        if (hooks && context) hooks.trace.record(context, `rejected_${reason}`);
        throw error;
      })
      .then(async (ticket) => {
        // 같은 계정이 이미 붙어 있으면 매칭 전에 옛 연결을 끊고 자리가 빌 때까지 기다린다 — 방이 다 찼어도 자기 자리를
        // 넘겨받게(검토 14회차 Codex 리뷰). 같은 요청 안의 재인증(좌석 재시도)에서는 이미 끊었으므로 바로 지나간다
        if (await online.evict(ticket.sub, EVICT_WAIT_MS)) log("auth_evicted_previous", {});
        return ticket;
      });

  const LobbyRoom = createLobbyRoom({
    chatGuard,
    online,
    pidSecret: config.ticketSecret,
    authenticate: tracedAuthenticate,
    roomCap,
    log,
    now,
    teamNpcs: options.teamNpcs ?? true,
    failAfterAcquire: hooks
      ? () => {
          const fail = hooks.failNextRoomInit;
          hooks.failNextRoomInit = false;
          return fail;
        }
      : undefined,
  });

  const transport = new WebSocketTransport({
    beforeUpgrade: createUpgradeCheck(config.allowedOrigins, (reason) => log("ws_rejected", { reason })),
  });
  const server = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
    ...(hooks ? { driver: hooks.driver } : {}),
  });
  // 들어갈 수 있는 방 중 가장 많이 찬 방부터 채운다(5절)
  server.define(ROOM_NAME, LobbyRoom).sortBy({ clients: -1 });

  const sweepTimer = setInterval(() => usedJti.sweep(), SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  // 명단 제재 — 읽기·형식 실패는 끊지 않고 상태가 바뀔 때만 한 줄 남긴다(30초마다 같은 오류를 찍지 않게)
  let lastBetaError: string | null = null;
  const runBetaList = async () => {
    if (!config.betaListPath) return;
    const result = await enforceBetaList(config.betaListPath, online);
    if ("error" in result) {
      if (lastBetaError !== result.error) log("beta_list_check_failed", { reason: result.error });
      lastBetaError = result.error;
      return;
    }
    lastBetaError = null;
    if (result.removed > 0) log("beta_list_removed", { connections: result.removed });
  };
  const betaTimer = config.betaListPath ? setInterval(() => void runBetaList(), BETA_LIST_INTERVAL_MS) : null;
  betaTimer?.unref();

  return {
    server,
    roomCap,
    usedJti,
    processStartSec,
    hooks,
    online,
    enforceBetaList: runBetaList,
    async listen(host, port) {
      await server.listen(port, host);
      log("listening", {
        port,
        profile: config.profile,
        maxRooms: config.maxRooms,
        testHooks: config.testHooks,
        betaListWatch: config.betaListPath !== null,
      });
    },
    async shutdown() {
      clearInterval(sweepTimer);
      if (betaTimer) clearInterval(betaTimer);
      await server.gracefullyShutdown(false);
      // 시험이 같은 프로세스에서 서버를 다시 띄울 수 있게 매칭 상태를 비운다
      matchMaker.removeRoomType(ROOM_NAME);
    },
  };
}
