// 검사용 vite 설정 — 대상 저장소의 vite.config 를 그대로 불러와 네 가지만 덮는다.
//   cacheDir    : 개발 서버가 쓰는 node_modules/.vite 와 겹치지 않게 tools/regression/.cache 아래로
//   fs.allow    : node_modules 가 심볼릭 링크인 작업 트리에서도 실제 경로를 읽게
//   hmr 끔      : 검사 도중 누가 파일을 고쳐도 페이지가 다시 뜨지 않게
//   쓰기 막기   : GET/HEAD/OPTIONS 말고는 전부 405 — 편집기 저장(POST /__naju-edit) 같은 개발 서버 쓰기가
//                 플러그인 이름·주소와 상관없이 저장소 파일에 닿지 못하게 「메서드」로 막는다
// vite 는 대상 저장소의 node_modules 에서 찾는다 — 판이 대상과 같아야 같은 화면이 나온다.
//
// 대상 저장소 루트에서: HARNESS_APP_DIR=naju01 npx vite --config <이 파일> --port 53xx  (server.sh 가 대신 한다)
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = process.cwd();
const appRoot = path.join(repo, process.env.HARNESS_APP_DIR || ".");
const requireFromRepo = createRequire(path.join(repo, "package.json"));
const vite = await import(pathToFileURL(requireFromRepo.resolve("vite")).href);

const CONFIG_NAMES = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"];
const configFile = CONFIG_NAMES.map((f) => path.join(appRoot, f)).find((f) => fs.existsSync(f));
if (!configFile) throw new Error(`[harness] ${appRoot} 에 vite.config 가 없다`);
const { config } = await vite.loadConfigFromFile({ command: "serve", mode: "development" }, configFile, appRoot);

const nodeModules = fs.realpathSync(path.join(repo, "node_modules"));
const cacheRoot = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), ".cache");
const cacheDir = path.join(cacheRoot, crypto.createHash("md5").update(appRoot).digest("hex").slice(0, 10));
fs.mkdirSync(cacheDir, { recursive: true });
const blockedLog = path.join(cacheRoot, "blocked-writes.log");

const blockWrites = {
  name: "harness-block-writes",
  // enforce: pre 라 편집 저장 미들웨어보다 먼저 붙는다
  enforce: "pre",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const method = (req.method || "GET").toUpperCase();
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
      try {
        fs.appendFileSync(blockedLog, `${new Date().toISOString()} ${method} ${req.url}\n`);
      } catch {
        // 기록 실패는 막기와 무관하다
      }
      res.statusCode = 405;
      res.end("harness: writes are blocked");
    });
  },
};

export default vite.mergeConfig(
  { ...config, plugins: [blockWrites, ...(config.plugins ?? [])] },
  {
    root: config.root ?? appRoot,
    cacheDir,
    server: {
      fs: { allow: [vite.searchForWorkspaceRoot(repo), repo, nodeModules, path.dirname(nodeModules)] },
      hmr: false,
      strictPort: true,
      // vite 8 은 브라우저 console 을 웹소켓으로 넘기는데 hmr 을 끄면 매 줄 「Failed to send…」 오류가 쌓인다
      forwardConsole: false,
    },
  },
);
