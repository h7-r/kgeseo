import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// 장면 팩 개발용 창구 (10/21, 에셋보호 설계 v0 P1) — **개발 서버(localhost)에서만** 돈다. 빌드본에는 들어가지 않는다.
//   GET /__packs/file/<id>  → 저장소 뿌리 .packs/<파일>     (팩 파일 — git 에 안 올림)
//   GET /__packs/key/<id>   → 저장소 뿌리 .pack-keys.json 의 열쇠 {key}
//   배포본에서는 이 자리를 백엔드가 맡는다(P2: 세션 확인 → 짧은 수명 주소 + 열쇠). securePack.ts / packSource.ts 참고.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PACK_DIR = path.join(ROOT, ".packs");
const KEYS = path.join(ROOT, ".pack-keys.json");
const ID = /^[a-z0-9][a-z0-9_-]{0,60}$/;

export function scenePackPlugin(): Plugin {
  return {
    name: "naju-scene-pack",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/__packs\/(file|key)\/([^/?]+)/.exec(req.url ?? "");
        if (!m) return next();
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };
        // 이 컴퓨터에서 온 요청만(같은 와이파이의 다른 기기 차단)
        const ip = req.socket.remoteAddress ?? "";
        if (!/^(127\.|::1$|::ffff:127\.)/.test(ip)) return send(403, { error: "local_only" });
        const id = decodeURIComponent(m[2]);
        if (!ID.test(id)) return send(400, { error: "invalid_id" });
        try {
          const keys = JSON.parse(await readFile(KEYS, "utf8")) as Record<string, { key: string; file: string }>;
          const entry = keys[id];
          if (!entry) return send(404, { error: "unknown_pack" });
          if (m[1] === "key") return send(200, { key: entry.key });
          const file = path.join(PACK_DIR, path.basename(entry.file));
          const info = await stat(file);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Content-Length", String(info.size));
          createReadStream(file).pipe(res);
        } catch (error) {
          send(404, { error: "not_found", message: (error as Error).message });
        }
      });
    },
  };
}
