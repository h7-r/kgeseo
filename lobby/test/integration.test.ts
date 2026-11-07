// 실제 로비 서버 + 실제 SDK(@colyseus/sdk 0.18.9) — 설계 3·3.1·5절과 7.1 판정표 중 로컬에서 재현할 수 있는 것.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { Client, type Room } from "@colyseus/sdk";
import WebSocket from "ws";

import { CLOSE_REPLACED, pidFor } from "../src/accounts.js";
import { buildConfig } from "../src/config.js";
import type { LogFields } from "../src/log.js";
import { createLobbyServer, type LobbyServer } from "../src/server.js";
import { ALLOWED_ORIGIN, makeTicket, TEST_SECRET, validLook } from "./helpers.js";

const START = Math.floor(Date.now() / 1000) - 10;
let lobby: LobbyServer;
let base: string;
const logs: { event: string; fields: LogFields }[] = [];

before(async () => {
  const result = buildConfig("test", {
    LOBBY_TICKET_SECRET: new TextDecoder().decode(TEST_SECRET),
    LOBBY_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    LOBBY_MAX_ROOMS: "2",
    LOBBY_TEST_HOOKS: "1",
  });
  assert.ok("config" in result);
  lobby = createLobbyServer(result.config, {
    log: (event, fields = {}) => logs.push({ event, fields }),
    processStartSec: START,
  });
  await lobby.listen("127.0.0.1", 0);
  const http = (lobby.server as unknown as { transport: { server: { address(): AddressInfo } } }).transport.server;
  base = `http://127.0.0.1:${http.address().port}`;
});

after(async () => {
  await lobby.shutdown();
});

let userSeq = 0;
async function ticket(overrides: Parameters<typeof makeTicket>[0] = {}) {
  userSeq += 1;
  return makeTicket({ sub: `u${userSeq}`, nickname: `조사관${userSeq}`, ...overrides });
}

/** 티켓은 매칭 HTTP 의 Authorization 헤더로만 보낸다. client.auth.token 은 WebSocket 주소에 티켓을 복사한다 */
function client(origin = ALLOWED_ORIGIN, token?: string) {
  const headers: Record<string, string> = { Origin: origin };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Client(base, { headers });
}

async function join(options: Record<string, unknown> = {}) {
  const token = await ticket();
  const room = await client(ALLOWED_ORIGIN, token).joinOrCreate("lobby", { look: validLook(), ...options });
  return { room, token };
}

async function matchmake(method: string, token: string | null, origin: string | null, body: unknown = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  return fetch(`${base}/matchmake/${method}/lobby`, { method: "POST", headers, body: JSON.stringify(body) });
}

const waitFor = async (check: () => boolean, ms = 3000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("기다린 조건이 오지 않았다");
    await sleep(20);
  }
};

type PlayerView = Record<string, unknown>;
/** 첫 상태 패치가 오기 전에는 비어 있다 */
const playersOf = (room: Room) =>
  (room.state as { players?: Map<string, PlayerView> } | undefined)?.players ?? new Map<string, PlayerView>();

const errorMessage = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as Error).message;
  }
};

async function leaveAll(rooms: Room[]) {
  await Promise.all(rooms.map((room) => room.leave(true).catch(() => undefined)));
  await waitFor(() => lobby.roomCap.used === 0, 8000);
}

