/* 에셋 폴더를 훑어 src/에셋.js 를 다시 만든다.
   그림을 새로 내려받은 **다음에는 반드시 이걸 돌려야** 한다.
   안 돌리면 코드가 에셋.imgXxx 를 undefined 로 읽어 깨진 이미지가 뜬다.

   실행:  node 시작페이지/에셋색인만들기.mjs          (다시 만들기)
          node 시작페이지/에셋색인만들기.mjs --검사   (어긋나면 실패)          */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 에셋방 = path.join(여기, "에셋");
const 색인 = path.join(여기, "src", "에셋.js");

const 파일 = fs
  .readdirSync(에셋방)
  .filter((f) => f.endsWith(".svg") || f.endsWith(".png") || f.endsWith(".jpg"))
  .sort();

const 이름 = (f) => f.replace(/\.[^.]+$/, "");
const 글 = `/* ═══════════════════════════════════════════════════════
   피그마가 내보낸 이미지 ${파일.length}장

   ※ 이 파일은 손으로 고치지 않는다. \`node 시작페이지/에셋색인만들기.mjs\` 가 만든다.

   [왜 여기 모아 두나]
   피그마 MCP 는 이미지를 http://localhost:3845/assets/... 로 준다.
   그 주소는 **Figma 데스크톱이 켜져 있을 때만** 살아 있고 해시도 바뀐다.
   그래서 전부 내려받아 저장소에 넣고, 코드는 이 파일만 본다.
   이름은 피그마 참조 코드의 변수명을 그대로 썼다 — 원본과 1:1 로 맞춘다.
   뒤에 숫자가 붙은 것(imgComponent12 등)은 **다른 화면의 같은 이름 다른 그림**이다.
   ═══════════════════════════════════════════════════════ */
${파일.map((f) => `import ${이름(f)} from "../에셋/${f}";`).join("\n")}

export default {
  ${파일.map(이름).join(",\n  ")},
};
`;

if (process.argv.includes("--검사")) {
  const 지금 = fs.existsSync(색인) ? fs.readFileSync(색인, "utf8") : "";
  if (지금 !== 글) {
    console.error("✗ 에셋.js 가 에셋 폴더와 어긋납니다. `node 시작페이지/에셋색인만들기.mjs` 를 돌리세요.");
    process.exit(1);
  }
  // 코드가 부르는 에셋 이름이 실제로 있는지도 본다
  const 있는것 = new Set(파일.map(이름));
  const 없는것 = new Set();
  const 훑기 = (디렉) => {
    for (const e of fs.readdirSync(디렉, { withFileTypes: true })) {
      const p = path.join(디렉, e.name);
      if (e.isDirectory()) 훑기(p);
      else if (p.endsWith(".jsx") || p.endsWith(".js")) {
        // import 줄의 "../에셋.js" 는 에셋 이름이 아니다 — 먼저 걷어낸다
        const 본문 = fs.readFileSync(p, "utf8").replace(/^\s*import .*$/gm, "");
        for (const m of 본문.matchAll(/에셋\.(\w+)/g))
          if (!있는것.has(m[1])) 없는것.add(`${path.relative(여기, p)} → 에셋.${m[1]}`);
      }
    }
  };
  훑기(path.join(여기, "src"));
  if (없는것.size) {
    console.error("✗ 없는 에셋을 부르고 있습니다:\n  " + [...없는것].join("\n  "));
    process.exit(1);
  }
  console.log(`✓ 에셋 ${파일.length}장 · 부르는 이름 모두 있음`);
} else {
  fs.writeFileSync(색인, 글);
  console.log(`✓ 에셋.js 다시 만듦 — ${파일.length}장`);
}
