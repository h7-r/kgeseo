/**
 * 보안 화면의 「급증」 판단 — 평소(지난 7일 하루 평균)의 2배 이상이면서 5건 이상 많을 때만 레드.
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";

const { isSpike, changePercent } = await import("../../website/src/admin/lib/spike.ts");

test("급증 — 평소의 2배 이상이고 5건 이상 많을 때", () => {
  assert.equal(isSpike(214, 61), true);
  assert.equal(isSpike(26, 1), true);
  assert.equal(isSpike(10, 5), true);
});

test("작은 출렁임은 급증이 아니다", () => {
  assert.equal(isSpike(3, 1), false); // 3배지만 2건 차이
  assert.equal(isSpike(0, 0), false);
  assert.equal(isSpike(4, 0), false);
});

test("늘었어도 2배가 안 되면 급증이 아니다", () => {
  assert.equal(isSpike(412, 380), false);
  assert.equal(isSpike(38, 30), false);
});

test("증감 비율 — 기준선이 0 이면 낼 수 없다", () => {
  assert.equal(changePercent(150, 100), 50);
  assert.equal(changePercent(50, 100), -50);
  assert.equal(changePercent(5, 0), null);
});
