/**
 * 관리자 로그인 뒤 돌아갈 주소 — 관리자 안의 주소만 받고, 밖으로 새거나 로그인 화면으로 되도는 값은 첫 화면으로 바꾼다.
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";

const { safeAdminNext } = await import("../../website/src/admin/lib/nextPath.ts");
const { buildAdminPaths } = await import("../../website/src/admin/screens.ts");

const paths = buildAdminPaths("/admin");
const next = (value) => safeAdminNext(value, paths.dashboard, paths.login);

test("관리자 안의 주소는 그대로 — 질의도 함께", () => {
  assert.equal(next("/admin"), "/admin");
  assert.equal(next("/admin/users?tab=withdrawn&shown=100"), "/admin/users?tab=withdrawn&shown=100");
  assert.equal(next("/admin/users/abc"), "/admin/users/abc");
  assert.equal(next("/admin/users?q=a b"), "/admin/users?q=a b");
});

test("값이 없으면 첫 화면", () => {
  assert.equal(next(null), "/admin");
  assert.equal(next(""), "/admin");
});

test("다른 사이트로 새는 값은 막는다", () => {
  for (const value of [
    "https://evil.example/admin",
    "//evil.example/admin",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "javascript:alert(1)",
  ]) {
    assert.equal(next(value), "/admin", JSON.stringify(value));
  }
});

test("관리자 밖 같은 사이트 주소도 막는다", () => {
  for (const value of ["/mypage", "/administrator", "/admin/../mypage", "/"]) {
    assert.equal(next(value), "/admin", value);
  }
});

test("로그인 화면으로 되도는 고리를 막는다", () => {
  assert.equal(next("/admin/login"), "/admin");
  assert.equal(next("/admin/login?next=%2Fadmin"), "/admin");
});
