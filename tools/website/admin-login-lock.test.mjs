/**
 * 관리자 로그인 잠김(429 login_locked)의 남은 시간 안내 — Retry-After(정수 초)를 분으로 올려 알린다.
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";

const { parseRetryAfter, lockedLoginMessage, LOCKED_FALLBACK } =
  await import("../../website/src/admin/lib/loginLock.ts");

test("Retry-After — 양의 정수 초만 받는다", () => {
  assert.equal(parseRetryAfter("900"), 900);
  assert.equal(parseRetryAfter(" 61 "), 61);
  assert.equal(parseRetryAfter("1"), 1);
});

test("Retry-After — 비었거나 이상한 값은 버린다", () => {
  for (const raw of [
    null,
    undefined,
    "",
    "   ",
    "0",
    "-30",
    "1.5",
    "abc",
    "15분",
    "Wed, 21 Oct 2026 07:28:00 GMT",
    "1e3",
  ]) {
    assert.equal(parseRetryAfter(raw), undefined, JSON.stringify(raw));
  }
});

test("안내 — 초를 분으로 올린다", () => {
  assert.equal(lockedLoginMessage(60), "로그인이 잠시 막혔습니다. 1분 뒤 다시 시도해 주세요.");
  assert.equal(lockedLoginMessage(61), "로그인이 잠시 막혔습니다. 2분 뒤 다시 시도해 주세요.");
  assert.equal(lockedLoginMessage(900), "로그인이 잠시 막혔습니다. 15분 뒤 다시 시도해 주세요.");
});

test("안내 — 1분 미만은 「잠시 뒤」", () => {
  assert.equal(lockedLoginMessage(1), "로그인이 잠시 막혔습니다. 잠시 뒤 다시 시도해 주세요.");
  assert.equal(lockedLoginMessage(59), "로그인이 잠시 막혔습니다. 잠시 뒤 다시 시도해 주세요.");
});

test("안내 — 값이 없거나 이상하면 원래 문구", () => {
  for (const seconds of [undefined, 0, -5, Number.NaN]) {
    assert.equal(lockedLoginMessage(seconds), LOCKED_FALLBACK, String(seconds));
  }
  assert.equal(lockedLoginMessage(parseRetryAfter("abc")), LOCKED_FALLBACK);
});
