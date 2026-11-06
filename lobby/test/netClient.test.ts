// 2단계 — 브라우저 쪽 연결 모듈(src/net/colyseus.ts) 시험. 설계 v0.19 4절 규칙.
//   앞부분: 가짜 시계·가짜 발급·가짜 방으로 재시도·늦은 응답·퇴장 규칙을 하나씩.
//   뒷부분: 실제 로비 서버 + 실제 SDK 로 두 사람이 입장·이동·인사·퇴장, 로비를 끄면 혼자 진행.
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

class FakeRoom implements LobbyRoomLike {
  sessionId = "me";
  state = { players: new Map() };
  reconnection = { enabled: true };
  sent: [string, unknown][] = [];
  left = 0;
  #onLeave: ((code: number) => void) | null = null;
  send(type: string, message: unknown) {
    this.sent.push([type, message]);
  }
  leave() {
    this.left += 1;
    return Promise.resolve(1000);
  }
  onMessage() {}
  onLeave(callback: (code: number) => void) {
    this.#onLeave = callback;
  }
  drop() {
    this.#onLeave?.(1006);
  }
}

const ticketResponse = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 200 ? JSON.stringify({ ticket: "t" }) : "{}", { status, headers });

function setup(overrides: Partial<LobbyConnectionOptions> = {}) {
  const clock = new FakeClock();
  const calls = { fetch: 0, join: 0, headers: [] as Record<string, string>[] };
  const statuses: LobbyStatus[] = [];
  const connection = createLobbyConnection({
    lobbyUrl: "http://lobby.test",
    apiUrl: (path) => `http://api.test${path}`,
    getJoinOptions: () => ({ look: null, pose: null }),
    fetch: async () => {
      calls.fetch += 1;
      return ticketResponse(200);
    },
    joinRoom: async (_endpoint, headers) => {
      calls.join += 1;
      calls.headers.push(headers);
      return new FakeRoom();
    },
    now: () => clock.now,
    setTimer: clock.set,
    clearTimer: clock.clear,
    ...overrides,
  });
  connection.subscribe((status) => statuses.push(status));
  return { clock, calls, statuses, connection };
}

const last = (statuses: LobbyStatus[]) => statuses.at(-1);

