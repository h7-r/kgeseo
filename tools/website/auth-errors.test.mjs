/**
 * 가입·소셜 로그인 실패 응답을 화면 문구·칸으로 바꾸는 규칙(11/18).
 * 서버가 { code, message } 로 바꾸는 중이라 옛 모양(영문 문장)과 새 모양(code)을 둘 다 읽어야 한다.
 * 웹사이트 모듈은 TS · `@/` 별칭 · import.meta.env 를 쓰므로 Vite 개발 서버로 읽는다(새 의존성 없음).
 *
 *   npm run web:test
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../website", import.meta.url));
const server = await createServer({
  root,
  configFile: `${root}/vite.config.ts`,
  server: { middlewareMode: true, hmr: false },
  logLevel: "silent",
});
after(() => server.close());

const auth = await server.ssrLoadModule("/src/services/account/authApi.ts");
const social = await server.ssrLoadModule("/src/services/account/socialAuthApi.ts");

/** 다음 fetch 가 이 상태·본문으로 답하게 한다. */
function answer(status, body, headers = {}) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const INPUT = { email: "a@example.com", password: "Aa1!xxxxQ", nickname: "모험가", region: "서울" };

test("409 중복 — 새 모양 code 로 칸을 짚는다", async () => {
  answer(409, { detail: { code: "email_taken", message: "Email already registered." } });
  let result = await auth.signUp(INPUT);
  assert.equal(result.ok, false);
  assert.equal(result.field, "email");
  assert.match(result.reason, /이미 가입된 이메일/);

  answer(409, { detail: { code: "nickname_taken", message: "Nickname already registered." } });
  result = await auth.signUp(INPUT);
  assert.equal(result.field, "nickname");
  assert.match(result.reason, /이미 사용 중인 닉네임/);
});

test("409 중복 — 옛 모양 영문 문장도 같은 칸으로 받는다", async () => {
  answer(409, { detail: "Email already registered." });
  assert.equal((await auth.signUp(INPUT)).field, "email");
  answer(409, { detail: "Nickname already registered." });
  assert.equal((await auth.signUp(INPUT)).field, "nickname");
});

test("409 인데 모르는 code 면 칸을 짚지 않고 상태 코드만 알린다", async () => {
  answer(409, { detail: { code: "something_else", message: "Email already registered." } });
  const result = await auth.signUp(INPUT);
  assert.equal(result.field, undefined);
  assert.match(result.reason, /오류 409/);
});

test("422 code 가 칸을 가리키면 그 칸에 붙인다(invalid_email · invalid_password · invalid_nickname)", async () => {
  const cases = [
    ["invalid_email", "email", /이메일 형식/],
    ["invalid_password", "password", /비밀번호 형식/],
    ["invalid_nickname", "nickname", /사용할 수 없는 닉네임/],
  ];
  for (const [code, field, reason] of cases) {
    answer(422, { detail: { code, message: "server text" } });
    const result = await auth.signUp(INPUT);
    assert.equal(result.field, field, code);
    assert.match(result.reason, reason, code);
  }
});

test("422 칸 없는 code 는 서버 안내 문장을 그대로, 칸은 없다", async () => {
  answer(422, { detail: { code: "invalid_input", message: "입력값을 다시 확인해 주세요." } });
  const result = await auth.signUp(INPUT);
  assert.equal(result.field, undefined);
  assert.equal(result.reason, "입력값을 다시 확인해 주세요.");
});

test("약관 판 불일치(terms_version_mismatch) — 새로고침 안내", async () => {
  answer(409, { detail: { code: "terms_version_mismatch", message: "Terms version mismatch." } });
  const result = await auth.signUp(INPUT);
  assert.equal(result.field, undefined);
  assert.match(result.reason, /약관이 바뀌었습니다.*새로고침/);
});

test("동의 누락 — code 와 옛 문장 둘 다", async () => {
  answer(422, { detail: { code: "consent_required", message: "Required consent is missing." } });
  assert.match((await auth.signUp(INPUT)).reason, /필수 약관 동의/);
  answer(422, { detail: "Required consent is missing." });
  assert.match((await auth.signUp(INPUT)).reason, /필수 약관 동의/);
});

test("중복 확인 — 429 는 제한 오류, 5xx 는 「답 없음」 오류로 던진다(없음으로 기억하지 않게)", async () => {
  answer(429, { detail: { code: "rate_limited", message: "x" } }, { "Retry-After": "30" });
  await assert.rejects(auth.isEmailTaken("a@example.com"), auth.DuplicateCheckLimitedError);
  answer(503, { detail: "down" });
  await assert.rejects(auth.isNicknameTaken("모험가"), auth.DuplicateCheckUnavailableError);
  answer(200, { exists: true });
  assert.equal(await auth.isEmailTaken("a@example.com"), true);
});

test("소셜 실패 문구 — code 가 있으면 code 로, 없으면 상태 코드로", () => {
  const { BackendAuthError, socialAuthErrorMessage } = social;
  // 네이버 계정에 이메일이 없다(BE 401 email_required 예정)
  assert.match(socialAuthErrorMessage("naver", new BackendAuthError(401, "email_required")), /이메일 제공에 동의/);
  // 옛 모양 401 — 인가 코드·프로필 문제라 처음부터 다시
  assert.match(socialAuthErrorMessage("naver", new BackendAuthError(401)), /처음부터 다시/);
  assert.match(socialAuthErrorMessage("naver", new BackendAuthError(401, "invalid_authorization_code")), /처음부터 다시/);
  assert.match(socialAuthErrorMessage("google", new BackendAuthError(409, "account_link_required")), /다른 방법으로 가입/);
  assert.match(socialAuthErrorMessage("google", new BackendAuthError(503)), /준비하고 있습니다/);
  assert.match(socialAuthErrorMessage("naver", new BackendAuthError(502)), /잠시 후 다시/);
  assert.match(socialAuthErrorMessage("naver", new BackendAuthError(null)), /연결할 수 없습니다/);
});
