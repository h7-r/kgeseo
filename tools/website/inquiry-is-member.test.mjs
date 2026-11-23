/**
 * 문의 접수 완료 안내는 서버가 실제로 저장한 결과(`is_member`)로 고른다(11/23, 서버 #199 의 화면 짝).
 * 화면은 로그인으로 보이는데 서버 세션이 끝났으면 문의는 비회원으로 저장된다 — 그때 「마이페이지에서 볼 수 있습니다」를 보이면 안 된다.
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

const inquiries = await server.ssrLoadModule("/src/services/inquiries.ts");

function answer(status, body) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const INPUT = { category: "etc", title: "제목", body: "내용", email: "a@example.com" };
const CREATED = { id: "i-1", number: "INQ-20261123-00001", created_at: "2026-11-23T05:10:00" };

test("접수 응답의 is_member 를 싣는다 — 값이 없으면(옛 서버) null", async () => {
  answer(201, { ...CREATED, is_member: true });
  assert.equal((await inquiries.submitInquiry(INPUT)).isMember, true);
  answer(201, { ...CREATED, is_member: false });
  assert.equal((await inquiries.submitInquiry(INPUT)).isMember, false);
  answer(201, CREATED);
  const old = await inquiries.submitInquiry(INPUT);
  assert.equal(old.ok, true);
  assert.equal(old.isMember, null);
  answer(201, { ...CREATED, is_member: "yes" });
  assert.equal((await inquiries.submitInquiry(INPUT)).isMember, null, "boolean 이 아니면 믿지 않는다");
});

test("안내 대상 — 서버가 회원으로 저장했으면 화면 표시와 상관없이 「내 문의」 안내", () => {
  assert.deepEqual(inquiries.receiptAudience(true, true, false), { isMember: true, isSessionExpired: false });
  assert.deepEqual(inquiries.receiptAudience(true, false, false), { isMember: true, isSessionExpired: false });
});

test("안내 대상 — 화면은 로그인인데 비회원으로 저장됐으면 만료(이메일 답변 안내 · 로그인 표시 거둠)", () => {
  assert.deepEqual(inquiries.receiptAudience(false, true, false), { isMember: false, isSessionExpired: true });
});

test("안내 대상 — 로그아웃 상태의 비회원 접수 · 시연용 테스트 계정은 만료가 아니다", () => {
  assert.deepEqual(inquiries.receiptAudience(false, false, false), { isMember: false, isSessionExpired: false });
  assert.deepEqual(inquiries.receiptAudience(false, true, true), { isMember: false, isSessionExpired: false });
});

test("안내 대상 — 옛 서버(값 없음)면 지금처럼 화면의 로그인 표시로", () => {
  assert.deepEqual(inquiries.receiptAudience(null, true, false), { isMember: true, isSessionExpired: false });
  assert.deepEqual(inquiries.receiptAudience(null, false, false), { isMember: false, isSessionExpired: false });
});