describe("입장·이동·인사·퇴장", () => {
  it("두 사람이 서로의 닉네임·외형·위치를 보고 인사를 받는다", async () => {
    const a = await join({ pose: { x: -5, y: 0, z: 0, ry: 0, gait: "idle" } });
    const b = await join();
    await waitFor(() => playersOf(b.room).size === 2);

    const players = () => playersOf(b.room);
    const seenA = players().get(a.room.sessionId);
    assert.ok(seenA);
    assert.match(String(seenA.nickname), /^조사관/);
    assert.equal(JSON.parse(String(seenA.look)).gender, "feminine");
    assert.equal(seenA.placed, true);
    // 계정 ID·티켓 ID 는 상태에 없다
    assert.deepEqual(Object.keys(seenA).sort(), ["gait", "look", "nickname", "pid", "placed", "ry", "x", "y", "z"]);

    a.room.send("move", { x: -4.5, y: 0, z: 0.2, ry: 1, gait: "walk" });
    await waitFor(() => Math.abs(Number(players().get(a.room.sessionId)?.x) - -4.5) < 1e-3);

    const greeted = new Promise<{ sid: string; id: number }>((resolve) => b.room.onMessage("greet", resolve));
    a.room.send("greet", { id: 3 });
    assert.deepEqual(await greeted, { sid: a.room.sessionId, id: 3 });

    await a.room.leave(true);
    await waitFor(() => !players().has(a.room.sessionId));
    await leaveAll([b.room]);
  });

  it("때리기: 서버가 아는 자리로 맞음을 정하고, 보낸 사람은 연결에서 정한다", async () => {
    // a 는 +x 를 본다(ry = π/2), b 는 a 앞 1.5 유닛, c 는 멀리
    const a = await join({ pose: { x: -5, y: 0, z: 0, ry: Math.PI / 2, gait: "idle" } });
    const b = await join({ pose: { x: -3.5, y: 0, z: 0, ry: 0, gait: "idle" } });
    const c = await join({ pose: { x: 8, y: 0, z: 0, ry: 0, gait: "idle" } });
    await waitFor(() => playersOf(b.room).size === 3);
    const received: Record<string, unknown>[] = [];
    b.room.onMessage("punch", (message: Record<string, unknown>) => received.push(message));

    // 맞음 — 남의 이름(sid)을 넣어도 서버는 보낸 연결로 정한다
    a.room.send("punch", { motion: "jab", target: b.room.sessionId, sid: c.room.sessionId });
    await waitFor(() => received.length === 1);
    assert.deepEqual(received[0], { sid: a.room.sessionId, motion: "jab", hit: b.room.sessionId });

    // 멀리 있는 사람·자기 자신·없는 사람은 맞지 않는다(주먹만 보인다)
    for (const target of [c.room.sessionId, a.room.sessionId, "nobody"]) {
      await sleep(350);
      a.room.send("punch", { motion: "cross", target });
      await waitFor(() => received.length >= 1 && received.at(-1)?.motion === "cross" && received.length > 1);
      assert.deepEqual(received.at(-1), { sid: a.room.sessionId, motion: "cross" });
      received.length = 1;
    }

    // 한꺼번에 연타하면 한 번만 방송한다
    await sleep(700);
    for (let i = 0; i < 5; i += 1) a.room.send("punch", { motion: "jab" });
    await sleep(250);
    assert.equal(received.length, 2, `연타 방송 ${received.length - 1}번`);

    await leaveAll([a.room, b.room, c.room]);
  });

  it("틀린 외형은 비워서 받는다(받는 쪽이 기본 착장)", async () => {
    const a = await join({ look: { ...validLook(), hair: "hair.m.crop" } });
    await waitFor(() => playersOf(a.room).has(a.room.sessionId));
    assert.equal(playersOf(a.room).get(a.room.sessionId)?.look, "");
    await leaveAll([a.room]);
  });
});

