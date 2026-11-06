// static onAuth — 출처 확인, usedJti 동시 제출, 같은 요청 재시도 재사용(설계 3절)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAuthenticator } from "../src/authenticate.js";
import { createTicketVerifier } from "../src/ticket.js";
import { UsedJtiRegistry } from "../src/usedJti.js";
import { ALLOWED_ORIGIN, authContext, makeTicket, TEST_SECRET } from "./helpers.js";

function setup(nowSec = () => Date.now() / 1000) {
  const verify = createTicketVerifier({ secret: TEST_SECRET, processStartSec: Math.floor(Date.now() / 1000) - 100 });
  let verifyCalls = 0;
  const countedVerify: typeof verify = (token) => {
    verifyCalls += 1;
    return verify(token);
  };
  const usedJti = new UsedJtiRegistry(nowSec);
  const authenticate = createAuthenticator({
    allowedOrigins: [ALLOWED_ORIGIN],
    verifyTicket: countedVerify,
    usedJti,
    now: nowSec,
  });
  return { authenticate, usedJti, verifyCalls: () => verifyCalls };
}

const reasonOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as Error).message;
  }
};

describe("출처 확인(첫 줄)", () => {
  it("허용하지 않은 출처·출처 없음은 유효 티켓이어도 거절하고 usedJti 가 늘지 않는다", async () => {
    const { authenticate, usedJti, verifyCalls } = setup();
    const token = await makeTicket();
    assert.equal(await reasonOf(authenticate(token, {}, authContext("https://evil.example.com"))), "ORIGIN_NOT_ALLOWED");
    assert.equal(await reasonOf(authenticate(token, {}, authContext(null))), "ORIGIN_NOT_ALLOWED");
    assert.equal(await reasonOf(authenticate(token, {}, undefined)), "ORIGIN_NOT_ALLOWED");
    assert.equal(usedJti.size, 0);
    assert.equal(verifyCalls(), 0);
  });
});

describe("1회 사용", () => {
  it("다른 HTTP 요청(다른 인증 정보 객체)으로 같은 티켓을 내면 TICKET_USED", async () => {
    const { authenticate } = setup();
    const token = await makeTicket();
    assert.equal(await reasonOf(authenticate(token, {}, authContext())), "ok");
    assert.equal(await reasonOf(authenticate(token, {}, authContext())), "TICKET_USED");
  });
  it("같은 티켓을 동시에 10개 요청으로 내면 하나만 통과", async () => {
    const { authenticate, usedJti } = setup();
    const token = await makeTicket();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reasonOf(authenticate(token, {}, authContext()))),
    );
    assert.equal(results.filter((r) => r === "ok").length, 1);
    assert.equal(results.filter((r) => r === "TICKET_USED").length, 9);
    assert.equal(usedJti.size, 1);
  });
  it("같은 요청의 내부 재시도는 저장한 결과를 재사용한다(TICKET_USED 아님, 검증 1번)", async () => {
    const { authenticate, verifyCalls } = setup();
    const token = await makeTicket({ nickname: "재시도" });
    const context = authContext();
    const first = await authenticate(token, {}, context);
    const second = await authenticate(token, {}, context);
    const third = await authenticate(token, {}, context);
    assert.equal(first.nickname, "재시도");
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
    assert.equal(verifyCalls(), 1);
  });
  it("같은 요청 재시도라도 그사이 만료됐으면 거절", async () => {
    let clock = Date.now() / 1000;
    const { authenticate } = setup(() => clock);
    const iat = Math.floor(clock);
    const token = await makeTicket({ iat, exp: iat + 3 });
    const context = authContext();
    assert.equal(await reasonOf(authenticate(token, {}, context)), "ok");
    clock = iat + 4;
    assert.equal(await reasonOf(authenticate(token, {}, context)), "TICKET_EXPIRED");
  });
  it("방이 꽉 찼거나 연결을 포기해도 사용 기록은 만료까지 남는다", async () => {
    let clock = Date.now() / 1000;
    const { authenticate, usedJti } = setup(() => clock);
    const iat = Math.floor(clock);
    const token = await makeTicket({ jti: "keep", iat, exp: iat + 60 });
    await authenticate(token, {}, authContext());
    usedJti.sweep();
    assert.equal(usedJti.has("keep"), true);
    clock = iat + 60;
    usedJti.sweep();
    assert.equal(usedJti.has("keep"), false);
  });
});
