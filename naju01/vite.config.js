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
const 백업방 = fileURLToPath(new URL("./에셋/편집-백업/", import.meta.url));
const 백업최대 = 40;

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
// ── 덮어쓰기 전에 한 벌 남긴다 ─────────────────────────────
// [왜]
//   이 파일은 **손으로 놓은 것 전부**다 — 다시 만들 수가 없다. 생성기 결과와
//   달리 시드로 되살릴 방법이 없다. 그런데 저장은 그냥 덮어쓰기라, 헤드리스
//   시험이든 실수든 한 번만 잘못 덮으면 그날 작업이 통째로 사라진다.
//   (실제로 그렇게 잃었다. 그래서 넣는다.)
//   덮어쓸 내용이 지금 것과 같으면 안 남긴다 — 백업이 같은 파일로 가득 찬다.
async function 덮기전에백업(새글) {
  let 옛글;
  try {
    옛글 = await fs.readFile(편집파일, "utf8");
  } catch {
    return; // 원래 없던 파일이면 잃을 것도 없다
  }
  if (옛글 === 새글) return;
  await fs.mkdir(백업방, { recursive: true });
  const 때 = new Date();
  const 두자리 = (n) => String(n).padStart(2, "0");
  const 이름 =
    `편집-${때.getFullYear()}${두자리(때.getMonth() + 1)}${두자리(때.getDate())}` +
    `-${두자리(때.getHours())}${두자리(때.getMinutes())}${두자리(때.getSeconds())}.json`;
  await fs.writeFile(path.join(백업방, 이름), 옛글);
  // 오래된 것부터 지워 개수를 묶어 둔다
  const 목록 = (await fs.readdir(백업방)).filter((v) => v.endsWith(".json")).sort();
  for (const v of 목록.slice(0, Math.max(0, 목록.length - 백업최대)))
    await fs.rm(path.join(백업방, v), { force: true });
}

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
            await 덮기전에백업(글);
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
    // ★ 옮겨 붙지 않고 그냥 실패하게 한다.
    //   이게 없으면 5174 가 물렸을 때 5175 로 밀리고, 그 순간 Leva 저장값이
    //   (localStorage 가 출처별이라) 통째로 사라진 것처럼 보인다.
    //   본편 쪽 vite.config.js 도 같은 이유로 5173 을 못 박아 뒀다.
    strictPort: true,
    // 공용.jsx 처럼 이 폴더 **바깥**(저장소 src/)에 있는 파일을 읽어야 한다.
    fs: { allow: [뿌리] },
  },
  build: { outDir: "dist-naju01", emptyOutDir: true },
  plugins: [react(), 편집저장()],
});
