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
const { TEAM_SLOTS, parseTeamLines, parseTeamLinePairs, parseTeamEntry } = await import("../src/npc/teamRoster.js");
const { TEAM_EMOTE_MOTIONS, TEAM_CLIP_MOTIONS, gesturePlaySeconds, isTeamGestureId } =
  await import("../src/npc/teamGestures.js");
const { NPC_ACT_MIN_MS, NPC_ACT_MAX_MS } = await import("../src/npc/teamNpcs.js");
const { Player } = await import("../src/state.js");

function makeCrew() {
  let now = 1_000_000;
  const players = new MapSchema<InstanceType<typeof Player>>();
  const greets: Array<[string, number, number]> = [];
  const acts: Array<{
    sid: string;
    text: string;
    gesture: number;
    motion: string | undefined;
    at: number;
    x: number;
    z: number;
  }> = [];
  const crew = new TeamNpcCrew(players, {
    nowMs: () => now,
    greet: (sid, id) => greets.push([sid, id, now]),
    act: (sid, text, gesture, motion) => {
      const player = players.get(sid)!;
      acts.push({ sid, text, gesture, motion, at: now, x: player.x, z: player.z });
    },
    log: () => {},
  });
  const advance = (ticks: number) => {
    for (let i = 0; i < ticks; i += 1) {
      now += NPC_TICK_MS;
      crew.step();
    }
  };
  return { crew, players, greets, acts, advance, setNow: (value: number) => (now = value), getNow: () => now };
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

  it("팀 전용 옷(캡 · 해병대 반팔 · 바지)은 NPC look 에서만 통과한다 — 사람 look 은 그대로 막는다", async () => {
    const { validateLook } = await import("../src/look.js");
    const marine = {
      ...SEJIN,
      appearance: {
        ...SEJIN.appearance,
        hairId: "hair.f.long.cap",
        equipmentIds: { ...SEJIN.appearance.equipmentIds, top: "top.tee.marine", bottom: "bottom.pants.baggy" },
      },
    };
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: { sejin: marine } }));
    const { crew, players, setNow } = makeCrew();
    setNow(20_000_000);
    crew.spawn();
    const look = JSON.parse(players.get("npc-sejin")!.look) as Record<string, unknown>;
    assert.equal(look.hair, "hair.f.long.cap");
    assert.equal(look.top, "top.tee.marine");
    assert.equal(look.bottom, "bottom.pants.baggy");
    // 같은 look 을 사람이 보내면 허용 목록에 없어 통째로 버린다
    assert.equal(validateLook(look), null);
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: {} }));
  });

  it("틀린 저장값(옷 · 색 · 체형)은 버리고 기본 모습으로 돌아다닌다", () => {
    const broken = {
      ...SEJIN,
      appearance: { ...SEJIN.appearance, equipmentIds: { ...SEJIN.appearance.equipmentIds, top: "top.unknown" } },
    };
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: { sejin: broken } }));
    const { crew, players, setNow } = makeCrew();
    setNow(9_000_000); // 파일 캐시를 넘기게
    crew.spawn();
    const look = JSON.parse(players.get("npc-sejin")!.look) as { gender: string; hair: string; bottom: string };
    assert.equal(look.gender, "feminine");
    assert.equal(look.hair, "hair.f.bob");
    assert.equal(look.bottom, "bottom.shorts.black");
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: {} }));
  });

  it("머리만 이 서버가 모르는 것이면(다른 브랜치의 새 머리) 그 성별 기본 머리로만 바꾸고 나머지 외형은 살린다", () => {
    const newHair = {
      ...SEJIN,
      appearance: {
        ...SEJIN.appearance,
        hairId: "hair.buzz.future",
        equipmentIds: { ...SEJIN.appearance.equipmentIds, bottom: "bottom.jeans.skinny" },
        colors: { ...SEJIN.appearance.colors, cloth: "#ff0000" },
      },
    };
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: { sejin: newHair } }));
    const logs: Array<[string, Record<string, unknown>]> = [];
    let now = 9_500_000;
    const players = new MapSchema<InstanceType<typeof Player>>();
    const crew = new TeamNpcCrew(players, {
      nowMs: () => now,
      greet: () => {},
      act: () => {},
      log: (event, fields) => logs.push([event, fields ?? {}]),
    });
    now += 1;
    crew.spawn();
    const look = JSON.parse(players.get("npc-sejin")!.look) as {
      hair: string;
      bottom: string;
      colors: { cloth: string };
    };
    assert.equal(look.hair, "hair.f.bob");
    assert.equal(look.bottom, "bottom.jeans.skinny");
    assert.equal(look.colors.cloth, "#ff0000");
    assert.equal(logs.find(([event]) => event === "npc_spawned")?.[1].hairFallback, 1);
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
  it("대사는 앞뒤 공백을 걷고 1~40자 · 제어 문자 없는 것만, 앞에서 2개까지 남긴다", () => {
    assert.deepEqual(parseTeamLines(["  안녕하세요   조사관님 ", "", "a".repeat(41), "둘째\u0007", "셋째", "넷째"]), [
      "안녕하세요 조사관님",
      "셋째",
    ]);
    assert.deepEqual(parseTeamLines("한 줄"), []);
    assert.deepEqual(parseTeamLines(undefined), []);
    // 대사가 없던 옛 저장값도 그대로 읽힌다
    assert.deepEqual(parseTeamEntry(SEJIN)?.lines, []);
  });

  it("고유 외침은 해랑 비켜(3) · 세진 신난다(2) · 동환 안녕(1) · 지하 고마워(5) · 미르 알았어(6)", async () => {
    const { GREET_IDS } = await import("../src/movement.js");
    assert.deepEqual(Object.fromEntries(TEAM_SLOTS.map((slot) => [slot.key, slot.call])), {
      haerang: 3,
      sejin: 2,
      donghwan: 1,
      jiha: 5,
      mireu: 6,
    });
    for (const slot of TEAM_SLOTS) assert.ok((GREET_IDS as readonly number[]).includes(slot.call));
  });

  it("10~30초마다 멈춰 서서 대사(2개 중 하나 + 인사 동작)와 고유 외침을 번갈아 한다 — 대사가 없으면 외침만", () => {
    const lines = ["오늘도 수사 시작!", "단서는 현장에 있어요"];
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: { sejin: { ...SEJIN, lines } } }));
    const { crew, acts, greets, advance, setNow } = makeCrew();
    setNow(30_000_000);
    crew.spawn();
    advance(Math.ceil(240_000 / NPC_TICK_MS));
    const turns = [
      ...acts
        .filter((act) => act.sid === "npc-sejin")
        .map((act) => ({ at: act.at, line: act.text, gesture: act.gesture })),
      ...greets.filter(([sid]) => sid === "npc-sejin").map(([, id, at]) => ({ at, call: id })),
    ].sort((a, b) => a.at - b.at);
    assert.ok(turns.length >= 7, `세진 차례 ${turns.length}번`);
    for (let i = 0; i < turns.length; i += 1) {
      const turn = turns[i]!;
      if ("line" in turn) {
        assert.ok(lines.includes(turn.line), turn.line);
        assert.ok(turn.gesture >= 1 && turn.gesture <= 6, String(turn.gesture));
      } else {
        assert.equal(turn.call, 2, "세진 외침은 신난다");
      }
      if (i === 0) continue;
      const before = turns[i - 1]!;
      assert.notEqual("line" in turn, "line" in before, `${i}번째가 앞 차례와 같은 종류`);
      const gap = turn.at - before.at;
      assert.ok(gap >= NPC_ACT_MIN_MS, `간격 ${gap}`);
      // 걷는 중이면 멈춘 다음에 하므로 상한보다 조금 늦을 수 있다
      assert.ok(gap <= NPC_ACT_MAX_MS + 15_000, `간격 ${gap}`);
    }
    // 대사가 없는 네 명은 같은 주기로 자기 외침만 한다
    for (const slot of TEAM_SLOTS.filter((one) => one.key !== "sejin")) {
      const mine = greets.filter(([sid]) => sid === `npc-${slot.key}`);
      assert.ok(mine.length >= 7, `${slot.key} 외침 ${mine.length}번`);
      assert.ok(
        mine.every(([, id]) => id === slot.call),
        `${slot.key} 외침 ${mine.map(([, id]) => id).join(",")}`,
      );
      assert.ok(!acts.some((act) => act.sid === `npc-${slot.key}`));
    }
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: {} }));
  });

  it("행동하는 순간에는 멈춰 있고, 그 뒤 3초는 걷지 않는다", () => {
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: { sejin: { ...SEJIN, lines: ["잠깐만요"] } } }));
    const { crew, players, acts, greets, advance, setNow } = makeCrew();
    setNow(40_000_000);
    crew.spawn();
    const sejin = players.get("npc-sejin")!;
    const turnsOf = () =>
      acts.filter((act) => act.sid === "npc-sejin").length + greets.filter(([sid]) => sid === "npc-sejin").length;
    let checked = 0;
    for (let tick = 0; tick < Math.ceil(300_000 / NPC_TICK_MS); tick += 1) {
      const count = turnsOf();
      advance(1);
      if (turnsOf() === count) continue;
      const at = { x: sejin.x, z: sejin.z };
      for (let hold = 0; hold < Math.floor(3000 / NPC_TICK_MS); hold += 1) {
        advance(1);
        assert.equal(sejin.gait, "idle");
        assert.ok(Math.hypot(sejin.x - at.x, sejin.z - at.z) < 1e-6, "행동 중에 움직였다");
      }
      checked += 1;
    }
    assert.ok(checked >= 5, `확인한 행동 ${checked}번`);
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: {} }));
  });

  it("연락처 · 금칙어가 든 대사는 말하지 않고, 남은 대사가 없으면 외침만 한다", () => {
    writeFileSync(
      FILE,
      JSON.stringify({
        version: 1,
        npcs: {
          sejin: { ...SEJIN, lines: ["연락 주세요 010-1234-5678", "씨발 뭐야"] },
          haerang: { ...SEJIN, displayName: "해랑", lines: ["씨발 뭐야", "같이 단서 찾아요"] },
        },
      }),
    );
    const { crew, acts, greets, advance, setNow } = makeCrew();
    setNow(50_000_000);
    crew.spawn();
    advance(Math.ceil(200_000 / NPC_TICK_MS));
    assert.ok(!acts.some((act) => act.sid === "npc-sejin"));
    const sejin = greets.filter(([sid]) => sid === "npc-sejin");
    assert.ok(sejin.length > 0 && sejin.every(([, id]) => id === 2));
    const haerang = acts.filter((act) => act.sid === "npc-haerang");
    assert.ok(haerang.length > 0);
    assert.ok(haerang.every((act) => act.text === "같이 단서 찾아요"));
    // 남은 대사 하나와 비켜를 번갈아
    assert.ok(greets.some(([sid, id]) => sid === "npc-haerang" && id === 3));
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: {} }));
  });

  it("저장 파일의 대사를 바꾸면 2초 안에 새 대사를 말한다", () => {
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: { sejin: { ...SEJIN, lines: ["옛 대사"] } } }));
    const { crew, acts, advance, setNow, getNow } = makeCrew();
    setNow(60_000_000);
    crew.spawn();
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: { sejin: { ...SEJIN, lines: ["새 대사"] } } }));
    advance(Math.ceil(2100 / NPC_TICK_MS));
    const from = getNow();
    advance(Math.ceil(120_000 / NPC_TICK_MS));
    const after = acts.filter((act) => act.sid === "npc-sejin" && act.at > from);
    assert.ok(after.length > 0);
    assert.ok(after.every((act) => act.text === "새 대사"));
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: {} }));
  });
  it("고를 수 있는 동작은 인사 6 + 치비 클립 47, ID 는 겹치지 않고 반복 클립은 3초 튼다", () => {
    assert.equal(TEAM_EMOTE_MOTIONS.length, 6);
    assert.equal(TEAM_CLIP_MOTIONS.length, 47);
    const ids = [...TEAM_EMOTE_MOTIONS, ...TEAM_CLIP_MOTIONS].map((motion) => motion.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(gesturePlaySeconds("q:Dance_Loop"), 3);
    assert.equal(gesturePlaySeconds("q:Fixing_Kneeling"), 5.2);
    assert.ok(isTeamGestureId("tripo:Idle_Fold_Loop") && isTeamGestureId("emote:6"));
    assert.ok(!isTeamGestureId("q:Nope") && !isTeamGestureId("emote:7") && !isTeamGestureId(""));
  });

  it('대사와 동작은 짝으로 읽는다 — 빈 줄 · 틀린 줄은 그 동작과 함께 빠지고, 모르는 동작 · 옛 파일은 무작위("")', () => {
    assert.deepEqual(parseTeamLinePairs(["", "둘째"], ["q:Roll", "q:Death01"]), {
      lines: ["둘째"],
      lineGestures: ["q:Death01"],
    });
    assert.deepEqual(parseTeamLinePairs(["하나", "둘"], ["q:Nope", 3]), {
      lines: ["하나", "둘"],
      lineGestures: ["", ""],
    });
    assert.deepEqual(parseTeamLinePairs(["하나"]), { lines: ["하나"], lineGestures: [""] });
    assert.deepEqual(parseTeamEntry({ ...SEJIN, lines: ["a", "b"], lineGestures: ["emote:2"] })?.lineGestures, [
      "emote:2",
      "",
    ]);
  });

  it("고른 동작으로 대사를 친다 — 클립은 motion(+ 옛 화면용 번호), 인사 동작은 그 번호, 긴 동작은 끝날 때까지 서 있다", () => {
    writeFileSync(
      FILE,
      JSON.stringify({
        version: 1,
        npcs: {
          sejin: { ...SEJIN, lines: ["춤춘다", "고마워요"], lineGestures: ["q:Dance_Loop", "emote:5"] },
          jiha: { ...SEJIN, displayName: "지하", lines: ["고치는 중"], lineGestures: ["q:Fixing_Kneeling"] },
        },
      }),
    );
    const { crew, players, acts, advance, setNow } = makeCrew();
    setNow(70_000_000);
    crew.spawn();
    const jiha = players.get("npc-jiha")!;
    let held = 0;
    for (let tick = 0; tick < Math.ceil(300_000 / NPC_TICK_MS); tick += 1) {
      const count = acts.length;
      advance(1);
      const last = acts[acts.length - 1];
      if (acts.length === count || last?.sid !== "npc-jiha") continue;
      // 무릎 꿇고 수리 5.2초 — 그동안 걷지 않는다
      const at = { x: jiha.x, z: jiha.z };
      for (let hold = 0; hold < Math.floor(5300 / NPC_TICK_MS); hold += 1) {
        advance(1);
        assert.equal(jiha.gait, "idle");
        assert.ok(Math.hypot(jiha.x - at.x, jiha.z - at.z) < 1e-6, "긴 동작 중에 움직였다");
      }
      held += 1;
    }
    assert.ok(held >= 3, `지하 대사 ${held}번`);
    const sejin = acts.filter((act) => act.sid === "npc-sejin");
    assert.ok(sejin.some((act) => act.text === "춤춘다") && sejin.some((act) => act.text === "고마워요"));
    for (const act of sejin) {
      if (act.text === "춤춘다") {
        assert.equal(act.motion, "q:Dance_Loop");
        assert.ok(act.gesture >= 1 && act.gesture <= 6);
      } else {
        assert.equal(act.motion, undefined);
        assert.equal(act.gesture, 5);
      }
    }
    assert.ok(acts.filter((act) => act.sid === "npc-jiha").every((act) => act.motion === "q:Fixing_Kneeling"));
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: {} }));
  });

  it("금칙어로 빠진 대사는 그 동작도 같이 빠진다(남은 대사는 제 동작 그대로)", () => {
    writeFileSync(
      FILE,
      JSON.stringify({
        version: 1,
        npcs: { sejin: { ...SEJIN, lines: ["씨발 뭐야", "좋아요"], lineGestures: ["q:Roll", "q:Death01"] } },
      }),
    );
    const { crew, acts, advance, setNow } = makeCrew();
    setNow(80_000_000);
    crew.spawn();
    advance(Math.ceil(200_000 / NPC_TICK_MS));
    const sejin = acts.filter((act) => act.sid === "npc-sejin");
    assert.ok(sejin.length > 0);
    assert.ok(sejin.every((act) => act.text === "좋아요" && act.motion === "q:Death01"));
    writeFileSync(FILE, JSON.stringify({ version: 1, npcs: {} }));
  });
});