describe("연결 규칙(가짜 시계)", () => {
  it("발급 200 → 입장. 티켓은 Authorization 헤더로만, SDK 자동 재접속은 끈다", async () => {
    let room: FakeRoom | null = null;
    const { connection, calls, statuses } = setup({
      joinRoom: async (_e, headers) => {
        calls.headers.push(headers);
        room = new FakeRoom();
        return room;
      },
    });
    connection.enter();
    await flush();
    assert.equal(last(statuses)?.kind, "connected");
    assert.deepEqual(calls.headers[0], { Authorization: "Bearer t" });
    assert.equal((room as FakeRoom | null)?.reconnection.enabled, false);
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

  it("503 → +30초·+60초에 두 번만 다시 시도, 시도마다 새 티켓", async () => {
    const { connection, calls, statuses, clock } = setup({
      fetch: async () => {
        calls.fetch += 1;
        return ticketResponse(503);
      },
    });
    const start = clock.now;
    connection.enter();
    await flush();
    assert.equal(last(statuses)?.kind, "solo");
    assert.equal((last(statuses) as { nextRetryAt: number }).nextRetryAt, start + 30_000);
    await clock.advance(30_000);
    assert.equal(calls.fetch, 2);
    await clock.advance(30_000);
    assert.equal(calls.fetch, 3);
    assert.deepEqual(last(statuses), { kind: "solo", visit: 1, reason: "UNAVAILABLE", nextRetryAt: null });
    await clock.advance(300_000);
    assert.equal(calls.fetch, 3);
  });

  it("429 Retry-After 45초 → +30초 시도는 건너뛰고 +60초에", async () => {
    const { connection, calls, statuses, clock } = setup({
      fetch: async () => {
        calls.fetch += 1;
        return ticketResponse(429, { "Retry-After": "45" });
      },
    });
    const start = clock.now;
    connection.enter();
    await flush();
    assert.equal((last(statuses) as { nextRetryAt: number }).nextRetryAt, start + 60_000);
    await clock.advance(59_000);
    assert.equal(calls.fetch, 1);
    await clock.advance(1_000);
    assert.equal(calls.fetch, 2);
  });

  for (const [message, retries] of [
    ["TICKET_USED", true],
    ["TICKET_STALE", true],
    ["LOBBY_FULL", false],
    ["ORIGIN_NOT_ALLOWED", false],
    ["TICKET_INVALID", false],
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
    assert.deepEqual(
      { kind: last(statuses)?.kind, reason: (last(statuses) as { reason?: string }).reason },
      { kind: "solo", reason: "TIMEOUT" },
    );
    (resolveJoin as unknown as (room: FakeRoom) => void)(lateRoom);
    await flush();
    assert.equal(lateRoom.left, 1);
    assert.equal(last(statuses)?.kind, "solo");
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

  it("같은 방문 중 다시 enter 는 무시, exit 는 여러 번 불려도 한 번만 나간다", async () => {
    const rooms: FakeRoom[] = [];
    const { connection, calls } = setup({
      joinRoom: async () => {
        calls.join += 1;
        const room = new FakeRoom();
        rooms.push(room);
        return room;
      },
    });
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

  it("연결 중 끊기면(비정상) 혼자 진행으로 바꾸고 +30초에 새 티켓으로 다시", async () => {
    const rooms: FakeRoom[] = [];
    const { connection, calls, statuses, clock } = setup({
      joinRoom: async () => {
        calls.join += 1;
        const room = new FakeRoom();
        rooms.push(room);
        return room;
      },
    });
    connection.enter();
    await flush();
    rooms[0]?.drop();
    assert.equal((last(statuses) as { reason?: string }).reason, "DISCONNECTED");
    await clock.advance(30_000);
    assert.equal(calls.join, 2);
    assert.equal(last(statuses)?.kind, "connected");
  });

  it("로비 주소가 비어 있으면 요청 없이 바로 혼자 진행", async () => {
    const { connection, calls, statuses } = setup({ lobbyUrl: "" });
    connection.enter();
    await flush();
    assert.equal(calls.fetch, 0);
    assert.equal(last(statuses)?.kind, "solo");
  });

  it("위치는 연결돼 있을 때만, 100ms 에 한 번까지", async () => {
    const room = new FakeRoom();
    const { connection, clock } = setup({ joinRoom: async () => room });
    const pose = { x: 0, y: 0, z: 0, ry: 0, gait: "idle" as const };
    assert.equal(connection.sendMove(pose), false);
    connection.enter();
    await flush();
    assert.equal(connection.sendMove(pose), true);
    assert.equal(connection.sendMove(pose), false);
    clock.now += 100;
    assert.equal(connection.sendMove(pose), true);
    assert.equal(room.sent.filter(([type]) => type === "move").length, 2);
    assert.equal(connection.sendGreet(7), false);
    assert.equal(connection.sendGreet(2), true);
  });
});

describe("실제 로비 서버 + 실제 SDK", () => {
  it("두 사람이 입장·이동·인사·퇴장하고, 로비를 끄면 혼자 진행으로 바뀐다", async () => {
    const result = buildConfig("test", {
      LOBBY_TICKET_SECRET: new TextDecoder().decode(TEST_SECRET),
      LOBBY_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    });
    assert.ok("config" in result);
    const lobby = createLobbyServer(result.config, {
      log: silentLogger,
      processStartSec: Math.floor(Date.now() / 1000) - 10,
    });
    await lobby.listen("127.0.0.1", 0);
    const http = (lobby.server as unknown as { transport: { server: { address(): AddressInfo } } }).transport.server;
    const lobbyUrl = `http://127.0.0.1:${http.address().port}`;

    let user = 0;
    const make = (pose: { x: number; z: number }) => {
      user += 1;
      const sub = `net-${user}`;
      return createLobbyConnection({
        lobbyUrl,
        apiUrl: (path) => path,
        getJoinOptions: () => ({ look: validLook() as never, pose: { ...pose, y: 0, ry: 0, gait: "idle" } }),
        // 브라우저에서는 FastAPI 가 준다 — 여기서는 같은 키로 서명한 티켓을 돌려준다
        fetch: async () => new Response(JSON.stringify({ ticket: await makeTicket({ sub, nickname: `넷${user}` }) })),
        // 브라우저는 Origin 을 스스로 붙인다 — Node 에서는 헤더로 넣는다
        joinRoom: async (endpoint, headers, options) =>
          (await new Client(endpoint, { headers: { ...headers, Origin: ALLOWED_ORIGIN } }).joinOrCreate(
            "lobby",
            options,
          )) as unknown as LobbyRoomLike,
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

      // 플레이 중 로비를 끈다 → 남은 사람은 혼자 진행, 재시도 예정
      await lobby.shutdown();
      await waitFor(() => b.status().kind === "solo", 8000);
      const solo = b.status() as { reason: string; nextRetryAt: number | null };
      assert.equal(solo.reason, "DISCONNECTED");
      assert.ok(solo.nextRetryAt !== null);
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});
