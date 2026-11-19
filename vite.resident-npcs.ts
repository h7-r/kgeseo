// 로비 상주쌤 저장 창구(개발 서버 전용) — 꾸미기 창(resident-npc.html)과 「상주쌤 자리 정하기」(?상주쌤=자리)가 쓴다.
// vite.lobby-preview.config.ts 가 붙인다(팀 캐릭터 저장 창구와 같은 서버 · 같은 규칙). 배포 빌드와 상관없다.
//   GET  /__dev/resident-npcs           → 지금 설정
//   POST { key, displayName, lines, lineGestures } · { key, placement } · { placements }(세 쌤 한꺼번에)
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

import {
  isResidentKey,
  parseResidentFileStrict,
  parseResidentLines,
  parseResidentName,
  parseResidentPlacement,
  type ResidentFile,
} from "./src/dev/residentNpc/residentNpcFile";
/** 저장 파일 — 화면(ResidentNpcs)이 그대로 가져온다. 저장한 뒤 커밋해야 모두에게 반영된다(팀 캐릭터와 같은 방식) */
const RESIDENT_FILE =
  process.env.RESIDENT_NPC_FILE ?? fileURLToPath(new URL("./src/dev/residentNpc/residentNpcs.json", import.meta.url));
const RESIDENT_ROUTE = "/__dev/resident-npcs";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const MAX_BODY_BYTES = 32 * 1024;

/** 파일이 없으면 빈 설정, 있는데 못 읽으면 null — 깨진 파일을 빈 설정으로 보고 덮어쓰면 다른 쌤 설정이 날아간다(15회차 Codex) */
function readResidentFile(): ResidentFile | null {
  let text: string;
  try {
    text = readFileSync(RESIDENT_FILE, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { version: 1, npcs: {}, placements: {} } : null;
  }
  try {
    return parseResidentFileStrict(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 통째로 바꿔 끼운다 — 쓰다 멈춰도 반쯤 쓴 파일이 남지 않게 */
function writeResidentFile(file: ResidentFile) {
  mkdirSync(dirname(RESIDENT_FILE), { recursive: true });
  const temp = `${RESIDENT_FILE}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(temp, RESIDENT_FILE);
}

/**
 * 상주쌤 저장 창구(개발 서버 전용) — 팀 NPC 창구(vite.lobby-preview.config.ts)와 같은 규칙: 이 컴퓨터에서 온 요청만,
 * 쓰기는 같은 출처의 JSON 만. 한 번에 한 쌤의 { key, displayName, lines, lineGestures } 를 통째로 바꾼다.
 */
export function residentNpcSavePlugin(): Plugin {
  return {
    name: "resident-npc-save",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(RESIDENT_ROUTE, (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };
        if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) return send(403, { error: "local_only" });
        if (req.method === "GET") {
          const current = readResidentFile();
          return current ? send(200, current) : send(500, { error: "file_unreadable", path: RESIDENT_FILE });
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
          const { key, displayName, lines, lineGestures, placement, placements } = (body ?? {}) as Record<string, unknown>;
          // 자리 한꺼번에: { placements: { p1: {x,z,rot}, ... } } — 모두 맞을 때만 한 번에 쓴다(일부만 저장되지 않게, 21회차 Codex)
          if (placements !== undefined) {
            if (!placements || typeof placements !== "object" || Array.isArray(placements)) return send(400, { error: "placements" });
            const next: Record<string, ReturnType<typeof parseResidentPlacement>> = {};
            for (const [k, v] of Object.entries(placements as Record<string, unknown>)) {
              const place = isResidentKey(k) ? parseResidentPlacement(v) : null;
              if (!place) return send(400, { error: "placement", key: k });
              next[k] = place;
            }
            const current = readResidentFile();
            if (!current) return send(500, { error: "file_unreadable", path: RESIDENT_FILE });
            Object.assign(current.placements, next);
            try {
              writeResidentFile(current);
            } catch {
              return send(500, { error: "write_failed" });
            }
            return send(200, current);
          }
          if (!isResidentKey(key)) return send(400, { error: "key" });
          // 자리만 저장: { key, placement: { x, z, rot } } — 이름 · 대사는 그대로
          if (placement !== undefined) {
            const place = parseResidentPlacement(placement);
            if (!place) return send(400, { error: "placement" });
            const current = readResidentFile();
            if (!current) return send(500, { error: "file_unreadable", path: RESIDENT_FILE });
            current.placements[key] = place;
            try {
              writeResidentFile(current);
            } catch {
              return send(500, { error: "write_failed" });
            }
            return send(200, current);
          }
          const name = parseResidentName(displayName);
          if (name === null) return send(400, { error: "name" });
          const parsed = parseResidentLines(lines, lineGestures);
          if (parsed.lines.length === 0) return send(400, { error: "lines" });
          const file = readResidentFile();
          if (!file) return send(500, { error: "file_unreadable", path: RESIDENT_FILE });
          file.npcs[key] = { displayName: name, ...parsed, savedAt: new Date().toISOString() };
          try {
            writeResidentFile(file);
          } catch {
            return send(500, { error: "write_failed" });
          }
          send(200, file);
        });
      });
    },
  };
}
