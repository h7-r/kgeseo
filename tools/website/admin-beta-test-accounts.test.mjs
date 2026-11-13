/**
 * 베타 전 시험 계정 거름(관리자 「베타 기록」 화면, 11/13) — 참가 번호 목록 모양과 계정 id 고르기를 확인한다.
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";

const { PRE_BETA_TEST_KEYS, testAccountsIn } = await import("../../website/src/admin/lib/betaTestAccounts.ts");
const { shortKey } = await import("../../website/src/admin/lib/betaReport.ts");

test("목록은 참가 번호(대문자 16진 8자리) 15개만 — 계정 id · 이메일이 아니다", () => {
  assert.equal(PRE_BETA_TEST_KEYS.size, 15);
  for (const key of PRE_BETA_TEST_KEYS) assert.match(key, /^[0-9A-F]{8}$/);
});

test("참가 번호가 목록에 든 계정만 고르고, 빈 값 · 겹친 id 는 건너뛴다", () => {
  const testId = "00000000-0000-4000-8000-00000000000a";
  const realId = "00000000-0000-4000-8000-00000000000b";
  const keys = new Set([shortKey(testId)]);
  const found = testAccountsIn([testId, realId, null, undefined, "", testId], keys);
  assert.deepEqual([...found], [testId]);
});

test("기본 목록으로는 합성 계정을 고르지 않는다", () => {
  const ids = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  assert.equal(testAccountsIn(ids).size, 0);
});