describe("채팅(설계 v0.21 5절 · 검토 14회차)", () => {
  it("다듬은 글을 이름·가명 ID 와 함께 방 전체에 보내고, 거절은 보낸 사람에게만 알린다", async () => {
    const a = await join();
    const b = await join();
    await waitFor(() => playersOf(b.room).size === 2);
    const atB: Record<string, unknown>[] = [];
    const atA: Record<string, unknown>[] = [];
    const rejectedAtA: Record<string, unknown>[] = [];
    const rejectedAtB: Record<string, unknown>[] = [];
    b.room.onMessage("chat", (m: Record<string, unknown>) => atB.push(m));
    a.room.onMessage("chat", (m: Record<string, unknown>) => atA.push(m));
    a.room.onMessage("chatRejected", (m: Record<string, unknown>) => rejectedAtA.push(m));
    b.room.onMessage("chatRejected", (m: Record<string, unknown>) => rejectedAtB.push(m));

    a.room.send("chat", { text: "  같이\n풀어요  ", sid: b.room.sessionId });
    await waitFor(() => atB.length === 1 && atA.length === 1);
    const seenA = playersOf(b.room).get(a.room.sessionId);
    assert.deepEqual(atB[0], {
      sid: a.room.sessionId,
      pid: seenA?.pid,
      nickname: seenA?.nickname,
      text: "같이 풀어요",
    });
    assert.match(String(seenA?.pid), /^[A-Za-z0-9_-]{12}$/);

    a.room.send("chat", { text: "ㅅㅂ" });
    await waitFor(() => rejectedAtA.length === 1);
    assert.deepEqual(rejectedAtA[0], { reason: "word" });
    await sleep(200);
    assert.equal(atB.length, 1, "거절된 말은 방송하지 않는다");
    assert.equal(rejectedAtB.length, 0, "거절은 보낸 사람에게만");

    // 로그에 원문이 없다(허용·거절 모두)
    const text = JSON.stringify(logs);
    assert.ok(!text.includes("같이") && !text.includes("ㅅㅂ"));
    await leaveAll([a.room, b.room]);
  });

  it("가명 ID 는 같은 계정이면 다시 들어와도 같고, 계정 ID 는 상태에 없다", async () => {
    const first = await client(ALLOWED_ORIGIN, await makeTicket({ sub: "pid-account", nickname: "가명" })).joinOrCreate(
      "lobby",
      { look: validLook() },
    );
    await waitFor(() => playersOf(first).has(first.sessionId));
    const pid = playersOf(first).get(first.sessionId)?.pid;
    assert.equal(pid, pidFor(TEST_SECRET, "pid-account"));
    assert.ok(!JSON.stringify([...playersOf(first).values()]).includes("pid-account"));
    await leaveAll([first]);
  });
});

describe("같은 계정 두 번 접속 — 나중 접속이 이긴다", () => {
  it("먼저 붙은 연결은 4100 으로 끊기고 새 연결은 남는다", async () => {
    const older = await client(ALLOWED_ORIGIN, await makeTicket({ sub: "twice", nickname: "두번" })).joinOrCreate("lobby", {
      look: validLook(),
    });
    const closed = new Promise<number>((resolve) => older.onLeave((code: number) => resolve(code)));
    const newer = await client(ALLOWED_ORIGIN, await makeTicket({ sub: "twice", nickname: "두번" })).joinOrCreate("lobby", {
      look: validLook(),
    });
    assert.equal(await closed, CLOSE_REPLACED);
    await waitFor(() => playersOf(newer).has(newer.sessionId) && !playersOf(newer).has(older.sessionId));
    assert.equal(lobby.online.size, 1);
    await leaveAll([newer]);
    assert.equal(lobby.online.size, 0);
  });
});

describe("같은 계정 — 방이 다 찼어도 다시 들어오면 자기 자리를 넘겨받는다(Codex 리뷰)", () => {
  it("모든 자리가 찬 상태에서 같은 계정의 새 접속이 옛 연결을 끊고 들어간다", async () => {
    // 이 시험 서버는 방 2개(20자리)
    const others = [];
    for (let i = 0; i < 19; i += 1) others.push((await join()).room);
    const mine = await client(ALLOWED_ORIGIN, await makeTicket({ sub: "full-house", nickname: "만석" })).joinOrCreate(
      "lobby",
      { look: validLook() },
    );
    assert.equal(lobby.roomCap.used, 2);
    // 다른 계정은 더 못 들어온다
    assert.equal(await errorMessage(join()), "LOBBY_FULL");
    const closed = new Promise<number>((resolve) => mine.onLeave((code: number) => resolve(code)));
    const again = await client(ALLOWED_ORIGIN, await makeTicket({ sub: "full-house", nickname: "만석" })).joinOrCreate(
      "lobby",
      { look: validLook() },
    );
    assert.equal(await closed, CLOSE_REPLACED);
    assert.ok(again.sessionId);
    assert.equal(lobby.roomCap.used, 2);
    await leaveAll([...others, again]);
  });
});

