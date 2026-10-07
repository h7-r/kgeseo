import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// 꾸미기 패널의 「모두의 기본값으로」 버튼이 보내는 외형을 파일로 받는 개발 서버 주소.
// 기본 모습은 화면을 보고 맞춰야 정해지는데 그 값은 localStorage 에만 있어서, 콘솔에서 긁어내던 일을 버튼 한 번으로 줄인다.
// 길은 ASCII 여야 한다 — connect 는 퍼센트 인코딩을 풀지 않고 글자 그대로 견줘서 한글 길은 영영 404 다.
export const DEFAULT_LOOK_ENDPOINT = "/__default-look";
export const DEFAULT_LOOK_FILE = fileURLToPath(new URL("../assets/default-look.json", import.meta.url));
const MAX_BODY = 64 * 1024; // 외형 한 벌은 1KB 남짓이다

/** 개발 서버에서만 돈다(배포본에는 없다). */
export function defaultLookReceiver(): Plugin {
  return {
    name: "dev-default-look-receiver",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(DEFAULT_LOOK_ENDPOINT, (req, res, next) => {
        if (req.method !== "POST") return next();
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > MAX_BODY) req.destroy();
        });
        req.on("end", () => {
          void (async () => {
            try {
              const value: unknown = JSON.parse(body);
              await fs.writeFile(DEFAULT_LOOK_FILE, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
              res.statusCode = 200;
              res.end("ok");
              console.log("[기본외형] naju01/assets/default-look.json 에 저장했습니다.");
            } catch (error) {
              res.statusCode = 400;
              res.end(error instanceof Error ? error.message : String(error));
            }
          })();
        });
      });
    },
  };
}
