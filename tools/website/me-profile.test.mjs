/**
 * GET /me → 세션 사용자. created_at · providers 는 BE-3(11/18) 뒤부터 오니 있을 때만 쓰고, 없으면 칸을 비워 둔다.
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";

const { toSessionUserFromMe, providersOf, hasPasswordSignIn } =
  await import("../../website/src/services/account/meProfile.ts");

const base = { user_id: "u-1", email: "someone@example.test", nickname: "조사관", region: "나주" };

test("created_at(UTC Z) · providers 가 오면 가입일 · 가입 방식을 채운다", () => {
  const user = toSessionUserFromMe({ ...base, created_at: "2026-11-01T03:04:05Z", providers: ["google", "local"] });
  assert.equal(user.joinedAt, Date.UTC(2026, 10, 1, 3, 4, 5));
  assert.deepEqual(user.providers, ["google", "local"]);
  // 칩 한 개짜리 옛 칸은 첫 것
  assert.equal(user.provider, "google");
});

test("옛 서버(둘 다 없음)면 그 칸의 키 자체가 없다 — 펼쳐 넣어도 이 탭의 값을 undefined 로 덮지 않는다", () => {
  const fromMe = toSessionUserFromMe(base);
  assert.equal("joinedAt" in fromMe, false);
  assert.equal("providers" in fromMe, false);
  const local = { id: "u-1", email: base.email, name: "옛이름", joinedAt: 123, provider: "naver" };
  const merged = { ...local, ...fromMe };
  assert.equal(merged.joinedAt, 123);
  assert.equal(merged.provider, "naver");
  assert.equal(merged.name, "조사관");
  assert.equal(merged.region, "나주");
});

test("region 이 null 이면 빈 글, 문자열이 아닌 provider 는 걸러 낸다", () => {
  const user = toSessionUserFromMe({ ...base, region: null, providers: ["local", 7, null] });
  assert.equal(user.region, "");
  assert.deepEqual(user.providers, ["local"]);
});

test("providersOf — providers 가 있으면 그것, 없으면 로그인 때 받은 provider 하나, 둘 다 없으면 빈 목록", () => {
  assert.deepEqual(providersOf({ providers: ["google", "local"], provider: "naver" }), ["google", "local"]);
  assert.deepEqual(providersOf({ provider: "naver" }), ["naver"]);
  assert.deepEqual(providersOf({}), []);
});

test("hasPasswordSignIn — local 이 있어야 비밀번호 계정, 소셜만이면 false, 모르면 undefined", () => {
  assert.equal(hasPasswordSignIn({ providers: ["local"] }), true);
  assert.equal(hasPasswordSignIn({ providers: ["google", "local"] }), true);
  assert.equal(hasPasswordSignIn({ providers: ["google"] }), false);
  assert.equal(hasPasswordSignIn({ provider: "naver" }), false);
  assert.equal(hasPasswordSignIn({}), undefined);
});
