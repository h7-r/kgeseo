// 2단계 — 브라우저 쪽 연결 모듈(src/net/colyseus.ts) 시험. 설계 v0.19 4절 규칙.
//   앞부분: 가짜 시계·가짜 발급·가짜 방으로 재시도·늦은 응답·퇴장 규칙을 하나씩.
//   뒷부분: 실제 로비 서버 + 실제 SDK 로 두 사람이 입장·이동·인사·퇴장, SDK 정리, 로비 운영 중단.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { Client } from "@colyseus/sdk";

import {
  CONNECT_TIMEOUT_MS,
  createLobbyConnection,
  type LobbyConnectionOptions,
  type LobbyRoomLike,
  type LobbyStatus,
  REMOVED_CODE,
  REPLACED_CODE,
  SERVER_SHUTDOWN_CODE,
} from "../../src/net/colyseus.ts";
import { buildConfig } from "../src/config.js";
import { silentLogger } from "../src/log.js";
import { createLobbyServer } from "../src/server.js";
import { ALLOWED_ORIGIN, makeTicket, TEST_SECRET, validLook } from "./helpers.js";

// --- 가짜 시계 ---
class FakeClock {
  now = 1_000_000;
  #timers = new Map<number, { at: number; run: () => void }>();
  #next = 1;
  set = (run: () => void, ms: number) => {
    const id = this.#next++;
    this.#timers.set(id, { at: this.now + ms, run });
    return id;
  };
  clear = (handle: unknown) => {
    this.#timers.delete(handle as number);
  };
  async advance(ms: number) {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.#timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.#timers.delete(due[0]);
      this.now = due[1].at;
      due[1].run();
      await flush();
    }
    this.now = until;
    await flush();
  }
}
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

/** SDK 방 흉내. onLeave 는 SDK 처럼 신호(함수 + remove)이고, SDK 자신의 정리 구독을 하나 미리 붙여 둔다 */
class FakeRoom implements LobbyRoomLike {
  sessionId = "me";
  state = { players: new Map() };
  reconnection = { enabled: true };
  sent: [string, unknown][] = [];
  left = 0;
  sdkCleanup = 0;
  readonly #leaveListeners = new Set<(code: number) => void>();
  readonly onLeave: LobbyRoomLike["onLeave"];

