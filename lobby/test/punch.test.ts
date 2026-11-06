// 때리기 검사 — 미르 지시 11/6, 설계 v0.20 5절. 서버가 아는 자리로만 맞음을 정한다.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type BodyAt,
  canHit,
  POSE_FRESH_MS,
  PUNCH_COOLDOWN_MS,
  PUNCH_HEIGHT,
  PUNCH_RANGE,
  PunchGate,
} from "../src/punch.js";

describe("때리기 요청 검사", () => {
  it("잽·크로스와 상대 연결 ID 를 받는다", () => {
    const gate = new PunchGate();
    assert.deepEqual(gate.accept({ motion: "jab", target: "abc" }, 0), { motion: "jab", target: "abc" });
    assert.deepEqual(gate.accept({ motion: "cross" }, 1000), { motion: "cross", target: null });
  });
  const broken: [string, unknown][] = [
    ["객체가 아님", "jab"],
    ["배열", ["jab"]],
    ["모르는 동작", { motion: "kick" }],
    ["빈 상대", { motion: "jab", target: "" }],
    ["숫자 상대", { motion: "jab", target: 3 }],
    ["너무 긴 상대", { motion: "jab", target: "x".repeat(65) }],
  ];
  for (const [name, raw] of broken) {
    it(`${name} → 버린다`, () => assert.equal(new PunchGate().accept(raw, 0), null));
  }
  it(`${PUNCH_COOLDOWN_MS}ms 안의 요청은 버리고, 잘못된 요청도 간격을 새로 센다`, () => {
    const gate = new PunchGate();
    assert.ok(gate.accept({ motion: "jab" }, 0));
    assert.equal(gate.accept({ motion: "jab" }, PUNCH_COOLDOWN_MS - 1), null);
    // 잘못된 요청(PUNCH_COOLDOWN_MS - 1)도 셌으므로 그로부터 간격이 다시 필요하다
    assert.equal(gate.accept({ motion: "kick" }, PUNCH_COOLDOWN_MS * 2 - 2), null);
    assert.ok(gate.accept({ motion: "cross" }, PUNCH_COOLDOWN_MS * 3));
  });
});

describe("맞았나(서버가 아는 자리)", () => {
  const now = 10_000;
  // 때린 사람은 +x 를 본다(ry = π/2 → 앞 = (1, 0))
  const attacker: BodyAt = { placed: true, x: 0, y: 0, z: 0, ry: Math.PI / 2, poseAt: now };
  const at = (x: number, z: number, extra: Partial<BodyAt> = {}): BodyAt => ({
    placed: true,
    x,
    y: 0,
    z,
    ry: 0,
    poseAt: now,
    ...extra,
  });
  it("앞쪽 가까이는 맞는다", () => assert.equal(canHit(attacker, at(1.5, 0.3), now), true));
  it("거리 상한 밖은 안 맞는다", () => assert.equal(canHit(attacker, at(PUNCH_RANGE + 0.1, 0), now), false));
  it("뒤쪽은 안 맞는다", () => assert.equal(canHit(attacker, at(-1.5, 0), now), false));
  it("옆 75° 밖은 안 맞는다", () => assert.equal(canHit(attacker, at(0.2, 1.5), now), false));
  it("높이 차가 크면 안 맞는다", () =>
    assert.equal(canHit(attacker, at(1.5, 0, { y: PUNCH_HEIGHT + 0.1 }), now), false));
  it("아직 자리를 안 받은 사람은 안 맞는다", () =>
    assert.equal(canHit(attacker, at(1.5, 0, { placed: false }), now), false));
  it("낡은 자리로는 안 맞는다", () => {
    assert.equal(canHit(attacker, at(1.5, 0, { poseAt: now - POSE_FRESH_MS - 1 }), now), false);
    assert.equal(canHit({ ...attacker, poseAt: now - POSE_FRESH_MS - 1 }, at(1.5, 0), now), false);
  });
  it("몸이 겹칠 만큼 붙어 있으면 방향은 보지 않는다", () => assert.equal(canHit(attacker, at(-0.1, 0.1), now), true));
});
