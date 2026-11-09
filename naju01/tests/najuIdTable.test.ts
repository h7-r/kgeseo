/**
 * 나주 대응표 v1 — 퍼즐 코드가 쓰는 로컬 ID 가 빠짐없이 런타임 ID 로 바뀌는지, 표 자체가 빈 값 · 중복 검사를 통과하는지.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { NAJU_ID_TABLE_V1 } from "../src/progress/najuIdTable.ts";
import { NAJU_LOCAL } from "../src/progress/najuLocalIds.ts";
import { createProgressIdMap } from "../src/progress/progressSync.ts";

test("대응표 v1 은 빈 값 · 중복 런타임 ID 없이 만들어진다", () => {
  assert.doesNotThrow(() => createProgressIdMap(NAJU_ID_TABLE_V1));
});

test("퍼즐 코드가 보내는 로컬 ID 는 모두 대응표에 있고, 런타임 ID 는 ZONE_ · OBJ_ 로 시작한다", () => {
  const map = createProgressIdMap(NAJU_ID_TABLE_V1);
  for (const zone of Object.values(NAJU_LOCAL.zones)) {
    const runtime = map.toRuntime("zone", zone);
    assert.ok(runtime, `구역 ${zone} 이 대응표에 없다`);
    assert.match(runtime, /^ZONE_[A-Z_]+$/);
  }
  for (const object of Object.values(NAJU_LOCAL.objects)) {
    const runtime = map.toRuntime("object", object);
    assert.ok(runtime, `물건 ${object} 이 대응표에 없다`);
    assert.match(runtime, /^OBJ_S\d_[A-Z0-9_]+$/);
  }
});

test("대응표 v1 의 값은 문서(11/8 5절) 그대로다", () => {
  assert.deepEqual(NAJU_ID_TABLE_V1.zones, {
    Z1: "ZONE_FERRY_TERRACE",
    Z2: "ZONE_GRAVEL_BEACH",
    Z3: "ZONE_CLIFF_TOP",
    Z4: "ZONE_JINBU_RIDGE",
    "cave-hall": "ZONE_RIVER_CAVE_HALL",
    "cave-inner": "ZONE_RIVER_CAVE_INNER",
  });
  assert.deepEqual(NAJU_ID_TABLE_V1.objects, {
    "clam-holes": "OBJ_S1_CLAM_HOLES",
    "jar-slots": "OBJ_S1_JAR_SLOTS",
    "cave-big-clam": "OBJ_S1_CAVE_BIG_CLAM",
    "cave-door": "OBJ_S1_CAVE_RING_DOOR",
    "cave-tablet": "OBJ_S1_CAVE_TABLET",
  });
  // 런타임 ID 는 받은 답을 로컬로 되돌릴 때도 쓴다 — 양쪽으로 하나씩 맞는다
  const map = createProgressIdMap(NAJU_ID_TABLE_V1);
  assert.equal(map.toLocal("object", "OBJ_S1_CAVE_RING_DOOR"), "cave-door");
  assert.equal(map.toLocal("zone", "ZONE_RIVER_CAVE_HALL"), "cave-hall");
});
