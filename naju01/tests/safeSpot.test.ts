// 「안전한 곳으로 이동」 자리 고르기(movement/safeSpotPick) — 같은 구역 · 안 막힘 · 3 m 넘게 떨어진 첫 자리(미르 11/12)
//   node --test naju01/tests/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { pickSafeSpot, type SafeSpot } from "../src/movement/safeSpotPick.ts";

/** x < 10 은 A 구역, 그 밖은 B 구역 */
const zoneOf = (x: number) => (x < 10 ? "A" : "B");
const spots: SafeSpot[] = [
  { x: 2, z: 0, heading: "+X" },
  { x: 6, z: 0, heading: "+X" },
  { x: 20, z: 0, heading: "+X" },
];
const never = () => false;

test("같은 구역에서 지금 자리와 3 m 넘게 떨어진 첫 자리 — 끼인 자리 · 틈 코앞 바로 곁으로 다시 보내지 않는다", () => {
  assert.deepEqual(pickSafeSpot({ x: 2.5, z: 0 }, spots, zoneOf, never, 3), spots[1], "2 는 0.5 m 라 건너뛴다");
  assert.deepEqual(pickSafeSpot({ x: 8, z: 0 }, spots, zoneOf, never, 3), spots[0]);
});

test("다른 구역 자리는 쓰지 않는다 — 지역 문 · 퍼즐 경계를 건너뛰는 지름길이 되지 않게", () => {
  assert.deepEqual(pickSafeSpot({ x: 21, z: 0 }, spots, zoneOf, never, 3), spots[2], "B 구역 자리는 하나뿐 — 가까워도 그것");
  assert.equal(
    pickSafeSpot({ x: 2, z: 0 }, [spots[2]], zoneOf, never, 3),
    null,
    "같은 구역 자리가 없으면 옮기지 않는다",
  );
});

test("막힌 자리는 건너뛰고, 다 가까우면 안 막힌 첫 자리 · 다 막혔으면 옮기지 않는다", () => {
  const blocked = (x: number) => x === 6;
  assert.deepEqual(pickSafeSpot({ x: 3, z: 0 }, spots, zoneOf, blocked, 3), spots[0], "6 이 막혀 가까운 2 라도");
  assert.equal(pickSafeSpot({ x: 3, z: 0 }, spots, zoneOf, () => true, 3), null);
});
