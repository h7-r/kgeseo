// 실행 프로필과 운영 시작 검사(설계 3.3절)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildConfig, collectSettings, loadConfig, parseProfile, type Profile } from "../src/config.js";

const PROD_SECRET = "p".repeat(40);
const goodProduction = {
  LOBBY_TICKET_SECRET: PROD_SECRET,
  LOBBY_ALLOWED_ORIGINS: "https://play.example.com",
  LOBBY_MAX_ROOMS: "5",
  LOBBY_BETA_LIST_PATH: "/srv/waegok/lobby_beta_users.txt",
};

const errorsOf = (profile: Profile, settings: Record<string, string>) => {
  const result = buildConfig(profile, settings);
  return "errors" in result ? result.errors : [];
};

describe("실행 프로필", () => {
  it("인자가 없으면 production", () => assert.deepEqual(parseProfile([]), { profile: "production" }));
  it("test 를 명시할 수 있다", () => assert.deepEqual(parseProfile(["--profile=test"]), { profile: "test" }));
  it("알 수 없는 값은 실패", () => assert.ok("error" in parseProfile(["--profile=staging"])));
  it("값 없는 --profile 은 실패", () => assert.ok("error" in parseProfile(["--profile"])));
  it("두 번 적으면 실패", () => assert.ok("error" in parseProfile(["--profile=test", "--profile=production"])));
});

describe("설정 읽는 경로", () => {
  const file = "LOBBY_MAX_ROOMS=1\nLOBBY_TICKET_SECRET=from-file\nWAEGOK_RUN_PROFILE=test\nLOBBY_PROFILE=test\n";
  it("production 은 로비 전용 파일을 읽지 않는다", () => {
    let read = false;
    const settings = collectSettings("production", {
      env: { LOBBY_TICKET_SECRET: "env" },
      readLocalFile: () => {
        read = true;
        return file;
      },
    });
    assert.equal(read, false);
    assert.deepEqual(settings, { settings: { LOBBY_TICKET_SECRET: "env" }, errors: [] });
  });
  it("test 는 환경을 먼저, 없는 항목만 파일에서. 프로필 키는 무시", () => {
    const settings = collectSettings("test", { env: { LOBBY_TICKET_SECRET: "env" }, readLocalFile: () => file });
    assert.deepEqual(settings, { settings: { LOBBY_TICKET_SECRET: "env", LOBBY_MAX_ROOMS: "1" }, errors: [] });
  });
  it("파일이 없는 것은 괜찮다", () => {
    assert.deepEqual(collectSettings("test", { env: {}, readLocalFile: () => undefined }).errors, []);
  });
  it("있는데 못 읽으면 오류(조용히 넘어가지 않는다)", () => {
    const { errors } = collectSettings("test", {
      env: {},
      readLocalFile: () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
    });
    assert.deepEqual(errors, ["lobby/.env.lobby: 읽지 못했다(EACCES)"]);
  });
  it("형식이 틀린 줄은 줄 번호만 적고 오류(값은 안 적는다)", () => {
    const { errors } = collectSettings("test", {
      env: {},
      readLocalFile: () => "LOBBY_MAX_ROOMS=1\nsecret-value-without-key\n",
    });
    assert.deepEqual(errors, ["lobby/.env.lobby: 2번째 줄 형식이 틀렸다"]);
  });
});