  constructor() {
    const signal = ((callback: (code: number) => void) => {
      this.#leaveListeners.add(callback);
    }) as LobbyRoomLike["onLeave"];
    signal.remove = (callback) => this.#leaveListeners.delete(callback);
    this.onLeave = signal;
    this.onLeave(() => {
      this.sdkCleanup += 1;
    });
  }
  send(type: string, message: unknown) {
    this.sent.push([type, message]);
  }
  leave() {
    this.left += 1;
    this.close(4000);
    return Promise.resolve(4000);
  }
  readonly handlers = new Map<string, (payload: never) => void>();
  onMessage(type: string, callback: (payload: never) => void) {
    this.handlers.set(type, callback);
    return () => {
      if (this.handlers.get(type) === callback) this.handlers.delete(type);
    };
  }
  /** 서버가 이 방에 메시지를 보낸 것처럼 */
  emit(type: string, payload: unknown) {
    this.handlers.get(type)?.(payload as never);
  }
  close(code: number) {
    [...this.#leaveListeners].forEach((listener) => listener(code));
  }
}

const ticketResponse = (status: number, ticket = "t", headers: Record<string, string> = {}) =>
  new Response(status === 200 ? JSON.stringify({ ticket }) : "{}", { status, headers });

function setup(overrides: Partial<LobbyConnectionOptions> = {}) {
  const clock = new FakeClock();
  const calls = { fetch: 0, join: 0, tickets: [] as string[] };
  const statuses: LobbyStatus[] = [];
  const rooms: FakeRoom[] = [];
  const connection = createLobbyConnection({
    lobbyUrl: "http://lobby.test",
    apiUrl: (path) => `http://api.test${path}`,
    getJoinOptions: () => ({ look: null, pose: null }),
    fetch: async () => {
      calls.fetch += 1;
      return ticketResponse(200, `ticket-${calls.fetch}`);
    },
    joinRoom: async (_endpoint, headers) => {
      calls.join += 1;
      calls.tickets.push(headers.Authorization ?? "");
      const room = new FakeRoom();
      rooms.push(room);
      return room;
    },
    now: () => clock.now,
    setTimer: clock.set,
    clearTimer: clock.clear,
    ...overrides,
  });
  connection.subscribe((status) => statuses.push(status));
  return { clock, calls, statuses, rooms, connection };
}

const last = (statuses: LobbyStatus[]) => statuses.at(-1);
const reasonOf = (status: LobbyStatus | undefined) => (status as { reason?: string } | undefined)?.reason;
const nextRetryOf = (status: LobbyStatus | undefined) => (status as { nextRetryAt?: number | null }).nextRetryAt;

describe("연결 규칙(가짜 시계)", () => {
  it("발급 200 → 입장. 티켓은 Authorization 헤더로만, SDK 자동 재접속은 끈다", async () => {
    const { connection, calls, statuses, rooms } = setup();
    connection.enter();
    await flush();
    assert.equal(last(statuses)?.kind, "connected");
    assert.deepEqual(calls.tickets, ["Bearer ticket-1"]);
    assert.equal(rooms[0]?.reconnection.enabled, false);
  });

  for (const [status, reason] of [
    [401, "LOGIN_REQUIRED"],
    [403, "NOT_ALLOWED"],
  ] as const) {
    it(`발급 ${status} → 혼자 진행, 이번 방문은 다시 요청하지 않는다`, async () => {
      const { connection, calls, statuses, clock } = setup({
        fetch: async () => {
          calls.fetch += 1;
          return ticketResponse(status);
        },
      });
      connection.enter();
      await flush();
      assert.deepEqual(last(statuses), { kind: "solo", visit: 1, reason, nextRetryAt: null });
      await clock.advance(120_000);
      assert.equal(calls.fetch, 1);
    });
  }

  it("503 → +30초·+60초에 두 번만 다시 시도, 매번 새 티켓을 매칭에 넘긴다", async () => {
    let served = 0;
    const { connection, calls, statuses, clock } = setup({
      fetch: async () => {
        served += 1;
        // 처음 두 번은 503, 세 번째는 발급 성공 → 서로 다른 티켓이 매칭에 가는지 본다
        return served < 3 ? ticketResponse(503) : ticketResponse(200, `ticket-${served}`);
      },
    });
    const start = clock.now;
    connection.enter();
    await flush();
    assert.equal(nextRetryOf(last(statuses)), start + 30_000);
    await clock.advance(30_000);
    assert.equal(served, 2);
    await clock.advance(30_000);
    assert.equal(served, 3);
    assert.equal(last(statuses)?.kind, "connected");
    assert.deepEqual(calls.tickets, ["Bearer ticket-3"]);
  });

  it("503 이 계속되면 두 번 뒤 재시도 끝", async () => {
    const { connection, calls, statuses, clock } = setup({
      fetch: async () => {
        calls.fetch += 1;
        return ticketResponse(503);
      },
    });
    connection.enter();
    await flush();
    await clock.advance(60_000);
    assert.equal(calls.fetch, 3);
    assert.deepEqual(last(statuses), { kind: "solo", visit: 1, reason: "UNAVAILABLE", nextRetryAt: null });
    await clock.advance(300_000);
    assert.equal(calls.fetch, 3);
  });

  it("재시도할 때마다 서로 다른 티켓으로 매칭한다", async () => {
    const { connection, calls, clock } = setup({
      joinRoom: async (_e, headers) => {
        calls.join += 1;
        calls.tickets.push(headers.Authorization ?? "");
        throw new Error("TICKET_USED");
      },
    });
    connection.enter();
    await flush();
    await clock.advance(60_000);
    assert.deepEqual(calls.tickets, ["Bearer ticket-1", "Bearer ticket-2", "Bearer ticket-3"]);
  });

  it("429 Retry-After 45초 → +30초 시도는 건너뛰고 +60초에", async () => {
    const { connection, calls, statuses, clock } = setup({
      fetch: async () => {
        calls.fetch += 1;
        return ticketResponse(429, "", { "Retry-After": "45" });
      },
    });
    const start = clock.now;
    connection.enter();
    await flush();
    assert.equal(nextRetryOf(last(statuses)), start + 60_000);
    await clock.advance(59_000);
    assert.equal(calls.fetch, 1);
    await clock.advance(1_000);
    assert.equal(calls.fetch, 2);
  });

  it("429 Retry-After 가 60초를 넘으면 이번 방문 재시도는 없다", async () => {
    const { connection, calls, statuses, clock } = setup({
      fetch: async () => {
        calls.fetch += 1;
        return ticketResponse(429, "", { "Retry-After": "90" });
      },
    });
    connection.enter();
    await flush();
    assert.equal(nextRetryOf(last(statuses)), null);
    await clock.advance(300_000);
    assert.equal(calls.fetch, 1);
  });

  for (const [message, retries] of [
    ["TICKET_USED", true],
    ["TICKET_STALE", true],
    ["TICKET_EXPIRED", true],
    ["LOBBY_FULL", false],
    ["ORIGIN_NOT_ALLOWED", false],
    ["TICKET_INVALID", false],
    ["AUTH_MISSING", false],
  ] as const) {
    it(`로비 거절 ${message} → ${retries ? "새 티켓으로 다시 시도" : "이번 방문 끝"}`, async () => {
      const { connection, calls, clock } = setup({
        joinRoom: async () => {
          calls.join += 1;
          throw new Error(message);
        },
      });
      connection.enter();
      await flush();
      await clock.advance(30_000);
      assert.equal(calls.join, retries ? 2 : 1);
    });
  }

  it("3초 안에 응답이 없으면 시간 초과, 늦게 온 성공 연결은 바로 닫는다", async () => {
    let resolveJoin: ((room: FakeRoom) => void) | null = null;
    const lateRoom = new FakeRoom();
    const { connection, statuses, clock } = setup({
      joinRoom: () => new Promise((resolve) => (resolveJoin = resolve)),
    });
    connection.enter();
    await flush();
    await clock.advance(CONNECT_TIMEOUT_MS);
    assert.equal(reasonOf(last(statuses)), "TIMEOUT");
    (resolveJoin as unknown as (room: FakeRoom) => void)(lateRoom);
    await flush();
    assert.equal(lateRoom.left, 1);
    assert.equal(last(statuses)?.kind, "solo");
  });

  it("퇴장 뒤 늦게 온 티켓 응답으로는 매칭하지 않는다", async () => {
    let resolveFetch: ((response: Response) => void) | null = null;
    const { connection, calls } = setup({
      fetch: () => new Promise((resolve) => (resolveFetch = resolve)),
    });
    connection.enter();
    await flush();
    connection.exit();
    (resolveFetch as unknown as (response: Response) => void)(ticketResponse(200));
    await flush();
    assert.equal(calls.join, 0);
  });

  it("퇴장 뒤 늦게 성공한 입장은 바로 닫고 붙이지 않는다", async () => {
    let resolveJoin: ((room: FakeRoom) => void) | null = null;
    const lateRoom = new FakeRoom();
    const { connection, statuses } = setup({
      joinRoom: () => new Promise((resolve) => (resolveJoin = resolve)),
    });
    connection.enter();
    await flush();
    connection.exit();
    (resolveJoin as unknown as (room: FakeRoom) => void)(lateRoom);
    await flush();
    assert.equal(lateRoom.left, 1);
    assert.deepEqual(last(statuses), { kind: "idle" });
    assert.equal(connection.players().size, 0);
  });

  it("다시 들어온 뒤에는 이전 방문의 늦은 응답을 무시한다", async () => {
    const pending: ((room: FakeRoom) => void)[] = [];
    const lateRoom = new FakeRoom();
    const { connection, statuses } = setup({
      joinRoom: () => new Promise((resolve) => pending.push(resolve)),
    });
    connection.enter();
    await flush();
    connection.exit();
    connection.enter();
    await flush();
    pending[0]?.(lateRoom); // 이전 방문의 응답
    await flush();
    assert.equal(lateRoom.left, 1);
    assert.equal(last(statuses)?.kind, "connecting");
    pending[1]?.(new FakeRoom()); // 이번 방문의 응답
    await flush();
    assert.equal(last(statuses)?.kind, "connected");
  });

  it("재시도가 예약된 뒤 나가면 더 요청하지 않는다", async () => {
    const { connection, calls, clock } = setup({
      fetch: async () => {
        calls.fetch += 1;
        return ticketResponse(503);
      },
    });
    connection.enter();
    await flush();
    connection.exit();
    await clock.advance(120_000);
    assert.equal(calls.fetch, 1);
  });

  it("같은 방문 중 다시 enter 는 무시, exit 는 여러 번 불려도 한 번만 나간다", async () => {
    const { connection, calls, rooms } = setup();
    connection.enter();
    connection.enter();
    await flush();
    connection.enter();
    assert.equal(calls.join, 1);
    connection.exit();
    connection.exit();
    await flush();
    assert.equal(rooms[0]?.left, 1);
  });

  it("퇴장해도 SDK 자신의 정리 구독은 남아 실행된다(removeAllListeners 안 씀)", async () => {
    const { connection, rooms } = setup();
    connection.enter();
    await flush();
    connection.exit();
    await flush();
    assert.equal(rooms[0]?.sdkCleanup, 1);
  });

  it("비정상 끊김(1006) → 혼자 진행, +30초에 새 티켓으로 다시", async () => {
    const { connection, calls, statuses, clock, rooms } = setup();
    connection.enter();
    await flush();
    rooms[0]?.close(1006);
    assert.equal(reasonOf(last(statuses)), "DISCONNECTED");
    await clock.advance(30_000);
    assert.equal(calls.join, 2);
    assert.equal(last(statuses)?.kind, "connected");
  });

  it("로비 운영 중단(4001) → 혼자 진행, 이번 방문 재시도 없음", async () => {
    const { connection, calls, statuses, clock, rooms } = setup();
    connection.enter();
    await flush();
    rooms[0]?.close(SERVER_SHUTDOWN_CODE);
    assert.deepEqual(last(statuses), { kind: "solo", visit: 1, reason: "LOBBY_STOPPED", nextRetryAt: null });
    await clock.advance(300_000);
    assert.equal(calls.join, 1);
  });

  for (const [code, reason] of [
    [REPLACED_CODE, "REPLACED"],
    [REMOVED_CODE, "REMOVED"],
  ] as const) {
    it(`${code}(${reason}) → 혼자 진행, 이번 방문 재시도 없음(다시 붙으면 서로 밀어내거나 또 끊긴다)`, async () => {
      const { connection, calls, statuses, clock, rooms } = setup();
      connection.enter();
      await flush();
      rooms[0]?.close(code);
      assert.deepEqual(last(statuses), { kind: "solo", visit: 1, reason, nextRetryAt: null });
      await clock.advance(300_000);
      assert.equal(calls.join, 1);
    });
  }

  it("채팅 — 다듬은 1~40자만 보내고, 방송·거절을 구독자에게 넘기며, 퇴장하면 끊는다", async () => {
    const { connection, rooms } = setup();
    assert.equal(connection.sendChat("안녕"), false, "연결 전에는 안 보낸다");
    connection.enter();
    await flush();
    const room = rooms[0];
    assert.ok(room);
    assert.equal(connection.sendChat("  같이\t가요  "), true);
    assert.deepEqual(room.sent.at(-1), ["chat", { text: "같이 가요" }]);
    assert.equal(connection.sendChat("   "), false);
    assert.equal(connection.sendChat("가".repeat(41)), false);
    assert.equal(connection.sendChat("😀".repeat(40)), true, "이모지는 코드포인트로 센다");

    const chats: unknown[] = [];
    const rejected: unknown[] = [];
    connection.onChat((event) => chats.push(event));
    connection.onChatRejected((reason) => rejected.push(reason));
    room.emit("chat", { sid: "x", pid: "p", nickname: "가", text: "하이" });
    room.emit("chatRejected", { reason: "word" });
    assert.deepEqual(chats, [{ sid: "x", pid: "p", nickname: "가", text: "하이" }]);
    assert.deepEqual(rejected, ["word"]);

    connection.exit();
    room.emit("chat", { sid: "x", pid: "p", nickname: "가", text: "늦은 말" });
    assert.equal(chats.length, 1, "나간 방의 메시지는 넘기지 않는다");
  });

  it("붙었다 끊겼다를 되풀이해도 한 방문에서 두 번까지만 다시 시도한다", async () => {
    const { connection, calls, clock, rooms } = setup();
    connection.enter();
    await flush();
    for (let i = 0; i < 4; i += 1) {
      rooms.at(-1)?.close(1006);
      await clock.advance(60_000);
    }
    assert.equal(calls.join, 3);
    // 다시 들어오면 새 방문 — 횟수가 처음으로 돌아간다
    connection.exit();
    connection.enter();
    await flush();
    assert.equal(calls.join, 4);
  });

  it("다시 들어오면 새 방문·새 티켓", async () => {
    const { connection, calls, statuses } = setup();
    connection.enter();
    await flush();
    connection.exit();
    connection.enter();
    await flush();
    assert.equal(calls.fetch, 2);
    assert.deepEqual(last(statuses), { kind: "connected", visit: 3, sessionId: "me" });
  });

  it("로비 주소가 비어 있으면 요청 없이 바로 혼자 진행", async () => {
    const { connection, calls, statuses } = setup({ lobbyUrl: "" });
    connection.enter();
    await flush();
    assert.equal(calls.fetch, 0);
    assert.equal(last(statuses)?.kind, "solo");
  });

  it("위치는 연결돼 있을 때만, 100ms 에 한 번까지", async () => {
    const { connection, clock, rooms } = setup();
    const pose = { x: 0, y: 0, z: 0, ry: 0, gait: "idle" as const };
    assert.equal(connection.sendMove(pose), false);
    connection.enter();
    await flush();
    assert.equal(connection.sendMove(pose), true);
    assert.equal(connection.sendMove(pose), false);
    clock.now += 100;
    assert.equal(connection.sendMove(pose), true);
    assert.equal(rooms[0]?.sent.filter(([type]) => type === "move").length, 2);
    assert.equal(connection.sendGreet(7), false);
    assert.equal(connection.sendGreet(2), true);
  });
});

describe("실제 로비 서버 + 실제 SDK", () => {
  it("두 사람이 입장·이동·인사·퇴장(SDK 정리 실행), 로비 운영 중단이면 재시도 없이 혼자 진행", async () => {
    const result = buildConfig("test", {
      LOBBY_TICKET_SECRET: new TextDecoder().decode(TEST_SECRET),
      LOBBY_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    });
    assert.ok("config" in result);
    const lobby = createLobbyServer(result.config, {
      log: silentLogger,
      processStartSec: Math.floor(Date.now() / 1000) - 10,
      teamNpcs: false,
    });
    await lobby.listen("127.0.0.1", 0);
    const http = (lobby.server as unknown as { transport: { server: { address(): AddressInfo } } }).transport.server;
    const lobbyUrl = `http://127.0.0.1:${http.address().port}`;

    let user = 0;
    const sdkRooms: { teardowns: number; room: { serializer?: { teardown?: () => void } } }[] = [];
    const make = (pose: { x: number; z: number }) => {
      user += 1;
      const sub = `net-${user}`;
      return createLobbyConnection({
        lobbyUrl,
        apiUrl: (path) => path,
        getJoinOptions: () => ({ look: validLook() as never, pose: { ...pose, y: 0, ry: 0, gait: "idle" } }),
        // 브라우저에서는 FastAPI 가 준다 — 여기서는 같은 키로 서명한 티켓을 돌려준다
        fetch: async () => new Response(JSON.stringify({ ticket: await makeTicket({ sub, nickname: `넷${user}` }) })),
        // 브라우저는 Origin 을 스스로 붙인다 — Node 에서는 헤더로 넣는다. SDK 정리(serializer.teardown)를 센다
        joinRoom: async (endpoint, headers, options) => {
          const room = await new Client(endpoint, { headers: { ...headers, Origin: ALLOWED_ORIGIN } }).joinOrCreate(
            "lobby",
            options,
          );
          const entry = { teardowns: 0, room: room as unknown as { serializer?: { teardown?: () => void } } };
          const serializer = entry.room.serializer;
          const original = serializer?.teardown?.bind(serializer);
          if (serializer)
            serializer.teardown = () => {
              entry.teardowns += 1;
              original?.();
            };
          sdkRooms.push(entry);
          return room as unknown as LobbyRoomLike;
        },
      });
    };
    const a = make({ x: -5, z: 0 });
    const b = make({ x: 5, z: 0 });
    const waitFor = async (check: () => boolean, ms = 4000) => {
      const until = Date.now() + ms;
      while (!check()) {
        if (Date.now() > until) throw new Error("기다린 조건이 오지 않았다");
        await sleep(20);
      }
    };
    try {
      a.enter();
      b.enter();
      await waitFor(() => a.status().kind === "connected" && b.status().kind === "connected");
      await waitFor(() => a.players().size === 2 && b.players().size === 2);
      const aId = (a.status() as { sessionId: string }).sessionId;
      assert.equal(b.players().get(aId)?.nickname.startsWith("넷"), true);

      a.sendMove({ x: -4.6, y: 0, z: 0.1, ry: 0.5, gait: "walk" });
      await waitFor(() => Math.abs((b.players().get(aId)?.x ?? 0) - -4.6) < 1e-3);

      const greeted = new Promise((resolve) => b.onGreet(resolve));
      a.sendGreet(2);
      assert.deepEqual(await greeted, { sid: aId, id: 2 });

      a.exit();
      await waitFor(() => !b.players().has(aId));
      assert.deepEqual(a.status(), { kind: "idle" });
      // a 의 방을 세션 ID 로 찾는다 — 둘이 동시에 들어가 sdkRooms 순서는 정해지지 않는다(전에는 [0] 이라 가끔 b 를 봤다)
      const aRoom = sdkRooms.find((entry) => (entry.room as { sessionId?: string }).sessionId === aId);
      assert.ok(aRoom);
      await waitFor(() => aRoom.teardowns > 0);

      // 운영 중단(서버 정상 종료) → 남은 사람은 혼자 진행, 이번 방문 재시도 없음
      await lobby.shutdown();
      await waitFor(() => b.status().kind === "solo", 8000);
      assert.deepEqual(b.status(), { kind: "solo", visit: 1, reason: "LOBBY_STOPPED", nextRetryAt: null });
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});
