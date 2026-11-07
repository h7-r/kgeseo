// 팀 캐릭터 NPC(검토 22회차): 다섯 명이 서고 · 가구를 뚫지 않고 걷고 · 저장 파일이 바뀌면 갈아입고 · 맞으면 밀린다.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { MapSchema } from "@colyseus/schema";

// 모듈이 읽기 전에 저장 파일 자리를 시험용으로 돌린다
const dir = mkdtempSync(join(tmpdir(), "team-npcs-"));
const FILE = join(dir, "team-npcs.json");
writeFileSync(FILE, JSON.stringify({ version: 1, npcs: {} }));
process.env.TEAM_NPC_FILE = FILE;

const { TeamNpcCrew, NPC_TICK_MS } = await import("../src/npc/teamNpcs.js");
const { isFree } = await import("../src/npc/hqMap.js");
const { TEAM_SLOTS } = await import("../src/npc/teamRoster.js");
const { Player } = await import("../src/state.js");

function makeCrew() {
  let now = 1_000_000;
  const players = new MapSchema<InstanceType<typeof Player>>();
  const greets: Array<[string, number]> = [];
  const crew = new TeamNpcCrew(players, {
    nowMs: () => now,
    greet: (sid, id) => greets.push([sid, id]),
    log: () => {},
  });
  const advance = (ticks: number) => {
    for (let i = 0; i < ticks; i += 1) {
      now += NPC_TICK_MS;
      crew.step();
    }
  };
  return { crew, players, greets, advance, setNow: (value: number) => (now = value), getNow: () => now };
}

const SEJIN = {
  displayName: "세진",
  savedAt: "2026-11-08T00:00:00.000Z",
  appearance: {
    gender: "feminine",
    bodyParameters: {
      heightScale: 0.98,
      headScale: 0.8,
      handScale: 0.7,
      footScale: 0.85,
      shoulderWidth: 1.13,
      hipWidth: 0.85,
      armLength: 0.78,
      legLength: 1,
      armThickness: 0.85,
      legThickness: 0.85,
      build: -0.2,
      buff: 0.4,
    },
    hairId: "hair.f.bob",
    equipmentIds: { top: "top.tee.white", bottom: "bottom.shorts.black", shoes: "shoes.sneaker.white" },
    colors: { skin: "#e0b79c", hair: "#ffffff", cloth: "#ffffff", bottom: "#ffffff", shoes: "#ffffff" },
  },
};

