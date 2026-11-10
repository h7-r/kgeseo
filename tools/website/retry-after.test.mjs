/**
 * 웹 로그인 · 가입 · 중복 확인의 429 남은 시간 안내 — Retry-After(정수 초)를 초 · 분으로 알린다.
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";

const { parseRetryAfter, waitPhrase, lockedLoginMessage, rateLimitedMessage } =
  await import("../../website/src/lib/retryAfter.ts");

test("Retry-After — 양의 정수 초만 받는다", () => {
  assert.equal(parseRetryAfter("42"), 42);
  assert.equal(parseRetryAfter(" 900 "), 900);
  for (const raw of [null, undefined, "", "0", "-3", "1.5", "abc", "Wed, 21 Oct 2026 07:28:00 GMT"]) {
    assert.equal(parseRetryAfter(raw), undefined, String(raw));
  }
});

test("1분 미만은 초, 넘으면 분으로 올린다 · 모르면 「잠시 뒤」", () => {
  assert.equal(waitPhrase(1), "1초 뒤");
  assert.equal(waitPhrase(59), "59초 뒤");
  assert.equal(waitPhrase(60), "1분 뒤");
  assert.equal(waitPhrase(61), "2분 뒤");
  assert.equal(waitPhrase(900), "15분 뒤");
  assert.equal(waitPhrase(undefined), "잠시 뒤");
});

test("로그인 잠김과 요청 과다는 다른 말로 알린다", () => {
  assert.equal(lockedLoginMessage(900), "로그인을 여러 번 틀려 잠시 잠겼습니다. 15분 뒤 다시 시도해 주세요.");
  assert.equal(rateLimitedMessage(42), "요청이 많아 잠시 막혔습니다. 42초 뒤 다시 시도해 주세요.");
  assert.notEqual(lockedLoginMessage(30), rateLimitedMessage(30));
});
