import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";

// NAJU-01 그레이박스 전용 개발 서버
//   본편과 **같은 node_modules · 같은 패키지 버전**을 쓴다.
//   (저장소 뿌리의 package.json 하나만 설치하면 여기도 그대로 돌아간다)
//
//   실행:  npx vite naju01          → http://localhost:5174
//   빌드:  npx vite build naju01
const 뿌리 = fileURLToPath(new URL("..", import.meta.url));
const 편집파일 = fileURLToPath(new URL("./에셋/편집.json", import.meta.url));

// ── 편집 저장 (개발 서버 전용) ─────────────────────────────
// [왜 필요한가]
//   요소별 편집(지우기·옮기기)을 브라우저 메모리에만 두면 새로고침에 날아가고
//   팀원 화면에도 안 간다. 배치는 시드 기반이라 **어디서 열어도 같은 결과**가
//   나오는 게 이 프로젝트의 전제인데, 편집만 사람마다 다르면 그 전제가 깨진다.
//   그래서 「무엇을 지웠고 무엇을 옮겼는가」를 파일 한 장에 적는다.
//
// [왜 여기(naju01 전용 설정)에 두나]
//   저장소 뿌리의 vite.config.js 는 **본편 것**이라 건드리지 않는다.
//   이 플러그인은 naju01 개발 서버에만 붙는다.
function 편집저장() {
  return {
    name: "naju01-편집저장",
    apply: "serve",
    configureServer(서버) {
      서버.middlewares.use(async (req, res, next) => {
        // ※ 경로에 **한글을 쓰면 안 된다.** 브라우저·curl 이 퍼센트 인코딩하거나
        //   바이트 그대로 보내는데, req.url 은 그 원문이라 한글 리터럴과 비교가
        //   어긋난다(실제로 안 잡혀서 한참 헤맸다). ASCII 로 고정한다.
        const 길 = (req.url ?? "").split("?")[0];
        if (길 !== "/__naju-edit") return next();
        if (req.method === "GET") {
          try {
            const 글 = await fs.readFile(편집파일, "utf8");
            res.setHeader("Content-Type", "application/json");
            res.end(글);
          } catch {
            res.setHeader("Content-Type", "application/json");
            res.end('{"지움":{},"고침":{}}');
          }
          return;
        }
        if (req.method === "POST") {
          const 조각 = [];
          for await (const c of req) 조각.push(c);
          try {
            const 글 = Buffer.concat(조각).toString("utf8");
            JSON.parse(글); // 깨진 JSON 을 파일에 남기지 않는다
            await fs.mkdir(path.dirname(편집파일), { recursive: true });
            await fs.writeFile(편집파일, 글);
            res.statusCode = 200;
            res.end("ok");
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // 3D 에셋·글꼴은 **본편과 같은 뿌리 public/ 을 그대로 쓴다.**
  //   기본값이면 여기 root 아래(naju01/public)를 보기 때문에,
  //   본편과 같은 `/models/train.glb` 경로가 전부 404 로 죽는다.
  //   같은 파일을 두 벌 두면 어느 쪽이 최신인지 금방 어긋나므로 한 벌만 쓴다.
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
  server: {
    port: 5174, // 본편(5173)과 같이 띄워 놓고 번갈아 볼 수 있게
    // 공용.jsx 처럼 이 폴더 **바깥**(저장소 src/)에 있는 파일을 읽어야 한다.
    fs: { allow: [뿌리] },
  },
  build: { outDir: "dist-naju01", emptyOutDir: true },
  plugins: [react(), 편집저장()],
});
