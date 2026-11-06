// 이동·인사 검사(설계 5절). 옮겨 적은 숫자가 본편 원본과 같은지도 본다.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as dimensions from "../../src/station/layout/dimensions.ts";
import * as movementConstants from "../../src/engine/movement/constants.ts";
import { GREET_COOLDOWN_MS, GreetGate, HQ_BOUNDS, MAX_SPEED, MoveGate, parsePose } from "../src/movement.js";

const pose = (x: number, z: number, extra: Record<string, unknown> = {}) => ({ x, y: 0, z, ry: 0, gait: "walk", ...extra });

describe("본편 숫자와 같다", () => {
  it("본부실 벽", () => {
    assert.equal(HQ_BOUNDS.minX, dimensions.HEADQUARTERS_MIN_X);
    assert.equal(HQ_BOUNDS.maxX, dimensions.HEADQUARTERS_MAX_X);
    assert.equal(HQ_BOUNDS.minZ, dimensions.HEADQUARTERS_MIN_Z);
    assert.equal(HQ_BOUNDS.maxZ, dimensions.HEADQUARTERS_MAX_Z);
    assert.equal(HQ_BOUNDS.maxY, dimensions.HEADQUARTERS_H);
  });
  it("최고 속도 = 걷기 × 달리기 배율", () => {
    assert.equal(MAX_SPEED, movementConstants.WALK_SPEED * movementConstants.RUN_SPEED_MULTIPLIER);
  });
});

describe("이동 모양·범위", () => {
  it("정상", () => assert.ok(parsePose(pose(0, 0))));
  it("유한한 숫자가 아니면 버린다", () => {
    assert.equal(parsePose(pose(Number.NaN, 0)), null);
    assert.equal(parsePose(pose(Infinity, 0)), null);
    assert.equal(parsePose({ ...pose(0, 0), y: "0" }), null);
  });
  it("본부실 밖이면 버린다", () => {
    assert.equal(parsePose(pose(-25, 0)), null);
    assert.equal(parsePose(pose(0, 20)), null);
    assert.equal(parsePose(pose(0, 0, { y: 50 })), null);
  });
  it("모르는 걸음새는 버린다", () => assert.equal(parsePose(pose(0, 0, { gait: "fly" })), null));
  it("방향은 −π~π 로 접는다", () => {
    const wrapped = parsePose(pose(0, 0, { ry: 3 * Math.PI }));
    assert.ok(wrapped && Math.abs(Math.abs(wrapped.ry) - Math.PI) < 1e-9);
  });
});

describe("이동 속도·빈도", () => {
  it("그동안 갈 수 없는 거리는 버리고, 시간이 지나면 다시 받는다", () => {
    const gate = new MoveGate();
    assert.ok(gate.accept(pose(0, 0), 0));
    assert.equal(gate.accept(pose(12, 0), 100), null);
    assert.ok(gate.accept(pose(0.5, 0), 200));
    // 순간이동이 있어도 충분히 지나면 받는다(영원히 굳지 않는다)
    assert.ok(gate.accept(pose(12, 0), 2000));
  });
  it("초당 10회를 크게 넘기면 버린다", () => {
    const gate = new MoveGate();
    let accepted = 0;
    for (let i = 0; i < 40; i += 1) if (gate.accept(pose(0, 0), i * 10)) accepted += 1;
    assert.ok(accepted <= 16, `0.4초에 받은 수 ${accepted}`);
    const steady = new MoveGate();
    let steadyAccepted = 0;
    for (let i = 0; i < 50; i += 1) if (steady.accept(pose(0, 0), i * 100)) steadyAccepted += 1;
    assert.equal(steadyAccepted, 50);
  });
});

describe("인사", () => {
  it("정수 1~6 만", () => {
    for (const id of [0, 7, 1.5, "1", null]) assert.equal(new GreetGate().accept({ id }, 0), null);
    assert.equal(new GreetGate().accept({ id: 6 }, 0), 6);
  });
  it("3초 쿨다운", () => {
    const gate = new GreetGate();
    assert.equal(gate.accept({ id: 1 }, 0), 1);
    assert.equal(gate.accept({ id: 2 }, GREET_COOLDOWN_MS - 1), null);
    assert.equal(gate.accept({ id: 2 }, GREET_COOLDOWN_MS), 2);
  });
});
