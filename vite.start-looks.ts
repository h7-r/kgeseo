// 캐릭터 생성 시작 모습 저장 창구(개발 서버 전용) — 시작 모습 창(start-look.html)이 쓴다(미르 11/10). 배포 빌드와 상관없다.
// vite.config.ts(본편 개발 서버)가 붙인다. 상주쌤 · 팀 캐릭터 창구와 같은 규칙: 이 컴퓨터에서 온 요청만, 쓰기는 같은 출처의 JSON 만.
//   GET  /__dev/start-looks                          → 지금 파일
//   POST { gender, appearance }                      → 그 성별만 바꾼다(다른 성별은 그대로)
//   POST { gender, appearance: null }                → 그 성별을 코드 기본값으로
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

import {
  EMPTY_START_LOOK_FILE,
  isStartLookGender,
  parseStartLookAppearance,
  parseStartLookFile,
  type StartLookFile,
} from "./naju01/src/characterCreation/startLookFile";

/** 저장 파일 — 생성 화면 카탈로그(catalog.ts)가 그대로 가져온다. 저장한 뒤 커밋해야 모두에게 반영된다 */
const START_LOOK_FILE =
  process.env.START_LOOK_FILE ??
  fileURLToPath(new URL("./naju01/src/characterCreation/startLooks.json", import.meta.url));
// 길은 ASCII 여야 한다 — connect 는 퍼센트 인코딩을 풀지 않고 글자 그대로 견준다(defaultLookPlugin 과 같은 이유)
const START_LOOK_ROUTE = "/__dev/start-looks";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const MAX_BODY_BYTES = 32 * 1024;

/** 파일이 없으면 빈 파일, 있는데 못 읽으면 null — 깨진 파일을 빈 파일로 보고 덮어쓰면 다른 성별 저장이 날아간다 */
function readStartLookFile(): StartLookFile | null {
  let text: string;
  try {
    text = readFileSync(START_LOOK_FILE, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? structuredClone(EMPTY_START_LOOK_FILE) : null;
  }
  try {
    return parseStartLookFile(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 통째로 바꿔 끼운다 — 쓰다 멈춰도 반쯤 쓴 파일이 남지 않게 */
function writeStartLookFile(file: StartLookFile) {
  mkdirSync(dirname(START_LOOK_FILE), { recursive: true });
  const temp = `${START_LOOK_FILE}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(temp, START_LOOK_FILE);
}

export function startLookSavePlugin(): Plugin {
  return {
    name: "start-look-save",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(START_LOOK_ROUTE, (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };
        if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) return send(403, { error: "local_only" });
        if (req.method === "GET") {
          const current = readStartLookFile();
          return current ? send(200, current) : send(500, { error: "file_unreadable", path: START_LOOK_FILE });
        }
        if (req.method !== "POST") return send(405, { error: "method" });
        const origin = req.headers.origin;
        const sameOrigin = (() => {
          try {
            return !!origin && new URL(origin).host === req.headers.host;
          } catch {
            return false;
          }
        })();
        if (!sameOrigin) return send(403, { error: "origin" });
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json"))
          return send(415, { error: "json_only" });
        const chunks: Buffer[] = [];
        let size = 0;
        let tooBig = false;
        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            tooBig = true;
            req.destroy();
          } else chunks.push(chunk);
        });
        req.on("end", () => {
          if (tooBig) return;
          let body: unknown;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return send(400, { error: "json" });
          }
          const { gender, appearance } = (body ?? {}) as Record<string, unknown>;
          if (!isStartLookGender(gender)) return send(400, { error: "gender" });
          let entry: StartLookFile["masculine"] = null;
          if (appearance !== null) {
            const parsed = parseStartLookAppearance(appearance, gender);
            if (!parsed) return send(400, { error: "appearance" });
            entry = { appearance: parsed, savedAt: new Date().toISOString() };
          }
          const file = readStartLookFile();
          if (!file) return send(500, { error: "file_unreadable", path: START_LOOK_FILE });
          file[gender] = entry;
          try {
            writeStartLookFile(file);
          } catch {
            return send(500, { error: "write_failed" });
          }
          server.config.logger.info(`[start-look] ${gender} ${entry ? "저장" : "코드 기본값으로"} → ${START_LOOK_FILE}`);
          return send(200, file);
        });
      });
    },
  };
}
