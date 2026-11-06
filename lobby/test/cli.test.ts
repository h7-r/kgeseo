// 실행 명령의 운영 시작 검사(7.1 「운영 시작 검사」·「로컬 개발 실행」 중 로비 쪽)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const lobbyDir = fileURLToPath(new URL("..", import.meta.url));
const SECRET = "production-like-secret-value-that-is-long-enough-123";

function run(args: string[], env: Record<string, string>) {
  // 로비 전용 파일(lobby/.env.lobby)이 있어도 production 은 읽지 않는다 — 환경만 넘긴다
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
    cwd: lobbyDir,
    env: { PATH: process.env.PATH ?? "", LOBBY_PORT: "0", ...env },
    encoding: "utf8",
    timeout: 20000,
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe("운영 시작 검사(로비)", () => {
  const prod = { LOBBY_TICKET_SECRET: SECRET, LOBBY_ALLOWED_ORIGINS: "https://play.example.com", LOBBY_MAX_ROOMS: "5" };
  const cases: [string, string[], Record<string, string>, string][] = [
    [
      "프로필 인자 없음 + 시험 장치 → production 으로 보고 거절",
      [],
      { ...prod, LOBBY_TEST_HOOKS: "1" },
      "LOBBY_TEST_HOOKS",
    ],
    ["production + 방 상한 1", ["--profile=production"], { ...prod, LOBBY_MAX_ROOMS: "1" }, "LOBBY_MAX_ROOMS"],
    ["production + LOBBY_ENV=test", ["--profile=production"], { ...prod, LOBBY_ENV: "test" }, "LOBBY_ENV"],
    [
      "production + 출처 와일드카드",
      ["--profile=production"],
      { ...prod, LOBBY_ALLOWED_ORIGINS: "*" },
      "LOBBY_ALLOWED_ORIGINS",
    ],
    ["production + 설정 없음", ["--profile=production"], {}, "LOBBY_TICKET_SECRET"],
    ["알 수 없는 프로필", ["--profile=staging"], prod, "--profile"],
  ];
  for (const [name, args, env, field] of cases) {
    it(name, () => {
      const { status, out } = run(args, env);
      assert.equal(status, 1, out);
      assert.match(out, /startup_check_failed/);
      assert.ok(out.includes(field), out);
      assert.ok(!out.includes(SECRET), "비밀값이 로그에 남으면 안 된다");
    });
  }
});
