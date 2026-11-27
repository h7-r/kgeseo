/**
 * 회원 탈퇴 화면 규칙(11/25, 백엔드 계약 account_withdrawal_v0.2 §11).
 * - 서버 거절 code 를 화면 문장으로(invalid_password · login_locked + Retry-After · admin_cannot_withdraw · reauth_required)
 * - 계정 설정에서 탈퇴 · 처리 정지 요청이 「준비 중」이 아니라 실제로 눌린다
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

const { withdrawAccount } = await server.ssrLoadModule("/src/services/account/withdrawal.ts");
const { MY_PAGE_CONTENT } = await server.ssrLoadModule("/src/data/myPage.ts");

let lastBody;
function answer(status, body, headers = {}) {
  globalThis.fetch = async (url, init) => {
    lastBody = { url: String(url), body: JSON.parse(init.body) };
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  };
}
const detail = (code) => ({ detail: { code, message: "server" } });

test("성공은 204, 비밀번호를 실어 보낸다", async () => {
  answer(204, null);
  assert.deepEqual(await withdrawAccount("Zebra-Moon-2491"), { ok: true });
  assert.match(lastBody.url, /\/api\/v1\/me\/withdrawal$/);
  assert.deepEqual(lastBody.body, { password: "Zebra-Moon-2491" });
});

test("거절 code 마다 화면 문장", async () => {
  answer(401, detail("invalid_password"));
  let result = await withdrawAccount("x");
  assert.equal(result.field, "password");
  assert.match(result.reason, /비밀번호가 맞지 않습니다/);

  answer(403, detail("admin_cannot_withdraw"));
  assert.match((await withdrawAccount("x")).reason, /관리자 계정/);
  answer(403, detail("reauth_required"));
  assert.match((await withdrawAccount("")).reason, /1:1 문의/);
  assert.deepEqual(lastBody.body, {});

  answer(429, detail("login_locked"), { "Retry-After": "300" });
  assert.match((await withdrawAccount("x")).reason, /5분/);
  answer(401, { detail: "Login required." });
  assert.match((await withdrawAccount("x")).reason, /다시 로그인/);
});

test("계정 설정의 탈퇴 · 처리 정지 요청은 눌리는 항목이다", () => {
  const items = MY_PAGE_CONTENT.account.groups.flatMap((group) => group.items);
  assert.equal(items.find((item) => item.label === "회원 탈퇴").action, "withdraw");
  assert.equal(items.find((item) => item.label === "개인정보 처리 정지").action, "requestByInquiry");
  const modal = readFileSync(new URL("../../website/src/sections/myPage/WithdrawModal.tsx", import.meta.url), "utf8");
  // 계약 §11 의 탈퇴 전 안내 셋
  for (const phrase of ["7일 안", "기록은 이어지지 않습니다", "로그인하지 않고 보낸 문의"])
    assert.match(modal, new RegExp(phrase));
});

test("검토 반영 — 탈퇴는 204 즉시 로그아웃 · 작별 안내는 홈에서, 세션 끝(401)이면 화면 로그인도 거둔다", () => {
  const read = (path) => readFileSync(new URL(`../../website/src/${path}`, import.meta.url), "utf8");
  const modal = read("sections/myPage/WithdrawModal.tsx");
  assert.doesNotMatch(modal, /isDone|탈퇴가 끝났습니다/);
  assert.match(modal, /onWithdrawn\(\);/);
  for (const path of ["sections/myPage/MyPagePanel.tsx", "mobile/MobileAccountSettings.tsx"]) {
    const source = read(path);
    assert.match(source, /navigateWithState\(ROUTES\.home, \{ state: WITHDRAWN_STATE \}\)/, path);
    assert.match(source, /endLocalSession\(\)/, path);
  }
  assert.match(read("App.tsx"), /<WithdrawnNotice \/>/);
  assert.match(read("services/account/withdrawal.ts"), /endLocalSession\(\)/);
  assert.match(read("services/account/passwordApi.ts"), /endLocalSession\(\)/);
  // 옛 브라우저 계정 저장소는 부팅 때 지운다
  assert.match(read("main.tsx"), /forgetOldBrowserAccountStore\(\)/);
  assert.match(read("services/account/db.ts"), /deleteDatabase\(name\)/);
});
