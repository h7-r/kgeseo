import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// 나주 맵의 손 배치(지운 것·옮긴 것)를 파일 한 장으로 주고받는 개발 서버 주소.
// 배치는 시드로 어디서 열어도 같은데 편집만 브라우저에 두면 사람마다 달라지므로 파일에 적는다.
// 주소에 한글을 쓰지 않는다 — req.url 은 퍼센트 인코딩된 원문이라 한글 리터럴과 비교가 어긋난다.
const EDIT_ENDPOINT = "/__naju-edit";
const EDIT_FILE = fileURLToPath(new URL("../assets/edits.json", import.meta.url));
const BACKUP_DIR = fileURLToPath(new URL("../assets/edits-backup/", import.meta.url));
const MAX_BACKUPS = 40;
// 파일이 없을 때 돌려주는 빈 편집 — 열쇠는 저장 형식 그대로(한글)
const EMPTY_EDITS = '{"지움":{},"고침":{}}';

const pad = (n: number) => String(n).padStart(2, "0");

// 손으로 놓은 것은 다시 만들 수 없다 — 덮어쓰기 한 번에 작업이 사라지지 않게 직전 내용을 남긴다.
// 내용이 같으면 남기지 않는다 — 백업이 같은 파일로 가득 찬다.
async function backupBeforeOverwrite(next: string) {
  let previous: string;
  try {
    previous = await fs.readFile(EDIT_FILE, "utf8");
  } catch {
    return;
  }
  if (previous === next) return;
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const t = new Date();
  const name =
    `edits-${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}` +
    `-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}.json`;
  await fs.writeFile(path.join(BACKUP_DIR, name), previous);
  const backups = (await fs.readdir(BACKUP_DIR)).filter((file) => file.endsWith(".json")).sort();
  for (const file of backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS))) {
    await fs.rm(path.join(BACKUP_DIR, file), { force: true });
  }
}

// 빌드본에 같이 내보내는 이름 — 정적 서버·CDN 이 한글 경로를 제각각 인코딩해서 ASCII 로 둔다
const BUNDLED_EDIT_FILE = "naju-edit.json";
const EMPTY_BUNDLED_EDITS = '{"지움":{},"고침":{},"더함":{}}';

/**
 * 빌드본에는 /__naju-edit 미들웨어가 없어 그 주소가 index.html 을 돌려주고 손 배치가 통째로 빠진다.
 * 그래서 빌드할 때 편집 파일을 naju-edit.json 으로 같이 내보낸다(placement/editFile 이 빌드본에서 읽는다).
 */
export function najuEditBundle(): Plugin {
  return {
    name: "naju-edit-bundle",
    apply: "build",
    async generateBundle() {
      // 글자로 풀지 않고 바이트 그대로 싣는다
      let source: string | Uint8Array = EMPTY_BUNDLED_EDITS;
      try {
        source = await fs.readFile(EDIT_FILE);
      } catch {
        // 편집 파일이 없으면 빈 편집으로 나간다
      }
      this.emitFile({ type: "asset", fileName: BUNDLED_EDIT_FILE, source });
    },
  };
}

/** GET 은 편집 파일을 내주고, writable 이면 POST 로 덮어쓴다. 본편 서버(5173)는 읽기만 한다. */
export function najuEditFile({ writable }: { writable: boolean }): Plugin {
  return {
    name: writable ? "naju-edit-file" : "naju-edit-file-readonly",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if ((req.url ?? "").split("?")[0] !== EDIT_ENDPOINT) return next();
        if (req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          try {
            res.end(await fs.readFile(EDIT_FILE, "utf8"));
          } catch {
            res.end(EMPTY_EDITS);
          }
          return;
        }
        if (req.method === "POST" && writable) {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          try {
            const body = Buffer.concat(chunks).toString("utf8");
            JSON.parse(body); // 깨진 JSON 을 파일에 남기지 않는다
            await fs.mkdir(path.dirname(EDIT_FILE), { recursive: true });
            await backupBeforeOverwrite(body);
            await fs.writeFile(EDIT_FILE, body);
            res.statusCode = 200;
            res.end("ok");
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
          }
          return;
        }
        next();
      });
    },
  };
}
