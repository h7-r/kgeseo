// 이동·인사 검사(설계 5절). 옮겨 적은 숫자가 본편 원본과 같은지도 본다.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as dimensions from "../../src/station/layout/dimensions.ts";
import * as movementConstants from "../../src/engine/movement/constants.ts";
import {
  DISTANCE_BUDGET_CAP,
  GREET_COOLDOWN_MS,
  GreetGate,
  HQ_BOUNDS,
  MAX_SPEED,
  MoveGate,
  parsePose,
  RESYNC_AFTER_MS,
} from "../src/movement.js";

const pose = (x: number, z: number, extra: Record<string, unknown> = {}) => ({
  x,
  y: 0,
  z,
  ry: 0,
  gait: "walk",
  ...extra,
});

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
  it("같은 순간 여러 개를 몰아 보내도 예산(0.5초 치)을 넘어 가지 못한다", () => {
    // 03회차 Codex 재현: 메시지마다 여유를 새로 주던 때는 12개로 17.6유닛을 갔다
    const gate = new MoveGate();
    assert.ok(gate.accept(pose(-10, 0), 0));
    let farthest = -10;
    for (let i = 1; i <= 12; i += 1) {
      const accepted = gate.accept(pose(-10 + i * 1.5, 0), 1000);
      if (accepted) farthest = accepted.x;
    }
    assert.ok(farthest - -10 <= DISTANCE_BUDGET_CAP + 1e-9, `${farthest - -10} > ${DISTANCE_BUDGET_CAP}`);
  });
  it("정상 걸음(초당 10회, 최고 속도)은 다 받는다", () => {
    const gate = new MoveGate();
    let x = -15;
    let accepted = 0;
    for (let i = 0; i < 40; i += 1) {
      if (gate.accept(pose(x, 0), i * 100)) accepted += 1;
      x += MAX_SPEED * 0.1;
    }
    assert.equal(accepted, 40);
  });
  it("늦게 몰려온 메시지(300ms 공백 뒤 3개가 10ms 안에)도 받는다", () => {
    const gate = new MoveGate();
    assert.ok(gate.accept(pose(0, 0), 0));
    const step = MAX_SPEED * 0.1;
    assert.ok(gate.accept(pose(step, 0), 300));
    assert.ok(gate.accept(pose(step * 2, 0), 305));
    assert.ok(gate.accept(pose(step * 3, 0), 310));
  });
  it("순간이동은 버리지만, 같은 자리가 3초 넘게 계속 오면 그 자리로 옮긴다", () => {
    const gate = new MoveGate();
    assert.ok(gate.accept(pose(-15, 0), 0));
    let moved = false;
    for (let t = 100; t <= RESYNC_AFTER_MS + 200; t += 100) {
      const accepted = gate.accept(pose(10, 5), t);
      if (accepted) {
        moved = true;
        assert.ok(t - 100 >= RESYNC_AFTER_MS, `너무 일찍 옮겼다: ${t}ms`);
        break;
      }
    }
    assert.ok(moved);
  });
  it("초당 10회를 크게 넘기면 버린다", () => {
    const gate = new MoveGate();
    let accepted = 0;
    for (let i = 0; i < 40; i += 1) if (gate.accept(pose(0, 0), i * 10)) accepted += 1;
    assert.ok(accepted <= 16, `0.4초에 받은 수 ${accepted}`);
  });
});

describe("인사", () => {
  it("정수 1~3 만", () => {
    for (const id of [0, 4, 7, 1.5, "1", null]) assert.equal(new GreetGate().accept({ id }, 0), null);
    assert.equal(new GreetGate().accept({ id: 3 }, 0), 3);
  });
  it("3초 쿨다운", () => {
    const gate = new GreetGate();
    assert.equal(gate.accept({ id: 1 }, 0), 1);
    assert.equal(gate.accept({ id: 2 }, GREET_COOLDOWN_MS - 1), null);
    assert.equal(gate.accept({ id: 2 }, GREET_COOLDOWN_MS), 2);
  });
});
