import assert from "node:assert/strict";
import test from "node:test";

import { createLookGuard } from "../../src/engine/input/lookGuard.ts";

test("천천히 움직이던 중에 튄 값 하나는 버린다", () => {
  const guard = createLookGuard();
  let now = 0;
  for (let i = 0; i < 5; i++) assert.equal(guard.shouldDrop(4, 1, (now += 8)), false);
  assert.equal(guard.shouldDrop(900, 0, (now += 8)), true);
  assert.equal(guard.shouldDrop(5, 1, (now += 8)), false);
  assert.equal(guard.dropped(), 1);
});

test("빠른 뒤돌기는 지나간다 — 여러 이벤트에 걸쳐 커진다", () => {
  const guard = createLookGuard();
  let now = 0;
  for (const dx of [6, 30, 120, 320, 480, 500, 260, 40]) assert.equal(guard.shouldDrop(dx, 0, (now += 8)), false);
  assert.equal(guard.dropped(), 0);
});

test("쉬다가 움직인 첫 값은 커도 지나간다 — 견줄 직전 값이 없다", () => {
  const guard = createLookGuard();
  for (let i = 0; i < 5; i++) guard.shouldDrop(3, 0, i * 8);
  assert.equal(guard.shouldDrop(700, 0, 1000), false);
});

test("진짜로 휙 돌린 것이면 첫 값만 잃고 이어지는 값은 지나간다", () => {
  const guard = createLookGuard();
  let now = 0;
  for (let i = 0; i < 5; i++) guard.shouldDrop(3, 0, (now += 8));
  assert.equal(guard.shouldDrop(400, 0, (now += 8)), true);
  assert.equal(guard.shouldDrop(420, 0, (now += 8)), false);
  assert.equal(guard.shouldDrop(380, 0, (now += 8)), false);
});

test("숫자가 아닌 값은 버린다", () => {
  const guard = createLookGuard();
  assert.equal(guard.shouldDrop(Number.NaN, 0, 0), true);
});