describe("입장권 1회 사용", () => {
  it("같은 티켓으로 새 HTTP 요청을 보내면 TICKET_USED", async () => {
    const token = await ticket();
    const first = await client(ALLOWED_ORIGIN, token).joinOrCreate("lobby", { look: validLook() });
    assert.equal(await errorMessage(client(ALLOWED_ORIGIN, token).joinOrCreate("lobby", {})), "TICKET_USED");
    await leaveAll([first]);
  });
  it("WebSocket 을 연결하지 않아도 같은 티켓의 동시 요청 중 한 좌석만 예약된다", async () => {
    const token = await ticket();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => matchmake("joinOrCreate", token, ALLOWED_ORIGIN)),
    );
    const bodies = await Promise.all(responses.map((r) => r.json() as Promise<Record<string, unknown>>));
    assert.equal(responses.filter((r) => r.ok).length, 1);
    assert.equal(bodies.filter((b) => b.error === "TICKET_USED").length, 4);
    // 연결하지 않은 좌석은 5초 뒤 풀리고 빈 방이 정리된다
    await waitFor(() => lobby.roomCap.used === 0, 9000);
  });
});

describe("출처·경로·CORS(3.1절)", () => {
  it("허용하지 않은 출처는 유효 티켓이어도 거절, 방·예약·usedJti 가 늘지 않는다", async () => {
    const before = lobby.usedJti.size;
    const token = await ticket();
    for (const origin of ["https://evil.example.com", null]) {
      const response = await matchmake("joinOrCreate", token, origin);
      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(body.error, "ORIGIN_NOT_ALLOWED");
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    }
    assert.equal(lobby.usedJti.size, before);
    assert.equal(lobby.roomCap.used, 0);
  });
  it("열지 않은 매칭 경로(create·join·joinById·reconnect)는 거절", async () => {
    for (const method of ["create", "join", "joinById", "reconnect"]) {
      const response = await matchmake(method, await ticket(), ALLOWED_ORIGIN);
      assert.equal(response.ok, false, method);
      assert.match(String(((await response.json()) as Record<string, unknown>).error), /invalid method/);
    }
    assert.equal(lobby.roomCap.used, 0);
  });
  it("사전 요청: 허용한 출처는 정확한 주소·자격 증명·Max-Age 600, 아니면 허용 헤더가 없다", async () => {
    const preflight = (origin: string) =>
      fetch(`${base}/matchmake/joinOrCreate/lobby`, {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      });
    const ok = await preflight(ALLOWED_ORIGIN);
    assert.equal(ok.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
    assert.equal(ok.headers.get("access-control-allow-credentials"), "true");
    assert.equal(ok.headers.get("access-control-max-age"), "600");
    assert.match(String(ok.headers.get("access-control-allow-headers")), /Authorization/);
    const denied = await preflight("https://evil.example.com");
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
    assert.equal(denied.headers.get("access-control-allow-credentials"), null);
  });
  it("허용하지 않은 출처의 WebSocket 은 핸드셰이크에서 403", async () => {
    const response = await matchmake("joinOrCreate", await ticket(), ALLOWED_ORIGIN, { look: validLook() });
    const seat = (await response.json()) as { roomId: string; sessionId: string; processId: string };
    const url = `${base.replace("http", "ws")}/${seat.processId}/${seat.roomId}?sessionId=${seat.sessionId}`;
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(url, { headers: { origin: "https://evil.example.com" } });
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("open", () => resolve(101));
    });
    assert.equal(status, 403);
    await waitFor(() => lobby.roomCap.used === 0, 9000);
  });
});

describe("티켓은 URL 에 넣지 않는다(설계 3절)", () => {
  it("헤더로 보낸 입장은 WebSocket 주소에 _authToken 이 없다", async () => {
    const before = logs.length;
    const { room } = await join();
    assert.ok(!logs.slice(before).some((l) => l.event === "ws_rejected"));
    await leaveAll([room]);
  });
  it("SDK 의 client.auth.token 을 쓰면(주소에 티켓) 연결을 400 으로 거절한다", async () => {
    const misuse = new Client(base, { headers: { Origin: ALLOWED_ORIGIN } });
    misuse.auth.token = await ticket();
    assert.notEqual(await errorMessage(misuse.joinOrCreate("lobby", { look: validLook() })), "ok");
    assert.ok(logs.some((l) => l.event === "ws_rejected" && l.fields.reason === "TOKEN_IN_URL"));
    await waitFor(() => lobby.roomCap.used === 0, 9000);
  });
});

