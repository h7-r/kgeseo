// 로컬 개발용 로비 설정 파일 두 개를 같은 개발 키(dev-…)로 만든다. 키 값은 화면에 찍지 않는다.
//   lobby/.env.lobby    — 로비 서버(npm run dev, test 프로필에서만 읽는다)
//   backend/.env.lobby  — FastAPI 입장권 발급(WAEGOK_RUN_PROFILE=test 에서만 직접 읽는다)
// 이미 있으면 건드리지 않는다. 두 파일 모두 Git 무시 규칙(.env.*)에 걸리는지 확인하고 끝낸다.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const lobbyFile = resolve(repoRoot, "lobby/.env.lobby");
const backendFile = resolve(repoRoot, "backend/.env.lobby");

const existing = [lobbyFile, backendFile].filter((file) => existsSync(file));
if (existing.length > 0) {
  console.log(`이미 있어 건드리지 않았다: ${existing.map((file) => relative(repoRoot, file)).join(", ")}`);
  console.log("새로 만들려면 두 파일을 지우고 다시 실행한다(두 파일의 키가 같아야 한다).");
  process.exit(0);
}

const secret = `dev-${randomBytes(32).toString("base64url")}`;
const write = (file, lines) => writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });

write(lobbyFile, [
  "# 로컬 개발 전용(test 프로필). 운영 키·운영 설정을 넣지 않는다.",
  `LOBBY_TICKET_SECRET=${secret}`,
  "LOBBY_ALLOWED_ORIGINS=http://localhost:5173",
  "LOBBY_MAX_ROOMS=5",
  "LOBBY_PORT=2567",
  "LOBBY_TEST_HOOKS=0",
]);
write(backendFile, [
  "# 로컬 개발 전용(WAEGOK_RUN_PROFILE=test). 공유 backend/.env 에는 LOBBY_* 를 넣지 않는다.",
  `LOBBY_TICKET_SECRET=${secret}`,
  "LOBBY_TICKET_TTL_SEC=60",
  "LOBBY_BETA_LIST_PATH=data/lobby_beta_users.txt",
]);

for (const file of [lobbyFile, backendFile]) {
  try {
    execFileSync("git", ["check-ignore", "-q", file], { cwd: repoRoot });
    console.log(`✔ 만들었다(Git 무시됨): ${relative(repoRoot, file)}`);
  } catch {
    console.error(`✖ Git 무시 규칙에 안 걸린다 — 커밋하지 말고 규칙부터 확인한다: ${relative(repoRoot, file)}`);
    process.exitCode = 1;
  }
}