describe("운영 시작 검사 — production", () => {
  it("정상 설정은 통과", () => {
    const result = buildConfig("production", goodProduction);
    assert.ok("config" in result);
    assert.equal(result.config.maxRooms, 5);
    assert.deepEqual(result.config.allowedOrigins, ["https://play.example.com"]);
  });
  const cases: [string, Record<string, string>, string][] = [
    ["LOBBY_TEST_HOOKS=1", { ...goodProduction, LOBBY_TEST_HOOKS: "1" }, "LOBBY_TEST_HOOKS"],
    ["방 상한이 5가 아님", { ...goodProduction, LOBBY_MAX_ROOMS: "1" }, "LOBBY_MAX_ROOMS"],
    ["방 상한 없음", { ...goodProduction, LOBBY_MAX_ROOMS: undefined as unknown as string }, "LOBBY_MAX_ROOMS"],
    ["방 상한 숫자 오타", { ...goodProduction, LOBBY_MAX_ROOMS: "5a" }, "LOBBY_MAX_ROOMS"],
    ["출처 비어 있음", { ...goodProduction, LOBBY_ALLOWED_ORIGINS: "" }, "LOBBY_ALLOWED_ORIGINS"],
    ["출처 와일드카드", { ...goodProduction, LOBBY_ALLOWED_ORIGINS: "*" }, "LOBBY_ALLOWED_ORIGINS"],
    [
      "출처에 경로",
      { ...goodProduction, LOBBY_ALLOWED_ORIGINS: "https://a.example.com/play" },
      "LOBBY_ALLOWED_ORIGINS",
    ],
    ["키 없음", { ...goodProduction, LOBBY_TICKET_SECRET: "" }, "LOBBY_TICKET_SECRET"],
    ["키 32바이트 미만", { ...goodProduction, LOBBY_TICKET_SECRET: "short" }, "LOBBY_TICKET_SECRET"],
    ["개발 키", { ...goodProduction, LOBBY_TICKET_SECRET: `dev-${"x".repeat(40)}` }, "LOBBY_TICKET_SECRET"],
    ["LOBBY_ENV=test", { ...goodProduction, LOBBY_ENV: "test" }, "LOBBY_ENV"],
    ["포트 숫자 오타", { ...goodProduction, LOBBY_PORT: "abc" }, "LOBBY_PORT"],
    ["명단 경로 없음(채팅 제재를 못 한다)", { ...goodProduction, LOBBY_BETA_LIST_PATH: "" }, "LOBBY_BETA_LIST_PATH"],
  ];
  for (const [name, settings, field] of cases) {
    it(`${name} → 시작 안 함`, () => {
      const clean = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined));
      const errors = errorsOf("production", clean);
      assert.ok(
        errors.some((e) => e.startsWith(field)),
        `${field} 오류가 있어야 한다: ${errors.join(" | ")}`,
      );
    });
  }
  it("정상 설정은 명단 경로를 넘긴다", () => {
    const result = buildConfig("production", goodProduction);
    assert.ok("config" in result);
    assert.equal(result.config.betaListPath, "/srv/waegok/lobby_beta_users.txt");
  });
  for (const debug of ["colyseus:message", "colyseus:*", "*", "app,colyseus:matchmaking"]) {
    it(`DEBUG=${debug} 이면 시작 안 함(받은 메시지 원문을 찍는다)`, () => {
      const result = loadConfig(["--profile=production"], { ...goodProduction, DEBUG: debug }, "/nonexistent");
      assert.ok("errors" in result && result.errors.some((e) => e.startsWith("DEBUG")), JSON.stringify(result));
    });
  }
  it("다른 DEBUG 값과 test 프로필의 colyseus 디버그는 괜찮다", () => {
    assert.ok("config" in loadConfig(["--profile=production"], { ...goodProduction, DEBUG: "app" }, "/nonexistent"));
    const test = loadConfig(
      ["--profile=test"],
      { LOBBY_TICKET_SECRET: "dev-local", LOBBY_ALLOWED_ORIGINS: "http://localhost:5173", DEBUG: "colyseus:*" },
      "/nonexistent",
    );
    assert.ok("config" in test, JSON.stringify(test));
    assert.equal(test.config.betaListPath, null);
  });
  it("실패 사유에 비밀값이 들어가지 않는다", () => {
    const secret = "short-secret-value";
    const errors = errorsOf("production", { ...goodProduction, LOBBY_TICKET_SECRET: secret });
    assert.ok(errors.length > 0);
    assert.ok(errors.every((e) => !e.includes(secret)));
  });
});

describe("test 프로필", () => {
  it("개발 키·작은 방 상한·시험 장치를 쓸 수 있다", () => {
    const result = buildConfig("test", {
      LOBBY_TICKET_SECRET: "dev-local",
      LOBBY_ALLOWED_ORIGINS: "http://localhost:5173",
      LOBBY_MAX_ROOMS: "1",
      LOBBY_TEST_HOOKS: "1",
    });
    assert.ok("config" in result);
    assert.equal(result.config.testHooks, true);
    assert.equal(result.config.maxRooms, 1);
  });
  it("LOBBY_ENV=production 은 불일치", () => {
    const errors = errorsOf("test", {
      LOBBY_TICKET_SECRET: "dev-local",
      LOBBY_ALLOWED_ORIGINS: "http://localhost:5173",
      LOBBY_ENV: "production",
    });
    assert.ok(errors.some((e) => e.startsWith("LOBBY_ENV")));
  });
});
