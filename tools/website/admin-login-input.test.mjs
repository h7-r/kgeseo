/**
 * 관리자 로그인 422 안내 — 서버 code 별로 붙는 칸과 문구. 모르는 code 는 중립 문구(점검 L9).
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";

const { loginInputError, INPUT_FALLBACK } = await import("../../website/src/admin/lib/loginInput.ts");

test("invalid_password — 비밀번호 칸에 비밀번호 문구(실제로 닿는 422 는 128자 초과)", () => {
  assert.deepEqual(loginInputError("invalid_password"), {
    field: "password",
    message: "비밀번호 형식을 다시 확인해 주세요.",
  });
});

test("invalid_email — 이메일 칸에 이메일 문구", () => {
  assert.deepEqual(loginInputError("invalid_email"), { field: "email", message: "이메일 형식을 다시 확인해 주세요." });
});

test("invalid_input · 없는 code · 모르는 code — 중립 문구, 「이메일 형식」으로 접지 않는다", () => {
  for (const code of ["invalid_input", undefined, "", "something_new"]) {
    const error = loginInputError(code);
    assert.deepEqual(error, INPUT_FALLBACK, JSON.stringify(code));
    assert.equal(error.message, "입력값을 다시 확인해 주세요.");
    assert.ok(!error.message.includes("이메일 형식"));
  }
});
