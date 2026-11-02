import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";

// 코드로 그린 씬 소품 → GLB 임시 입고 (10/19 미르: 「게임 안에 들어간 에셋은 모두 공용 라이브러리에 들어가 있어야 한다」)
//   POST /__naju-codeprop  { slug, glbBase64, meta }  → public/_sf_local/codeprops/<slug>.glb + _index.json 한 줄 갱신
//   교체본(실제 에셋)이 생기기 전까지 쓰는 임시본이다 — 색인에 needsReplacement: true 로 남긴다.
//   빌드본·5173 에는 붙지 않는다(apply: "serve").
const ENDPOINT = "/__naju-codeprop";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIR = path.join(ROOT, "public/_sf_local/codeprops");
const INDEX = path.join(DIR, "_index.json");
const MAX_BODY = 8 * 1024 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("본문이 너무 큽니다(8 MB 한도)."), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function codePropExportPlugin(): Plugin {
  return {
    name: "naju-codeprop-export",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if ((req.url ?? "").split("?")[0] !== ENDPOINT) return next();
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(body));
        };
        try {
          if (req.method === "GET") {
            send(200, JSON.parse(await readFile(INDEX, "utf8").catch(() => '{"assets":[]}')));
            return;
          }
          if (req.method !== "POST") return send(405, { error: "method_not_allowed" });
          const input = (await readBody(req)) as { slug?: string; glbBase64?: string; meta?: Record<string, unknown> };
          if (!input.slug || !SLUG.test(input.slug)) return send(400, { error: "invalid_slug", message: "slug 는 영문 소문자·숫자·하이픈" });
          if (typeof input.glbBase64 !== "string") return send(400, { error: "invalid_glb" });
          const bytes = Buffer.from(input.glbBase64, "base64");
          if (bytes.subarray(0, 4).toString("ascii") !== "glTF") return send(400, { error: "invalid_glb", message: "GLB 머리가 아닙니다." });
          await mkdir(DIR, { recursive: true });
          const file = `${input.slug}.glb`;
          await writeFile(path.join(DIR, file), bytes);
          const index = JSON.parse(await readFile(INDEX, "utf8").catch(() => '{"assets":[]}')) as { assets: Record<string, unknown>[] };
          const entry = { ...(input.meta ?? {}), asset_id: `code-${input.slug}`, file, bytes: bytes.length, exported_at: new Date().toISOString(), needs_replacement: true };
          index.assets = [...index.assets.filter((a) => a.file !== file), entry].sort((a, b) => String(a.file).localeCompare(String(b.file)));
          const temp = `${INDEX}.${process.pid}.tmp`;
          await writeFile(temp, JSON.stringify({ note: "코드 소품 임시 GLB(10/19) — 실제 에셋으로 교체 전까지", ...index }, null, 2));
          await rename(temp, INDEX);
          send(200, { ok: true, file, bytes: bytes.length });
        } catch (error) {
          const e = error as { status?: number; message?: string };
          send(e.status ?? 500, { error: "server_error", message: e.message ?? String(error) });
        }
      });
    },
  };
}
