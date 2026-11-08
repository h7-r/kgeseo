// 입장권 검증 — 위조·만료·대상 틀림·재시작 이전 발급(설계 3절, 지시문 1단계 시험)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createTicketVerifier } from "../src/ticket.js";
import { makeTicket, TEST_SECRET } from "./helpers.js";

const now = Math.floor(Date.now() / 1000);
const verifier = createTicketVerifier({ secret: TEST_SECRET, processStartSec: now - 100 });
const reasonOf = async (token: unknown) => {
  const check = await verifier(token);
  return check.ok ? "ok" : check.reason;
};
const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("입장권 검증", () => {
  it("정상 티켓은 sub·nickname·jti·exp 를 돌려준다", async () => {
    const check = await verifier(await makeTicket({ sub: "u1", nickname: "닉", jti: "j1", iat: now, exp: now + 60 }));
    assert.deepEqual(check, { ok: true, ticket: { sub: "u1", nickname: "닉", jti: "j1", exp: now + 60 } });
  });
  it("다른 키로 서명(위조)", async () => {
    const other = new TextEncoder().encode("dev-another-secret-that-is-long-enough!!");
    assert.equal(await reasonOf(await makeTicket({ secret: other })), "TICKET_INVALID");
  });
  it("본문을 바꾸면 서명이 안 맞는다", async () => {
    const [header, , signature] = (await makeTicket()).split(".");
    const forged = `${header}.${base64url({ sub: "admin", nickname: "x", jti: "j", iat: now, exp: now + 60, aud: "waegok-lobby" })}.${signature}`;
    assert.equal(await reasonOf(forged), "TICKET_INVALID");
  });
  it("alg none 은 받지 않는다", async () => {
    const unsigned = `${base64url({ alg: "none", typ: "JWT" })}.${base64url({ sub: "u", nickname: "n", jti: "j", iat: now, exp: now + 60, aud: "waegok-lobby" })}.`;
    assert.equal(await reasonOf(unsigned), "TICKET_INVALID");
  });
  it("HS256 이 아닌 알고리즘은 받지 않는다", async () => {
    assert.equal(await reasonOf(await makeTicket({ alg: "HS384" })), "TICKET_INVALID");
  });
  it("대상(aud)이 틀림", async () => {
    assert.equal(await reasonOf(await makeTicket({ aud: "someone-else" })), "TICKET_INVALID");
  });
  it("만료", async () => {
    assert.equal(await reasonOf(await makeTicket({ iat: now - 90, exp: now - 30 })), "TICKET_EXPIRED");
  });
  it("닉네임이 없거나 너무 길다", async () => {
    assert.equal(await reasonOf(await makeTicket({ nickname: "" })), "TICKET_INVALID");
    assert.equal(await reasonOf(await makeTicket({ nickname: "가".repeat(41) })), "TICKET_INVALID");
  });
  it("exp 가 iat 보다 이르다", async () => {
    assert.equal(await reasonOf(await makeTicket({ iat: now, exp: now - 1 })), "TICKET_EXPIRED");
  });
  it("발급 시각이 미래(5초 넘게)", async () => {
    assert.equal(await reasonOf(await makeTicket({ iat: now + 30, exp: now + 90 })), "TICKET_INVALID");
  });
  it("유효 시간이 120초를 넘는 티켓", async () => {
    assert.equal(await reasonOf(await makeTicket({ iat: now, exp: now + 3600 })), "TICKET_INVALID");
  });
  it("문자열이 아니거나 비었다", async () => {
    assert.equal(await reasonOf(undefined), "TICKET_INVALID");
    assert.equal(await reasonOf(""), "TICKET_INVALID");
    assert.equal(await reasonOf("not.a.jwt"), "TICKET_INVALID");
  });
});

describe("재시작 기준(3.2절)", () => {
  const start = now;
  const restarted = createTicketVerifier({ secret: TEST_SECRET, processStartSec: start });
  const reason = async (iat: number) => {
    const check = await restarted(await makeTicket({ iat, exp: iat + 60 }));
    return check.ok ? "ok" : check.reason;
  };
  it("재시작 이전에 발급된 티켓은 거절", async () => assert.equal(await reason(start - 5), "TICKET_STALE"));
  it("같은 초에 발급된 티켓도 거절(일시적 실패)", async () => assert.equal(await reason(start), "TICKET_STALE"));
  it("재시작 뒤 발급된 티켓은 통과", async () => assert.equal(await reason(start + 1), "ok"));
});
