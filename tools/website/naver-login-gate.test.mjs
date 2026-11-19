/**
 * 네이버 로그인 문지기(naverLoginGate) — 검수 전엔 닫혀 있고, ?naver=preview 를 단 탭만 열리며,
 * VITE_NAVER_LOGIN=open 이면 모두에게 열리는지 본다. 모듈은 Vite 개발 서버로 읽는다(naver-return.test 와 같은 방식).
 *
 *   npm run web:test
 */
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../website", import.meta.url));
const GATE = "/src/services/account/naverLoginGate.ts";

async function loadGate(env) {
  const saved = process.env.VITE_NAVER_LOGIN;
  if (env === undefined) delete process.env.VITE_NAVER_LOGIN;
  else process.env.VITE_NAVER_LOGIN = env;
  const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { middlewareMode: true, hmr: false }, logLevel: "silent" });
  if (saved === undefined) delete process.env.VITE_NAVER_LOGIN;
  else process.env.VITE_NAVER_LOGIN = saved;
  return { gate: await server.ssrLoadModule(GATE), server };
}

const storage = new Map();
globalThis.sessionStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const setUrl = (search) => {
  globalThis.window = { location: { origin: "http://localhost:5175", search, href: "" } };
};

const closed = await loadGate(undefined);
const open = await loadGate("open");
after(() => Promise.all([closed.server.close(), open.server.close()]));
beforeEach(() => {
  storage.clear();
  setUrl("");
});

test("검수 전: 주소에 표식이 없으면 닫혀 있다", () => {
  assert.equal(closed.gate.isNaverLoginOpen(), false);
  assert.equal(storage.size, 0, "닫혀 있을 땐 저장소에 아무것도 남기지 않는다");
});

test("?naver=preview 를 달면 열리고, 이 탭 저장소에 표식이 남아 다음 화면에서도 열린다", () => {
  setUrl("?naver=preview");
  assert.equal(closed.gate.isNaverLoginOpen(), true);
  assert.equal(storage.get("waegok.naverPreview"), "1");
  setUrl("");
  assert.equal(closed.gate.isNaverLoginOpen(), true, "표식만 있어도 열린다");
});

test("?naver=다른값 은 열지 않는다", () => {
  setUrl("?naver=on");
  assert.equal(closed.gate.isNaverLoginOpen(), false);
});

test("VITE_NAVER_LOGIN=open 이면 표식 없이도 모두에게 열린다", () => {
  assert.equal(open.gate.isNaverLoginOpen(), true);
  assert.equal(storage.size, 0);
});

test("닫혀 있을 때 안내는 Google·이메일을 권한다", () => {
  assert.match(closed.gate.NAVER_LOGIN_PENDING_MESSAGE, /검수.*Google.*이메일/);
});
