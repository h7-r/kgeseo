import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";

// 공간 지형 칸 지도 저장 (10/19 공간 구성 단계) — 게임의 지면 판정으로 1 m 칸마다 「걷는 구역·길·길 가장자리·언덕·물가·물·벼랑면」과
// 높이·경사를 뽑아 공용 라이브러리 공간 항목 옆에 둔다. 배치 코드가 이 지도로 자리를 계산한다(사람이 놓은 물체는 들어 있지 않다).
//   POST /__naju-spacemask { slug, mask } → docs/에셋라이브러리/공간/<slug>.mask.json
const ENDPOINT = "/__naju-spacemask";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIR = path.join(ROOT, "docs/에셋라이브러리/공간");
const SLUG = /^[a-z0-9][a-z0-9_-]{1,60}$/;
const MAX_BODY = 16 * 1024 * 1024;

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("본문이 너무 큽니다."), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function spaceMaskPlugin(): Plugin {
  return {
    name: "naju-space-mask",
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
          if (req.method !== "POST") return send(405, { error: "method_not_allowed" });
          const input = (await readBody(req)) as { slug?: string; mask?: unknown };
          if (!input.slug || !SLUG.test(input.slug)) return send(400, { error: "invalid_slug" });
          if (!input.mask || typeof input.mask !== "object") return send(400, { error: "invalid_mask" });
          await mkdir(DIR, { recursive: true });
          const file = path.join(DIR, `${input.slug}.mask.json`);
          const temp = `${file}.${process.pid}.tmp`;
          await writeFile(temp, JSON.stringify(input.mask));
          await rename(temp, file);
          send(200, { ok: true, file: path.relative(ROOT, file) });
        } catch (error) {
          send((error as { status?: number }).status ?? 500, { error: "write_failed", message: (error as Error).message });
        }
      });
    },
  };
}
