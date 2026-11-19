// 방 수 상한 카운터 — 반복 거절·폐기·초기화 실패(설계 5절)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RoomCap } from "../src/roomCap.js";

describe("방 수 상한", () => {
  it("상한까지만 확보하고, 넘으면 계속 거절해도 카운터는 그대로", () => {
    const cap = new RoomCap(1);
    const slot = cap.tryAcquire();
    assert.ok(slot);
    for (let i = 0; i < 5; i += 1) assert.equal(cap.tryAcquire(), null);
    assert.equal(cap.used, 1);
  });
  it("폐기하면 0 으로 내려가 새 방을 만들 수 있다", () => {
    const cap = new RoomCap(1);
    const slot = cap.tryAcquire();
    assert.equal(slot?.release(), true);
    assert.equal(cap.used, 0);
    assert.ok(cap.tryAcquire());
  });
  it("초기화 실패 정리와 onDispose 가 둘 다 불려도 한 번만 줄인다", () => {
    const cap = new RoomCap(2);
    const a = cap.tryAcquire();
    cap.tryAcquire();
    assert.equal(a?.release(), true);
    assert.equal(a?.release(), false);
    assert.equal(cap.used, 1);
  });
});