describe("운영 로그", () => {
  it("매칭 인증 거절은 유형만 남기고 티켓·계정 ID 는 남기지 않는다", async () => {
    const token = await ticket({ sub: "secret-account-id" });
    const first = await client(ALLOWED_ORIGIN, token).joinOrCreate("lobby", { look: validLook() });
    await errorMessage(client(ALLOWED_ORIGIN, token).joinOrCreate("lobby", {}));
    const rejected = logs.filter((l) => l.event === "auth_rejected");
    assert.ok(rejected.some((l) => l.fields.reason === "TICKET_USED"));
    const text = JSON.stringify(logs);
    assert.ok(!text.includes(token) && !text.includes("secret-account-id"));
    await leaveAll([first]);
  });
});

describe("입장 때 만료 재확인(7.1 「만료 직전 예약」)", () => {
  it("예약은 살아 있어도 티켓이 만료되면 들어가지 못하고 좌석이 풀린다", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const token = await makeTicket({ sub: "late", nickname: "늦음", iat, exp: iat + 2 });
    const response = await matchmake("joinOrCreate", token, ALLOWED_ORIGIN, { look: validLook() });
    assert.equal(response.ok, true);
    const reservation = await response.json();
    await sleep((iat + 2) * 1000 - Date.now() + 300);
    const message = await errorMessage(client().consumeSeatReservation(reservation as never));
    assert.match(message, /TICKET_EXPIRED/);
    // 새 유효 티켓으로는 들어간다
    const fresh = await join();
    await waitFor(() => playersOf(fresh.room).size === 1);
    await leaveAll([fresh.room]);
  });
});

describe("마지막 자리 동시 입장(7.1, 시험 장치)", () => {
  it("한 요청은 마지막 자리, 다른 요청은 같은 요청 안의 재인증으로 새 방 — TICKET_USED 없음", async () => {
    const nine: Room[] = [];
    for (let i = 0; i < 9; i += 1) nine.push((await join()).room);
    const hooks = lobby.hooks;
    assert.ok(hooks);
    const traceStart = hooks.trace.entries.length;
    hooks.driver.arm();
    const [x, y] = await Promise.all([join(), join()]);
    assert.equal(hooks.driver.lastRace, "paired");
    assert.notEqual(x.room.roomId, y.room.roomId, "둘이 서로 다른 방에 있어야 한다");
    const trace = hooks.trace.entries.slice(traceStart);
    const reused = trace.filter((e) => e.event === "auth_reused");
    assert.ok(reused.length >= 1, "같은 요청의 재인증 기록이 있어야 한다");
    assert.ok(trace.every((e) => !e.event.includes("TICKET_USED")));
    // 재인증한 요청 번호는 첫 인증도 같은 번호다
    const request = reused[0]?.request;
    assert.ok(trace.some((e) => e.request === request && e.event === "auth_first"));
    await leaveAll([...nine, x.room, y.room]);
  });
});

describe("방 초기화 실패(시험 장치)", () => {
  it("자리를 확보한 뒤 초기화가 실패해도 카운터는 한 번만 복구된다", async () => {
    const hooks = lobby.hooks;
    assert.ok(hooks);
    hooks.failNextRoomInit = true;
    assert.notEqual(await errorMessage(join()), "ok");
    assert.equal(lobby.roomCap.used, 0);
    // onDispose 가 뒤늦게 불려도 음수로 가지 않는다
    await sleep(6000);
    assert.equal(lobby.roomCap.used, 0);
    const ok = await join();
    assert.equal(lobby.roomCap.used, 1);
    await leaveAll([ok.room]);
  });
});
