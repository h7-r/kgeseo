// 로비 서버 실행 입구.
//   운영:  node dist/index.js --profile=production     (systemd waegok-lobby 의 ExecStart)
//   로컬:  npm run dev                                (--profile=test)
// 운영 시작 검사(3.3.2절)에 걸리면 이유를 남기고 시작하지 않는다.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import { jsonLineLogger } from "./log.js";
import { createLobbyServer } from "./server.js";
import { startTestHookServer } from "./testHooks.js";

const here = dirname(fileURLToPath(import.meta.url));
// test 프로필에서만 읽는 로비 전용 파일(Git 무시: .env.*)
const LOCAL_ENV_FILE = resolve(here, "../.env.lobby");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TEST_HOOK_PORT = 2568;

const result = loadConfig(process.argv.slice(2), process.env, LOCAL_ENV_FILE);
if ("errors" in result) {
  jsonLineLogger("startup_check_failed", { reasons: result.errors.join(" | ") });
  process.exit(1);
}
const { config } = result;
// Caddy 와 같은 EC2 에서 루프백에만 붙는다(🟡). 로컬에서 다른 기기로 열 때만 바꾼다
const host = process.env.LOBBY_HOST?.trim() || DEFAULT_HOST;

const lobby = createLobbyServer(config, { log: jsonLineLogger });
await lobby.listen(host, config.port);
if (lobby.hooks) {
  const hookPort = Number(process.env.LOBBY_TEST_HOOKS_PORT ?? DEFAULT_TEST_HOOK_PORT);
  await startTestHookServer(lobby.hooks, hookPort);
  jsonLineLogger("test_hooks_listening", { port: hookPort });
}

const stop = async (signal: string) => {
  jsonLineLogger("stopping", { signal });
  await lobby.shutdown();
  process.exit(0);
};
process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
