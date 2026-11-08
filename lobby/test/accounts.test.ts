// 계정 단위(검토 14회차 1) — 숨기기용 가명 ID · 같은 계정 두 번 접속 · 명단 제재
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLOSE_REMOVED, CLOSE_REPLACED, enforceBetaList, OnlineAccounts, parseBetaList, pidFor } from "../src/accounts.js";

const key = new TextEncoder().encode("dev-test-key-for-pid");

class FakeClient {
  closed: number | null = null;
  leave(code?: number) {
    this.closed = code ?? null;
  }
}

describe("pid", () => {
  it("같은 계정은 같은 값, 다른 계정·다른 키는 다른 값, 계정 ID 가 드러나지 않는다", () => {
    const a = pidFor(key, "account-123");
    assert.equal(a, pidFor(key, "account-123"));
    assert.notEqual(a, pidFor(key, "account-124"));
    assert.notEqual(a, pidFor(new TextEncoder().encode("other"), "account-123"));
    assert.match(a, /^[A-Za-z0-9_-]{12}$/);
    assert.ok(!a.includes("123"));
  });
});

describe("OnlineAccounts", () => {
  it("나중 접속이 이긴다 — 먼저 붙은 연결을 4100 으로 끊는다", () => {
    const online = new OnlineAccounts<FakeClient>();
    const first = new FakeClient();
    const second = new FakeClient();
    assert.equal(online.claim("u1", first), false);
    assert.equal(online.claim("u1", second), true);
    assert.equal(first.closed, CLOSE_REPLACED);
    assert.equal(second.closed, null);
    // 먼저 연결이 늦게 나가도 새 연결 등록은 그대로
    online.release("u1", first);
    assert.equal(online.size, 1);
    online.release("u1", second);
    assert.equal(online.size, 0);
  });

  it("끊기 전에 방의 메시지 권한부터 거둔다(교체·제재 모두)", () => {
    const online = new OnlineAccounts<FakeClient>();
    const revoked: string[] = [];
    online.claim("u1", new FakeClient(), () => revoked.push("old"));
    online.claim("u1", new FakeClient(), () => revoked.push("new"));
    assert.deepEqual(revoked, ["old"]);
    online.removeNotIn(new Set());
    assert.deepEqual(revoked, ["old", "new"]);
  });

  it("evict — 붙어 있으면 거두고 끊은 뒤 실제로 나갈 때까지 기다린다(최대 시간까지)", async () => {
    const online = new OnlineAccounts<FakeClient>();
    assert.equal(await online.evict("nobody", 10), false);
    const client = new FakeClient();
    let revoked = false;
    online.claim("u1", client, () => (revoked = true));
    let done = false;
    const waiting = online.evict("u1", 5000).then((result) => {
      done = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(revoked, true);
    assert.equal(client.closed, CLOSE_REPLACED);
    assert.equal(done, false, "나가기 전에는 기다린다");
    online.release("u1", client);
    assert.equal(await waiting, true);
    // 나가지 않는 연결은 최대 시간 뒤 넘어간다
    const stuck = new FakeClient();
    online.claim("u2", stuck);
    const started = Date.now();
    assert.equal(await online.evict("u2", 50), true);
    assert.ok(Date.now() - started >= 45);
  });

  it("명단에 없는 계정만 4101 로 끊는다", () => {
    const online = new OnlineAccounts<FakeClient>();
    const keep = new FakeClient();
    const drop = new FakeClient();
    online.claim("keep", keep);
    online.claim("drop", drop);
    assert.equal(online.removeNotIn(new Set(["keep"])), 1);
    assert.equal(drop.closed, CLOSE_REMOVED);
    assert.equal(keep.closed, null);
    assert.equal(online.size, 1);
  });
});

describe("베타 명단", () => {
  it("백엔드와 같은 형식 — 주석·빈 줄 건너뛰기, loadtest: 도 자격", () => {
    assert.deepEqual([...(parseBetaList("# 주석\n\nu1\r\nloadtest:bot1\n  u2  \n") ?? [])].sort(), ["bot1", "u1", "u2"]);
  });
  it("줄 안 공백·빈 loadtest:·빈 명단은 틀린 것(아무도 끊지 않는다)", () => {
    assert.equal(parseBetaList("u1 u2\n"), null);
    assert.equal(parseBetaList("loadtest:\n"), null);
    assert.equal(parseBetaList("# 다 지움\n\n"), null);
  });
  it("읽기·형식 실패면 끊지 않는다", async () => {
    const online = new OnlineAccounts<FakeClient>();
    const client = new FakeClient();
    online.claim("u1", client);
    assert.deepEqual(
      await enforceBetaList("x", online, async () => {
        throw new Error("EACCES");
      }),
      { error: "unreadable" },
    );
    assert.deepEqual(await enforceBetaList("x", online, async () => ""), { error: "malformed" });
    assert.equal(client.closed, null);
    assert.deepEqual(await enforceBetaList("x", online, async () => "u2\n"), { removed: 1 });
    assert.equal(client.closed, CLOSE_REMOVED);
  });
});
