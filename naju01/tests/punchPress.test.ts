// 본편 왼쪽 클릭 주먹 — 걷다가 눌러도 그 자리에 서서 낸다(src/app/punchPress, 11/12 미르).
//   node --test naju01/tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PUNCH_HOLD_MS, pressPunch, type PunchBody } from "../../src/app/punchPress.ts";

const body = (patch: Partial<PunchBody> = {}): PunchBody => ({
  grounded: true,
  attackSerial: 0,
  attackMotion: "Punch_Jab",
  ...patch,
});

test("걷던 중에 눌러도 주먹이 나가고, 그동안 걷기를 멈춘다", () => {
  const player = body();
  assert.equal(pressPunch(player, "Punch_Jab", 1000), true);
  assert.equal(player.attackSerial, 1, "클릭이 버려지지 않는다");
  assert.equal(player.attackMotion, "Punch_Jab");
  assert.equal(player.holdStillUntil, 1000 + PUNCH_HOLD_MS, "닿는 순간(200ms)이 지날 때까지 제자리");
  assert.ok(PUNCH_HOLD_MS > 200 && PUNCH_HOLD_MS < 820, "주먹 한 번(최대 0.82초)보다 짧게 — 키를 누르고 있으면 곧 다시 걷는다");
});

test("공중에서는 내지 않는다 — 멈춰 설 수 없다", () => {
  const player = body({ grounded: false });
  assert.equal(pressPunch(player, "Punch_Jab", 1000), false);
  assert.equal(player.attackSerial, 0);
  assert.equal(player.holdStillUntil, undefined);
});

test("연달아 누르면 마지막 주먹부터 다시 센다 — 앞 멈춤을 줄이지 않는다", () => {
  const player = body();
  pressPunch(player, "Punch_Jab", 1000);
  pressPunch(player, "Punch_Cross", 1150);
  assert.equal(player.attackSerial, 2);
  assert.equal(player.attackMotion, "Punch_Cross");
  assert.equal(player.holdStillUntil, 1150 + PUNCH_HOLD_MS);
  player.holdStillUntil = 5000;
  pressPunch(player, "Punch_Jab", 1200);
  assert.equal(player.holdStillUntil, 5000);
});

test("본편이 이 규칙을 쓴다 — 클릭은 pressPunch 로, 이동은 holdStillUntil 동안 걷기 입력을 비운다", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const punch = read("../../src/app/playerState.ts");
  assert.match(punch, /pressPunch\(playerRef\.current, nextPunch, performance\.now\(\)\)/);
  assert.doesNotMatch(punch, /player\.moving/, "걷는 중 클릭을 버리던 조건이 없다");
  const movement = read("../../src/engine/movement/useMovement.ts");
  assert.match(movement, /holdStillUntil \?\? 0\) > performance\.now\(\)\) wish\.set\(0, 0, 0\)/);
});
