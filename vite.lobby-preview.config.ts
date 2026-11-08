// 로비 실제 화면 미리보기 전용 개발 서버(3단계 정식 연결 전에 실제 본부실에서 로비를 눈으로 본다). 배포 빌드와 상관없다.
//   npx vite --config vite.lobby-preview.config.ts   → http://localhost:5173/?input=always
// 기존 vite.config.ts 를 그대로 쓰고, src/app/App.tsx 가 가져오는 두 가지만 대역으로 돌린다. 다른 파일은 그대로다.
//   `@react-three/fiber` → src/dev/lobbyPreview/r3fWithLobby.tsx (로비 연결을 덧붙인 Canvas)
//   `./playerState`      → src/dev/lobbyPreview/playerStateWithLobby.ts (내 플레이어 상자를 미리보기에 등록 — 인사·맞기 동작)
// 그리고 src/station/layout/usePlayer.ts 가 가져오는 `./collision` 하나를 collisionWithPeople.ts 로(내 걷기에만 사람 충돌).
// 포트는 평소와 같은 5173 이다 — 백엔드·로비가 허용한 출처(http://localhost:5173)라야 로그인·입장권·매칭이 된다.
// 팀 캐릭터 꾸미기 창(http://localhost:5173/team-npc.html)의 저장 창구 GET · POST /__dev/team-npcs 도 여기만 연다(검토 22회차).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig, type Plugin } from "vite";

import {
  isTeamSlotKey,
  parseTeamEntry,
  parseTeamFile,
  parseTeamLinePairs,
  TEAM_LINES_MAX,
  type TeamFile,
} from "./lobby/src/npc/teamRoster";
import { isTeamGestureId } from "./lobby/src/npc/teamGestures";
import baseConfig from "./vite.config";
import { lobbyPreviewCanvasPlugin } from "./vite.lobby-standins";

/** 저장 파일 — 로비 서버가 읽는 곳과 같아야 한다(둘 다 TEAM_NPC_FILE 로 옮길 수 있다) */
const TEAM_FILE = process.env.TEAM_NPC_FILE ?? fileURLToPath(new URL("./lobby/data/team-npcs.json", import.meta.url));
const TEAM_ROUTE = "/__dev/team-npcs";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const MAX_BODY_BYTES = 64 * 1024;

function readTeamFile(): TeamFile {
  try {
    return parseTeamFile(JSON.parse(readFileSync(TEAM_FILE, "utf8")));
  } catch {
    return { version: 1, npcs: {} };
  }
}

/** 통째로 바꿔 끼운다 — 쓰다 멈춰도 로비 서버가 반쯤 쓴 파일을 읽지 않게 */
function writeTeamFile(file: TeamFile) {
  mkdirSync(dirname(TEAM_FILE), { recursive: true });
  const temp = `${TEAM_FILE}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(temp, TEAM_FILE);
}

/**
 * 팀 캐릭터 저장 창구(개발 서버 전용). 이 컴퓨터에서 온 요청만, 쓰기는 같은 출처의 JSON 만 받는다 — 다른 사이트가 몰래
 * 보낸 폼 · 요청이 저장소 파일을 바꾸지 못하게(JSON 은 사전 확인이 필요하고 CORS 를 열지 않는다).
 */
function teamNpcSavePlugin(): Plugin {
  return {
    name: "team-npc-save",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(TEAM_ROUTE, (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };
        if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) return send(403, { error: "local_only" });
        if (req.method === "GET") return send(200, readTeamFile());
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
        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) req.destroy();
          else chunks.push(chunk);
        });
        req.on("end", () => {
          let body: unknown;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return send(400, { error: "json" });
          }
          // 두 가지 저장: { key, entry } = 외형만(저장된 대사 · 동작은 늘 지킨다) · { key, lines, lineGestures } = 대사와 그 동작만
          // (외형은 그대로, [] 는 대사 지우기). 한쪽 저장이 다른 쪽을 지우지 않게(Codex 25 · 27)
          const { key, entry, lines, lineGestures } = (body ?? {}) as {
            key?: unknown;
            entry?: unknown;
            lines?: unknown;
            lineGestures?: unknown;
          };
          if (!isTeamSlotKey(key)) return send(400, { error: "invalid" });
          const file = readTeamFile();
          const current = file.npcs[key];
          let parsed;
          if (entry !== undefined) {
            parsed = parseTeamEntry({
              ...(typeof entry === "object" && entry !== null ? entry : {}),
              lines: current?.lines ?? [],
              lineGestures: current?.lineGestures ?? [],
              savedAt: new Date().toISOString(),
            });
          } else if (Array.isArray(lines)) {
            if (!current) return send(409, { error: "no_entry" });
            // 틀린 줄이 섞이면 조용히 버리지 않고 거절한다(적은 대사가 사라진 줄 모르게 되지 않게) — 문자열이 아닌 것,
            // 3개 이상, 다듬은 뒤 40자를 넘는 줄. 빈 줄은 지운 것으로 본다, [] 는 대사 지우기(Codex 리뷰 e0bc05d)
            if (lines.length > TEAM_LINES_MAX || lines.some((line) => typeof line !== "string"))
              return send(400, { error: "invalid_line" });
            // 동작은 빈 줄을 걷기 전 대사와 같은 길이 · 각 "" 또는 아는 동작(검토 27회차) — 없으면 전부 무작위
            if (
              lineGestures !== undefined &&
              (!Array.isArray(lineGestures) ||
                lineGestures.length !== lines.length ||
                lineGestures.some((id) => id !== "" && !isTeamGestureId(id)))
            )
              return send(400, { error: "invalid_gesture" });
            const kept = parseTeamLinePairs(lines, lineGestures);
            if (kept.lines.length !== (lines as string[]).filter((line) => line.trim()).length)
              return send(400, { error: "invalid_line" });
            parsed = { ...current, ...kept, savedAt: new Date().toISOString() };
          }
          if (!parsed) return send(400, { error: "invalid" });
          file.npcs[key] = parsed;
          try {
            writeTeamFile(file);
          } catch (error) {
            server.config.logger.error(`[team-npc] 저장 실패: ${String(error)}`);
            return send(500, { error: "write" });
          }
          server.config.logger.info(`[team-npc] ${key} 저장 → ${TEAM_FILE}`);
          return send(200, file);
        });
      });
    },
  };
}

export default mergeConfig(baseConfig, {
  plugins: [lobbyPreviewCanvasPlugin(), teamNpcSavePlugin()],
  cacheDir: "node_modules/.vite-lobby-preview",
});