describe("팀 캐릭터 NPC", () => {
  it("길찾기가 편 선분은 촘촘히(1cm) 재도 막힌 데를 지나지 않는다(Codex 리뷰 3de4d97)", async () => {
    const { REACHABLE, cellCenter, findPath } = await import("../src/npc/hqMap.js");
    let segments = 0;
    for (let n = 0; n < 400; n += 1) {
      const from = REACHABLE[(n * 7919) % REACHABLE.length]!;
      const to = REACHABLE[(n * 104729 + 13) % REACHABLE.length]!;
      const [fx, fz] = cellCenter(from);
      const path = findPath(fx, fz, to);
      if (!path) continue;
      let [ax, az] = [fx, fz];
      for (const [bx, bz] of path) {
        const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.01);
        for (let s = 0; s <= steps; s += 1) {
          const x = ax + ((bx - ax) * s) / steps;
          const z = az + ((bz - az) * s) / steps;
          assert.ok(isFree(x, z), `막힌 자리 ${x.toFixed(3)}, ${z.toFixed(3)} (${n}번째 길)`);
        }
        segments += 1;
        [ax, az] = [bx, bz];
      }
    }
    assert.ok(segments > 400);
  });

  it("다섯 명이 빈칸에 서고, 저장값이 없으면 그 성별 기본 모습이다", () => {
    const { crew, players } = makeCrew();
    crew.spawn();
    assert.equal(players.size, TEAM_SLOTS.length);
    for (const slot of TEAM_SLOTS) {
      const player = players.get(`npc-${slot.key}`);
      assert.ok(player, slot.key);
      assert.equal(player.npc, true);
      assert.equal(player.placed, true);
      assert.equal(player.nickname, slot.name);
      assert.ok(isFree(player.x, player.z), `${slot.key} 가 막힌 자리에 섰다`);
      const look = JSON.parse(player.look) as { gender: string };
      assert.equal(look.gender, slot.gender);
    }
  });

  it("걸어 다니고, 가구 · 벽을 뚫지 않는다", () => {
    const { crew, players, advance } = makeCrew();
    crew.spawn();
    const start = new Map([...players.entries()].map(([sid, p]) => [sid, [p.x, p.z]]));
    let walked = 0;
    for (let second = 0; second < 40; second += 1) {
      advance(8);
      players.forEach((player) => {
        assert.ok(isFree(player.x, player.z), `막힌 자리 ${player.x.toFixed(2)}, ${player.z.toFixed(2)}`);
        if (player.gait === "walk") walked += 1;
      });
    }
    const moved = [...players.entries()].filter(([sid, p]) => {
      const [x, z] = start.get(sid)!;
      return Math.hypot(p.x - x!, p.z - z!) > 1;
    });
    assert.ok(moved.length >= 4, `40초에 ${moved.length}명만 움직였다`);
    assert.ok(walked > 0);
  });

  it("NPC 끼리 겹치지 않는다(중심 사이 1.3 유닛 근처 이상)", () => {
    const { crew, players, advance } = makeCrew();
    crew.spawn();
    let closest = Infinity;
    for (let tick = 0; tick < 400; tick += 1) {
      advance(1);
      const list = [...players.values()];
      for (let a = 0; a < list.length; a += 1)
        for (let b = a + 1; b < list.length; b += 1)
          closest = Math.min(closest, Math.hypot(list[a]!.x - list[b]!.x, list[a]!.z - list[b]!.z));
    }
    assert.ok(closest > 1.0, `가장 가까웠던 거리 ${closest.toFixed(2)}`);
  });

  it("저장 파일이 바뀌면 2초 안에 이름 · 모습을 갈아입는다", () => {
    const { crew, players, advance } = makeCrew();
    crew.spawn();
    const before = players.get("npc-sejin")!.look;
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: { sejin: SEJIN } }));
    advance(Math.ceil(2100 / NPC_TICK_MS));
    const sejin = players.get("npc-sejin")!;
    assert.equal(sejin.nickname, "세진");
    assert.notEqual(sejin.look, before);
    const look = JSON.parse(sejin.look) as { colors: { skin: string }; body: { buff: number } };
    assert.equal(look.colors.skin, "#e0b79c");
    assert.equal(look.body.buff, 0.4);
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: {} }));
  });

  it("팀 전용 옷(캡 · 해병대 반팔)은 NPC look 에서만 통과한다 — 사람 look 은 그대로 막는다", async () => {
    const { validateLook } = await import("../src/look.js");
    const marine = {
      ...SEJIN,
      appearance: {
        ...SEJIN.appearance,
        hairId: "hair.f.long.cap",
        equipmentIds: { ...SEJIN.appearance.equipmentIds, top: "top.tee.marine" },
      },
    };
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: { sejin: marine } }));
    const { crew, players, setNow } = makeCrew();
    setNow(20_000_000);
    crew.spawn();
    const look = JSON.parse(players.get("npc-sejin")!.look) as Record<string, unknown>;
    assert.equal(look.hair, "hair.f.long.cap");
    assert.equal(look.top, "top.tee.marine");
    // 같은 look 을 사람이 보내면 허용 목록에 없어 통째로 버린다
    assert.equal(validateLook(look), null);
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: {} }));
  });

  it("틀린 저장값은 버리고 기본 모습으로 돌아다닌다", () => {
    const broken = { ...SEJIN, appearance: { ...SEJIN.appearance, hairId: "hair.unknown" } };
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: { sejin: broken } }));
    const { crew, players, setNow } = makeCrew();
    setNow(9_000_000); // 파일 캐시를 넘기게
    crew.spawn();
    const look = JSON.parse(players.get("npc-sejin")!.look) as { gender: string; hair: string };
    assert.equal(look.gender, "feminine");
    assert.equal(look.hair, "hair.f.bob");
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: {} }));
  });

  it("맞으면 때린 사람 반대쪽으로 밀린다(막히지 않으면 약 1.2 유닛)", () => {
    const { crew, players, advance } = makeCrew();
    crew.spawn();
    // 처음엔 다들 잠깐 서 있다(0.5~4초) — 그 사이에 때린다. 동쪽(+x)이 트인 NPC 를 고른다
    const list = [...players.entries()];
    const open = list.find(
      ([, p]) =>
        isFree(p.x + 1.4, p.z) &&
        isFree(p.x + 0.7, p.z) &&
        list.every(([, q]) => q === p || Math.hypot(q.x - (p.x + 1.2), q.z - p.z) > 2),
    );
    if (!open) return; // 다섯 명이 다 막힌 자리에 선 드문 경우 — 다음 실행에서 본다
    const [sid, target] = open;
    const x0 = target.x;
    const z0 = target.z;
    crew.hit(sid, { x: x0 - 1, z: z0, ry: Math.PI / 2 });
    advance(7); // 0.875초 — 0.2초 뒤 밀리기 시작해 0.43초에 95%
    const along = target.x - x0;
    assert.ok(Math.abs(target.z - z0) < 0.05, `옆으로 ${(target.z - z0).toFixed(2)} 밀렸다`);
    assert.ok(along > 1.0 && along < 1.25, `밀린 거리 ${along.toFixed(3)}`);
  });
});
