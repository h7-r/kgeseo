/**
 * 비밀번호 찾기 · 변경 화면 규칙(11/25, 백엔드 계약 password_reset_v0.1).
 * - 서버 응답을 화면 결과(칸 · 문장 · 만료)로 바꾸는 규칙
 * - 세 화면이 이어받는 값: 코드는 두지 않고, 코드를 맞힌 뒤 받은 증표만 10분 둔다
 * - 「준비 중」 흉내가 되살아나지 않는다
 * 웹사이트 모듈은 TS · `@/` 별칭 · import.meta.env 를 쓰므로 Vite 개발 서버로 읽는다.
 *
 *   npm run web:test
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// 탭 저장소 흉내
const store = new Map();
globalThis.sessionStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const api = await server.ssrLoadModule("/src/services/account/passwordApi.ts");
const reset = await server.ssrLoadModule("/src/services/passwordReset.ts");

const calls = [];
function answer(status, body, headers = {}) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), credentials: init.credentials });
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  };
}
const detail = (code, message) => ({ detail: { code, message } });

test("① 코드 요청 — 성공 · 메일 꺼짐(503 문장 그대로) · 형식 오류는 이메일 칸", async () => {
  answer(200, { status: "accepted" });
  assert.deepEqual(await api.requestResetCode("a@example.com"), { ok: true });
  assert.match(calls.at(-1).url, /\/api\/v1\/auth\/password-reset\/request$/);
  assert.equal(calls.at(-1).credentials, "include");

  answer(503, detail("mail_unavailable", "지금은 메일을 보낼 수 없습니다. 고객센터로 문의해 주세요."));
  let result = await api.requestResetCode("a@example.com");
  assert.equal(result.ok, false);
  assert.match(result.reason, /고객센터/);
  assert.equal(result.field, undefined);

  answer(422, detail("invalid_email", "올바른 이메일 형식이 아닙니다."));
  result = await api.requestResetCode("not-an-email");
  assert.equal(result.field, "email");

  answer(429, detail("rate_limited", "요청이 너무 많습니다."), { "Retry-After": "30" });
  result = await api.requestResetCode("a@example.com");
  assert.match(result.reason, /30초/);
});

test("② 코드 확인 — 증표를 받고, 틀리면 코드 칸에 서버 문장", async () => {
  answer(200, { reset_token: "tok-123" });
  assert.deepEqual(await api.confirmResetCode("a@example.com", "123456"), { ok: true, resetToken: "tok-123" });
  assert.deepEqual(calls.at(-1).body, { email: "a@example.com", code: "123456" });

  answer(401, detail("invalid_reset_code", "코드가 맞지 않거나 만료되었습니다. 새 코드를 받아 다시 시도해 주세요."));
  const result = await api.confirmResetCode("a@example.com", "000000");
  assert.equal(result.field, "code");
  assert.match(result.reason, /새 코드/);

  // 모양이 어긋난 성공 답은 성공으로 치지 않는다
  answer(200, {});
  assert.equal((await api.confirmResetCode("a@example.com", "123456")).ok, false);
});

test("③ 새 비밀번호 — 성공 · 규칙 위반은 새 비밀번호 칸 · 증표 만료는 expired", async () => {
  answer(204, null);
  assert.deepEqual(await api.completeReset("tok-123", "Harbor-Lamp-7316"), { ok: true });
  assert.deepEqual(calls.at(-1).body, { reset_token: "tok-123", new_password: "Harbor-Lamp-7316" });

  answer(422, detail("invalid_password", "비밀번호 형식을 확인해 주세요."));
  let result = await api.completeReset("tok-123", "short");
  assert.equal(result.field, "newPassword");
  assert.equal(result.expired, false);

  answer(401, detail("invalid_reset_token", "재설정 시간이 지났습니다. 코드를 다시 받아 주세요."));
  result = await api.completeReset("tok-123", "Harbor-Lamp-7316");
  assert.equal(result.expired, true);
  assert.equal(result.field, undefined);
});

test("변경 — 지금 비밀번호 틀림 · 같은 비밀번호 · 소셜 전용 · 세션 끝남 · 잠김", async () => {
  answer(204, null);
  assert.deepEqual(await api.changePassword("Zebra-Moon-2491", "Harbor-Lamp-7316"), { ok: true });
  assert.match(calls.at(-1).url, /\/api\/v1\/me\/password$/);
  assert.deepEqual(calls.at(-1).body, { current_password: "Zebra-Moon-2491", new_password: "Harbor-Lamp-7316" });

  answer(401, detail("invalid_password", "현재 비밀번호가 맞지 않습니다."));
  assert.equal((await api.changePassword("x", "Harbor-Lamp-7316")).field, "current");
  answer(422, detail("invalid_password", "비밀번호 형식을 확인해 주세요."));
  assert.equal((await api.changePassword("x", "short")).field, "next");
  answer(422, detail("same_password", "현재와 다른 비밀번호를 써 주세요."));
  assert.equal((await api.changePassword("x", "x")).field, "next");
  answer(403, detail("no_local_password", "소셜 로그인으로 가입한 계정은 비밀번호가 없습니다."));
  let result = await api.changePassword("x", "Harbor-Lamp-7316");
  assert.equal(result.field, undefined);
  assert.match(result.reason, /소셜/);
  answer(401, { detail: "Login required." });
  result = await api.changePassword("x", "Harbor-Lamp-7316");
  assert.match(result.reason, /다시 로그인/);
  answer(429, detail("login_locked", "잠겼습니다"), { "Retry-After": "120" });
  result = await api.changePassword("x", "Harbor-Lamp-7316");
  assert.equal(result.field, undefined);
  assert.match(result.reason, /2분/);
});

test("서버가 꺼져 있으면 던지지 않고 통신 실패 문장", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("network");
  };
  const result = await api.requestResetCode("a@example.com");
  assert.equal(result.ok, false);
  assert.match(result.reason, /통신하지 못했습니다/);
});

test("세 화면이 이어받는 값 — 코드는 두지 않고, 증표는 10분 뒤 사라진다", () => {
  store.clear();
  assert.equal(reset.readResetState(), null);
  reset.rememberResetEmail(" A@Example.com ");
  const sent = reset.readResetState();
  assert.equal(sent.email, "a@example.com");
  assert.equal(sent.resetToken, null);
  // 막 보냈으면 「다시 받기」는 60초 기다린다(서버 재발송 대기와 같은 셈) · 다른 이메일은 바로
  assert.ok(reset.resendWaitSeconds("a@example.com") > 55);
  assert.equal(reset.resendWaitSeconds("b@example.com"), 0);
  reset.rememberResetToken("a@example.com", "tok-1");
  assert.equal(reset.readResetState().resetToken, "tok-1");
  assert.deepEqual(Object.keys(JSON.parse(store.get("waegok.passwordReset"))).sort(), [
    "email",
    "requestedAt",
    "resetToken",
    "tokenExpiresAt",
  ]);

  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60 * 1000;
  try {
    const state = reset.readResetState();
    assert.equal(state.resetToken, null);
    assert.equal(state.email, "a@example.com");
    assert.equal(reset.resendWaitSeconds("a@example.com"), 0);
  } finally {
    Date.now = realNow;
  }

  // 옛 판(코드를 담던 모양)은 진행 중인 재설정이 없는 것으로 본다
  store.set("waegok.passwordReset", JSON.stringify({ email: "a@example.com", code: "123456", verified: true }));
  assert.equal(reset.readResetState(), null);
  reset.clearResetState();
  assert.equal(store.size, 0);
});

test("「준비 중」 흉내와 화면에 코드를 보여 주던 상자가 되살아나지 않는다", () => {
  const read = (path) => readFileSync(new URL(`../../website/src/${path}`, import.meta.url), "utf8");
  const form = read("sections/auth/AuthForm.tsx");
  assert.doesNotMatch(form, /IS_ACCOUNT_MANAGEMENT_READY|비밀번호 찾기 · 준비 중|메일 대신 여기에 인증코드/);
  assert.doesNotMatch(read("App.tsx"), /IS_ACCOUNT_MANAGEMENT_READY/);
  assert.doesNotMatch(read("sections/myPage/MyPageTabs.tsx"), /IS_ACCOUNT_MANAGEMENT_READY/);
  assert.doesNotMatch(read("services/account/manageAccount.ts"), /indexedDB|PBKDF2|readAccount/);
  assert.match(read("data/support.ts"), /비밀번호 찾기」를 누르면 가입한 이메일로 인증코드 6자리/);
  // 찾기를 마치면 화면도 로그아웃(서버가 모든 세션을 끊었다) · 「다시 받기」는 단정하지 않는다
  assert.match(form, /endLocalSession\(\);/);
  assert.match(form, /가입된 이메일이면 새 인증코드를 보냈습니다/);
});
