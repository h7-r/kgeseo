import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

// 5174 편집 모드 「라이브러리 배치」(L) 의 개발 서버 주소 (10/15 미르 결정).
//   GET  /__review/library · /__review/library/search?q=  — 검수 작업대(5180)와 같은 색인(tools/review/library.mjs)
//   GET  /__naju-place            — 편집기가 놓은 「놓기」 항목 목록(출처 editor:)
//   POST /__naju-place            — 확정: public/_sf_local/manifest.json 「놓기」 에 곧바로 덧붙인다(변경안·승인 없이)
//   POST /__naju-place/undo       — 편집기가 놓은 마지막 항목 하나를 뺀다
//   POST /__naju-place/update     — 통합 편집 모드: 이미 놓인 놓기 한 자리(어떤 출처든) 옮기기·돌리기·크기
//   POST /__naju-place/remove     — 통합 편집 모드: 놓기 한 자리 지우기(자리가 하나뿐이면 항목째)
//   POST /__naju-place/restore    — 통합 편집 모드 되돌리기(Ctrl+Z): 놓기 index 자리를 이전 항목으로
//   검사·쓰기 규칙은 검수 서버와 같은 공용 모듈(tools/review/manifestPlace.mjs) — 백업은 .local/review/manifest_bak_<시각>.json.
//   빌드본·5173 에는 붙지 않는다(apply: "serve" + naju01 설정에서만 쓴다).
const PLACE_ENDPOINT = "/__naju-place";
const LIBRARY_PREFIX = "/__review/library";
const MAX_BODY = 64 * 1024;
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA_DIR = path.join(ROOT, ".local/review");

type Send = (status: number, body: unknown) => void;
type LibraryHandler = (req: IncomingMessage, res: ServerResponse, pathname: string, send: Send) => Promise<boolean>;
interface LibraryModule {
  libraryRoutes(root: string): LibraryHandler;
}
interface PlaceModule {
  editorPlace(root: string, dataDir: string, input: unknown): Promise<unknown>;
  editorUndo(root: string, dataDir: string): Promise<unknown>;
  editorEntries(root: string): Promise<unknown>;
  editorUpdate(root: string, dataDir: string, input: unknown): Promise<unknown>;
  editorRemove(root: string, dataDir: string, input: unknown): Promise<unknown>;
  editorRestore(root: string, dataDir: string, input: unknown): Promise<unknown>;
  editorDuplicate(root: string, dataDir: string, input: unknown): Promise<unknown>;
}
type PlaceWrite = "update" | "remove" | "restore" | "duplicate";
const PLACE_WRITES = new Set<string>(["update", "remove", "restore", "duplicate"]);
interface ServerError {
  status?: number;
  code?: string;
  message?: string;
  details?: unknown;
}

// .mjs(검수 서버 도구)는 타입이 없어 경로를 값으로 넘겨 불러온다 — 설정 번들에 묶지 않고 실행 때 읽는다
//   10/15: 주소 꼬리표(?v=파일 수정 시각) — Node 는 한 번 읽은 모듈을 프로세스가 끝날 때까지 쓴다.
//   꼬리표가 없으면 개발 서버를 켠 뒤 고친 도구(예: editorRestore 추가)가 안 보여 Ctrl+Z 가 「is not a function」 으로 실패했다.
//   바뀐 파일만 새로 읽는다(그 파일이 import 하는 다른 .mjs 는 그대로 — 고쳤으면 서버를 다시 켤 것).
const importTool = async <T>(file: string): Promise<T> => {
  const full = path.join(ROOT, "tools/review", file);
  const version = await stat(full).then(
    (info) => Math.floor(info.mtimeMs),
    () => 0,
  );
  return import(/* @vite-ignore */ `${pathToFileURL(full).href}?v=${version}`) as Promise<T>;
};

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("요청이 너무 큽니다."), { status: 413, code: "body_too_large" });
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("JSON 을 읽을 수 없습니다."), { status: 400, code: "invalid_json" });
  }
}

/** 다른 사이트에서 온 쓰기 요청은 받지 않는다(Origin 이 있으면 같은 호스트여야) */
function isSameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function libraryPlacePlugin(): Plugin {
  return {
    name: "naju-library-place",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? "").split("?")[0];
        const isLibrary = pathname === LIBRARY_PREFIX || pathname.startsWith(`${LIBRARY_PREFIX}/`);
        const action = pathname.startsWith(`${PLACE_ENDPOINT}/`) ? pathname.slice(PLACE_ENDPOINT.length + 1) : "";
        const isPlace = pathname === PLACE_ENDPOINT || action === "undo" || PLACE_WRITES.has(action);
        if (!isLibrary && !isPlace) return next();
        const send: Send = (status, body) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };
        try {
          if (isLibrary) {
            const { libraryRoutes } = await importTool<LibraryModule>("library.mjs");
            if (!(await libraryRoutes(ROOT)(req, res, pathname, send))) next();
            return;
          }
          const tools = await importTool<PlaceModule>("manifestPlace.mjs");
          if (req.method === "GET" && pathname === PLACE_ENDPOINT) {
            send(200, { entries: await tools.editorEntries(ROOT) });
            return;
          }
          if (req.method !== "POST") {
            send(405, { error: "method_not_allowed", message: "허용되지 않는 요청입니다." });
            return;
          }
          if (!isSameOrigin(req)) {
            send(403, { error: "cross_origin", message: "같은 출처의 편집 화면에서만 배치할 수 있습니다." });
            return;
          }
          if (pathname === PLACE_ENDPOINT) send(200, await tools.editorPlace(ROOT, DATA_DIR, await readJson(req)));
          else if (action === "undo") send(200, await tools.editorUndo(ROOT, DATA_DIR));
          else {
            const write: Record<PlaceWrite, PlaceModule["editorUpdate"]> = {
              update: tools.editorUpdate,
              remove: tools.editorRemove,
              restore: tools.editorRestore,
              duplicate: tools.editorDuplicate, // 10/20 놓기 자리 복사·붙여넣기
            };
            send(200, await write[action as PlaceWrite](ROOT, DATA_DIR, await readJson(req)));
          }
        } catch (error) {
          const e = error as ServerError;
          const status = typeof e.status === "number" ? e.status : 500;
          if (status >= 500) server.config.logger.error(`[naju-place] ${String(e.message ?? error)}`);
          send(status, {
            error: e.code ?? "server_error",
            message: e.message ?? "처리하지 못했습니다.",
            details: e.details,
          });
        }
      });
    },
  };
}
