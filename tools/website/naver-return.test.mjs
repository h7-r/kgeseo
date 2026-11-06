/**
 * 네이버 로그인 뒤 돌아갈 곳(returnTo)과 OAuth state 의 한 번 쓰기 규칙을 본다.
 * 웹사이트 모듈은 TS · `@/` 별칭 · import.meta.env 를 쓰므로 Vite 개발 서버로 읽는다(새 의존성 없음).
 *
 *   npm run web:test
 */
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

process.env.VITE_NAVER_CLIENT_ID = "test-naver-client";

const root = fileURLToPath(new URL("../../website", import.meta.url));
const server = await createServer({
  root,
  configFile: `${root}/vite.config.ts`,
  server: { middlewareMode: true, hmr: false },
  logLevel: "silent",
});
after(() => server.close());

const STATE_KEY = "waegok.oauthState";
const storage = new Map();
globalThis.sessionStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.window = { location: { origin: "http://localhost:5175", href: "" } };

const naver = await server.ssrLoadModule("/src/services/account/naverAuth.ts");
const social = await server.ssrLoadModule("/src/services/account/socialAuthApi.ts");

const USER = {
  user: {
    user_id: "u-1",
    email: "a@example.com",
    nickname: "모험가",
    region: null,
    created_at: "2026-11-04T00:00:00",
    provider: "naver",
  },
};
const ONBOARDING = {
  result: "onboarding_required",
  onboarding_token: "tok",
  expires_in: 600,
  suggested_nickname: "모험가",
  terms_version: "2026-09",
};

let fetchCalls = 0;
function answer(status, body) {
  fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
}

/** 네이버로 떠났다가 돌아온 콜백 질의를 만든다. */
function leaveForNaver(returnTo) {
  assert.equal(naver.startNaverLogin(returnTo), "");
  const authorize = new URL(globalThis.window.location.href);
  assert.equal(authorize.origin, "https://nid.naver.com");
  assert.equal(authorize.searchParams.get("redirect_uri"), "http://localhost:5175/로그인/콜백");
  return authorize.searchParams.get("state");
}

const callback = (state, extra = {}) => new URLSearchParams({ code: "code-1", state, ...extra });

beforeEach(() => {
  storage.clear();
  answer(200, USER);
});

test("기존 회원: 게임 시작에서 온 로그인은 /play 로 돌아간다", async () => {
  const state = leaveForNaver("/play");
  const { result, returnTo } = await naver.signInWithNaverCallback(callback(state));
  assert.equal(result.kind, "signedIn");
  assert.equal(returnTo, "/play");
  assert.equal(storage.has(STATE_KEY), false);
});

test("신규 회원: returnTo 를 가입 증표와 함께 넘겨 가입 뒤 /play 로 간다", async () => {
  answer(200, ONBOARDING);
  const state = leaveForNaver("/play");
  const { result, returnTo } = await naver.signInWithNaverCallback(callback(state));
  assert.equal(result.kind, "onboardingRequired");
  assert.equal(returnTo, "/play");
  // SocialCallbackPage 가 하는 일. SocialOnboardingPage 는 readOnboarding().returnTo 로 간다.
  social.holdOnboarding(result.onboarding, returnTo);
  assert.equal(social.readOnboarding().returnTo, "/play");
  social.clearOnboarding();
});

test("홈에서 시작한 로그인은 돌아갈 곳이 없어 기본 경로로 간다", async () => {
  const state = leaveForNaver();
  const { returnTo } = await naver.signInWithNaverCallback(callback(state));
  assert.equal(returnTo, null);
});

test("사이트 밖 · 우회 · 로그인 화면 주소는 버리고 로그인은 이어 간다", async () => {
  const rejected = [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/\t/evil.example",
    "/ /evil.example",
    "evil",
    "",
    "/login?next=/play",
    "/signup",
    "/signup/social",
    "/로그인/콜백",
    "/%EB%A1%9C%EA%B7%B8%EC%9D%B8/%EC%BD%9C%EB%B0%B1",
    "/%E0%A4%A",
  ];
  for (const value of rejected) {
    storage.clear();
    const state = leaveForNaver(value);
    assert.equal(JSON.parse(storage.get(STATE_KEY)).returnTo, null, value);
    const { returnTo } = await naver.signInWithNaverCallback(callback(state));
    assert.equal(returnTo, null, value);
  }
  storage.clear();
  const state = leaveForNaver("/pricing?tab=plan#top");
  assert.equal((await naver.signInWithNaverCallback(callback(state))).returnTo, "/pricing?tab=plan#top");
});

test("저장소에서 바뀐 returnTo 도 콜백에서 다시 거른다", async () => {
  const state = leaveForNaver("/play");
  storage.set(STATE_KEY, JSON.stringify({ state, returnTo: "https://evil.example" }));
  assert.equal((await naver.signInWithNaverCallback(callback(state))).returnTo, null);
});

test("state 가 다르면 서버에 묻지 않고 거부하고, 남은 state 도 지운다", async () => {
  leaveForNaver("/play");
  await assert.rejects(naver.signInWithNaverCallback(callback("naver.forged")), /올바르지 않습니다/);
  assert.equal(fetchCalls, 0);
  assert.equal(storage.has(STATE_KEY), false);
});

test("같은 콜백이 동시에 두 번 불리면(StrictMode) 요청은 한 번이고 결과는 같다", async () => {
  const state = leaveForNaver("/play");
  const [first, second] = await Promise.all([
    naver.signInWithNaverCallback(callback(state)),
    naver.signInWithNaverCallback(callback(state)),
  ]);
  assert.equal(fetchCalls, 1);
  assert.equal(first.returnTo, "/play");
  assert.equal(second.returnTo, "/play");
});

test("끝난 콜백을 새로고침하면 state 가 없어 거부한다", async () => {
  const state = leaveForNaver("/play");
  await naver.signInWithNaverCallback(callback(state));
  await assert.rejects(naver.signInWithNaverCallback(callback(state)), /올바르지 않습니다/);
  assert.equal(fetchCalls, 1);
});

test("취소하고 돌아오면 취소 문구를 내고 남은 state 를 지운다", async () => {
  const state = leaveForNaver("/play");
  const cancelled = new URLSearchParams({ state, error: "access_denied" });
  await assert.rejects(naver.signInWithNaverCallback(cancelled), /취소/);
  // StrictMode 로 한 번 더 불려도 같은 문구다.
  await assert.rejects(naver.signInWithNaverCallback(cancelled), /취소/);
  assert.equal(storage.has(STATE_KEY), false);
  assert.equal(fetchCalls, 0);
});

test("서버가 거절하면 state 는 이미 쓰여 다시 시도할 수 없다", async () => {
  answer(401, { detail: "Invalid Naver authorization code." });
  const state = leaveForNaver("/play");
  await assert.rejects(naver.signInWithNaverCallback(callback(state)), /올바르지 않습니다/);
  assert.equal(storage.has(STATE_KEY), false);
  answer(200, USER);
  await assert.rejects(naver.signInWithNaverCallback(callback(state)), /올바르지 않습니다/);
  assert.equal(fetchCalls, 0);
});

test("예전 형식(문자열)으로 남은 state 는 쓰지 않는다", async () => {
  storage.set(STATE_KEY, "naver.legacy");
  await assert.rejects(naver.signInWithNaverCallback(callback("naver.legacy")), /올바르지 않습니다/);
  assert.equal(storage.has(STATE_KEY), false);
});
