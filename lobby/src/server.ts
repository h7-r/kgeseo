// 검사한 설정으로 로비 서버를 조립한다. index.ts(실행)와 시험이 같이 쓴다.
import { matchMaker, Server, ServerError } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

import { createAuthenticator } from "./authenticate.js";
import type { LobbyConfig } from "./config.js";
import { createLobbyRoom, ROOM_NAME } from "./LobbyRoom.js";
import type { Logger } from "./log.js";
import { configureMatchmaking, createUpgradeOriginCheck } from "./matchmaking.js";
import { RoomCap } from "./roomCap.js";
import { createTestHooks, type TestHooks } from "./testHooks.js";
import { createTicketVerifier } from "./ticket.js";
import { UsedJtiRegistry } from "./usedJti.js";

const SWEEP_INTERVAL_MS = 30_000;

export interface LobbyServer {
  server: Server;
  roomCap: RoomCap;
  usedJti: UsedJtiRegistry;
  processStartSec: number;
  hooks: TestHooks | null;
  listen(host: string, port: number): Promise<void>;
  shutdown(): Promise<void>;
}

export interface CreateLobbyServerOptions {
  log: Logger;
  /** 이 프로세스가 시작한 Unix 초(정수). 시험에서 바꾼다 */
  processStartSec?: number;
  now?: () => number;
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
  // 시험 장치가 켜졌을 때만 거절 사유를 요청 번호와 함께 남긴다
  const tracedAuthenticate: typeof authenticate = hooks
    ? (token, opts, context) =>
        authenticate(token, opts, context).catch((error: unknown) => {
          if (context) hooks.trace.record(context, `rejected_${error instanceof ServerError ? error.message : "error"}`);
          throw error;
        })
    : authenticate;

  const LobbyRoom = createLobbyRoom({
    authenticate: tracedAuthenticate,
    roomCap,
    log,
    now,
    failAfterAcquire: hooks
      ? () => {
          const fail = hooks.failNextRoomInit;
          hooks.failNextRoomInit = false;
          return fail;
        }
      : undefined,
  });

  const transport = new WebSocketTransport({ beforeUpgrade: createUpgradeOriginCheck(config.allowedOrigins) });
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

  return {
    server,
    roomCap,
    usedJti,
    processStartSec,
    hooks,
    async listen(host, port) {
      await server.listen(port, host);
      log("listening", { port, profile: config.profile, maxRooms: config.maxRooms, testHooks: config.testHooks });
    },
    async shutdown() {
      clearInterval(sweepTimer);
      await server.gracefullyShutdown(false);
      // 시험이 같은 프로세스에서 서버를 다시 띄울 수 있게 매칭 상태를 비운다
      matchMaker.removeRoomType(ROOM_NAME);
    },
  };
}
