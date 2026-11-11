// 로그인 필수 문(shared/playLoginGate) — 켜기 조건 · /me 판정 · 로그인 주소
import assert from "node:assert/strict";
import { test } from "node:test";

import { checkLogin, isLoginGateEnabled, loginPageUrl, passLoginGate } from "../../shared/playLoginGate.ts";

const reply = (status: number | "throw") =>
  (async () => {
    if (status === "throw") throw new TypeError("fetch failed");
    return { status, ok: status >= 200 && status < 300 } as Response;
  }) as unknown as typeof fetch;

test("운영 빌드에서만 켜고, 시험 · 되돌리기 스위치를 듣는다", () => {
  assert.equal(isLoginGateEnabled({ prod: true }), true);
  assert.equal(isLoginGateEnabled({ prod: false }), false);
  assert.equal(isLoginGateEnabled({ prod: false, requireLogin: "1" }), true);
  assert.equal(isLoginGateEnabled({ prod: true, allowGuestPlay: "1" }), false);
});

test("/me 401 · 403 은 로그인 안 함, 200 은 로그인, 그 밖 · 연결 실패는 모름(통과)", async () => {
  assert.equal(await checkLogin("", reply(401)), "out");
  assert.equal(await checkLogin("", reply(403)), "out");
  assert.equal(await checkLogin("", reply(200)), "in");
  assert.equal(await checkLogin("", reply(503)), "unknown");
  assert.equal(await checkLogin("", reply("throw")), "unknown");
});

test("로그인 화면은 마치면 /play 로 이어진다", () => {
  assert.equal(loginPageUrl("https://www.k-escape.com"), "https://www.k-escape.com/login?next=%2Fplay");
});

test("로그인 안 했을 때만 막는다 — 꺼져 있거나 서버가 아프면 통과", async () => {
  const container = { ownerDocument: null } as unknown as HTMLElement;
  assert.equal(await passLoginGate(container, { enabled: false, apiOrigin: "", siteUrl: "https://x.test", fetchImpl: reply(401) }), true);
  assert.equal(await passLoginGate(container, { enabled: true, apiOrigin: "", siteUrl: "https://x.test", fetchImpl: reply(200) }), true);
  assert.equal(await passLoginGate(container, { enabled: true, apiOrigin: "", siteUrl: "https://x.test", fetchImpl: reply(500) }), true);
});

test("확인이 늦으면 「불러오는 중」을 보였다가 끝나면 걷는다(Codex 리뷰)", async () => {
  const appended: Array<{ removed: boolean }> = [];
  const doc = {
    createElement: () => {
      const node = { removed: false, setAttribute() {}, textContent: "", remove() { node.removed = true; } };
      return node;
    },
    body: { append: (node: { removed: boolean }) => appended.push(node) },
  };
  const container = { ownerDocument: doc } as unknown as HTMLElement;
  const slow = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { status: 200, ok: true } as Response;
  }) as unknown as typeof fetch;
  assert.equal(await passLoginGate(container, { enabled: true, apiOrigin: "", siteUrl: "https://x.test", fetchImpl: slow }), true);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].removed, true);
});
