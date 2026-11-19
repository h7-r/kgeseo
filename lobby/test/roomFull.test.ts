// 정원·방 상한(7.1 「정원·격리·상한」 중 로컬 재현분) — LOBBY_MAX_ROOMS=1 시험 서버
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { Client, type Room } from "@colyseus/sdk";

import { buildConfig } from "../src/config.js";
import { TEAM_SLOTS } from "../src/npc/teamRoster.js";
import { silentLogger } from "../src/log.js";
import { createLobbyServer, type LobbyServer } from "../src/server.js";
import { ALLOWED_ORIGIN, makeTicket, TEST_SECRET, validLook } from "./helpers.js";

let lobby: LobbyServer;
let base: string;

before(async () => {
  const result = buildConfig("test", {
    LOBBY_TICKET_SECRET: new TextDecoder().decode(TEST_SECRET),
    LOBBY_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    LOBBY_MAX_ROOMS: "1",
  });
  assert.ok("config" in result);
  lobby = createLobbyServer(result.config, { log: silentLogger, processStartSec: Math.floor(Date.now() / 1000) - 10 });
  await lobby.listen("127.0.0.1", 0);
  const http = (lobby.server as unknown as { transport: { server: { address(): AddressInfo } } }).transport.server;
  base = `http://127.0.0.1:${http.address().port}`;
});

after(async () => {
  await lobby.shutdown();
});

let seq = 0;
async function join() {
  seq += 1;
  const token = await makeTicket({ sub: `full${seq}`, nickname: `정원${seq}` });
  // 티켓은 Authorization 헤더로만(주소에 넣지 않는다)
  const client = new Client(base, { headers: { Origin: ALLOWED_ORIGIN, Authorization: `Bearer ${token}` } });
  return client.joinOrCreate("lobby", { look: validLook() });
}

const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return { message: "ok", code: 0 };
  } catch (error) {
    return { message: (error as Error).message, code: (error as { code?: number }).code ?? 0 };
  }
};

describe("방 상한 1", () => {
  it("10명이 찬 뒤 새 입장은 여러 번 보내도 LOBBY_FULL, 카운터는 1, 방은 10명을 넘지 않는다", async () => {
    const rooms: Room[] = [];
    for (let i = 0; i < 10; i += 1) rooms.push(await join());
    assert.equal(new Set(rooms.map((room) => room.roomId)).size, 1);
    // 상주 팀 NPC 는 정원(연결 수)에 안 센다 — 사람 10명 + NPC(지금 5명)가 한 방에(미르 11/8 베타 「NPC 를 빼고 10명」)
    await sleep(300);
    const sids = [...((rooms[0]!.state as { players: Map<string, unknown> }).players?.keys?.() ?? [])] as string[];
    assert.equal(sids.filter((sid) => sid.startsWith("npc-")).length, TEAM_SLOTS.length);
    assert.equal(sids.filter((sid) => !sid.startsWith("npc-")).length, 10);
    for (let i = 0; i < 3; i += 1) {
      const error = await errorOf(join());
      assert.equal(error.message, "LOBBY_FULL");
      assert.equal(error.code, 529);
    }
    assert.equal(lobby.roomCap.used, 1);

    await Promise.all(rooms.map((room) => room.leave(true)));
    const until = Date.now() + 8000;
    while (lobby.roomCap.used !== 0 && Date.now() < until) await sleep(20);
    assert.equal(lobby.roomCap.used, 0, "방이 폐기되면 0 으로 내려간다");

    const again = await join();
    assert.equal(lobby.roomCap.used, 1);
    await again.leave(true);
  });
});
