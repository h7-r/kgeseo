/**
 * 약관 판 — 웹이 게시하고 가입 때 보내는 판과 서버가 받아 기록하는 판이 같은지 본다.
 * 어긋나면 이메일 가입이 전부 409 terms_version_mismatch 로 막힌다(11/19 미르: 서버 기록을 게시한 판으로 맞춤).
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const webVersion = read("website/src/data/termsVersion.ts").match(/TERMS_VERSION = "([^"]+)"/)?.[1];
const serverVersion = read("backend/app/core/terms.py").match(/CURRENT_TERMS_VERSION = "([^"]+)"/)?.[1];

test("웹이 게시한 약관 판과 서버 상수가 같다", () => {
  assert.ok(webVersion, "웹 약관 판을 찾지 못했다");
  assert.equal(serverVersion, webVersion);
});

test("서버 기록 칸(VARCHAR 32)에 들어가는 길이다", () => {
  assert.ok(webVersion.length <= 32);
});

test("약관 화면과 가입 요청이 같은 판 상수를 쓴다", () => {
  assert.match(read("website/src/data/terms.ts"), /version: TERMS_VERSION,/);
  assert.match(read("website/src/services/account/authApi.ts"), /from "@\/data\/termsVersion"/);
  assert.match(read("website/src/services/account/authApi.ts"), /terms_version: TERMS_VERSION,/);
});
