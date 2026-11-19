import assert from "node:assert/strict";
import { test } from "node:test";

import { LATE_OBJECTIVES, lateCompleted, lateFocus } from "../src/beta/lateObjectives.ts";

test("바위 위 단계마다 끝난 목표가 하나씩 늘고, 연출 단계는 앞 목표를 되돌리지 않는다", () => {
  assert.deepEqual(lateCompleted("idle", "waiting"), []);
  assert.deepEqual(lateCompleted("vision", "waiting"), ["P14"]);
  assert.deepEqual(lateCompleted("flowing", "waiting"), ["P14"]);
  assert.deepEqual(lateCompleted("loose", "waiting"), ["P14"]);
  assert.deepEqual(lateCompleted("traced", "waiting"), ["P14", "P15"]);
  // 주머니를 주운 것(found)만으론 아직 — 편지를 다 읽어야(done)
  assert.deepEqual(lateCompleted("found", "waiting"), ["P14", "P15"]);
  assert.deepEqual(lateCompleted("done", "waiting"), ["P14", "P15", "S4_POUCH"]);
  // 틈이 열린 것(opened)만으론 아직 — 지나서 내려서야(crossed)
  assert.deepEqual(lateCompleted("opened", "waiting"), ["P14", "P15", "S4_POUCH"]);
  assert.deepEqual(lateCompleted("crossed", "waiting"), ["P14", "P15", "S4_POUCH", "S4_SERPENT"]);
});

test("굿판 — 가락지를 올리면 S5_RINGS, 다섯 불을 다 켜면 P16. 도로 집으면 S5_RINGS 가 풀린다", () => {
  assert.deepEqual(lateCompleted("crossed", "rite"), ["P14", "P15", "S4_POUCH", "S4_SERPENT", "S5_RINGS"]);
  assert.deepEqual(lateCompleted("crossed", "released"), [...LATE_OBJECTIVES]);
  assert.deepEqual(lateCompleted("crossed", "dawn"), [...LATE_OBJECTIVES]);
  assert.ok(!lateCompleted("crossed", "waiting").includes("S5_RINGS"));
});

test("모르는 단계 이름은 아무것도 끝내지 않는다(저장이 깨졌을 때 잘못 세지 않게)", () => {
  assert.deepEqual(lateCompleted("???", "???"), ["S5_RINGS"]);
  assert.deepEqual(lateCompleted("", "waiting"), []);
});

test("지금 목표 — 능선 틈 전엔 없고, 지난 뒤엔 차례에서 처음 안 끝난 것", () => {
  assert.equal(lateFocus(new Set()), null);
  assert.equal(lateFocus(new Set(["P14"])), null);
  assert.equal(lateFocus(new Set(["S3_RIFT"])), "P14");
  assert.equal(lateFocus(new Set(["S3_RIFT", "P14"])), "P15");
  assert.equal(lateFocus(new Set(["S3_RIFT", "P14", "P15", "S4_POUCH"])), "S4_SERPENT");
  assert.equal(lateFocus(new Set(["S3_RIFT", "P14", "P15", "S4_POUCH", "S4_SERPENT"])), "S5_RINGS");
  assert.equal(lateFocus(new Set(["S3_RIFT", ...LATE_OBJECTIVES])), null);
});
