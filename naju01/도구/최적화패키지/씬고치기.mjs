// 씬고치기.mjs — 공간그레이박스.jsx(3,300 줄)를 통째로 갈지 않고 **두 자리만** 바꾼다
//   ① 배치.js 에서 `편집미리값가져오기` 를 더 들여온다
//   ② `편집` state 를 미리 읽어 둔 값으로 시작한다(있으면 fetch 를 안 한다)
//   못 찾으면 **빌드를 실패시키듯 멈춘다** — 조용히 안 먹는 게 제일 나쁘다
//   (뿌리 vite.config.js 의 leva 플러그인과 같은 원칙).
import fs from "node:fs";

const 파일 = process.argv[2];
if (!파일) {
  console.error("쓰는 법: node 씬고치기.mjs <공간그레이박스.jsx 경로>");
  process.exit(1);
}
let 글 = fs.readFileSync(파일, "utf8");

const 바꿈 = [
  [
    `import {
  무리만들기,
  편집덧씌우기,
  편집읽기,
  빈편집,
  돌흔들기,
} from "../배치.js";`,
    `import {
  무리만들기,
  편집덧씌우기,
  편집읽기,
  편집미리값가져오기,
  빈편집,
  돌흔들기,
} from "../배치.js";`,
  ],
  [
    `  const [편집, 편집설정] = useState(빈편집);
  useEffect(() => {
    편집읽기().then(편집설정);
  }, []);`,
    `  // ★ 미리 읽어 둔 것이 있으면 **첫 렌더부터** 그것으로 시작한다(미리읽기.js).
  //   예전에는 빈 편집으로 무리 40 개를 먼저 세우고, 파일이 오면 **전부 다시**
  //   세웠다 — 첫 진입 끊김의 한 조각이었다. 미리 안 읽었으면 예전대로 읽는다.
  const [편집, 편집설정] = useState(() => 편집미리값가져오기() ?? 빈편집());
  useEffect(() => {
    if (편집미리값가져오기()) return;
    let 살아있나 = true;
    편집읽기().then((v) => {
      if (살아있나) 편집설정(v);
    });
    return () => {
      살아있나 = false;
    };
  }, []);`,
  ],
];

for (const [전, 후] of 바꿈) {
  if (글.includes(후)) {
    console.log("  이미 고쳐져 있다 — 건너뛴다");
    continue;
  }
  if (!글.includes(전)) {
    console.error("  고칠 자리를 못 찾았다 — 파일이 바뀌었는지 보라:\n" + 전.slice(0, 80));
    process.exit(1);
  }
  글 = 글.replace(전, 후);
}
fs.writeFileSync(파일, 글, "utf8");
console.log("  공간그레이박스.jsx 두 자리를 고쳤다.");
