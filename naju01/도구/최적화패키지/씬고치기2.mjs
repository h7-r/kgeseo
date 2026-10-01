// 씬고치기2.mjs — 공간그레이박스.jsx 에 **발표 프리셋**을 잇는다(네 자리)
//   ① 발표.js 를 들여온다
//   ② `const T = useSavedControls(…)` → `const T원 = …`
//   ③ 그 끝에 `const T = use발표덮기(T원);` 를 붙인다
//   ④ 해(directionalLight)에 `color={T.해색 ?? "#ffffff"}` 를 준다
//   못 찾으면 멈춘다 — 조용히 안 먹는 게 제일 나쁘다.
import fs from "node:fs";

const 파일 = process.argv[2];
if (!파일) {
  console.error("쓰는 법: node 씬고치기2.mjs <공간그레이박스.jsx 경로>");
  process.exit(1);
}
let 글 = fs.readFileSync(파일, "utf8");

const 바꿈 = [
  [
    `import { use지형이동, 이동상수 } from "../use지형이동.js";`,
    `import { use지형이동, 이동상수 } from "../use지형이동.js";
// ?발표 · ?분위기 주소 스위치 — Leva 값 위에 프리셋을 얹는다(발표.js)
import { use발표덮기 } from "../발표.js";`,
  ],
  [
    `  const T = useSavedControls("NAJU-01 그레이박스", {`,
    `  const T원 = useSavedControls("NAJU-01 그레이박스", {`,
  ],
  [
    `  });
  const 선 = 선뽑기(T);`,
    `  });
  // ★ 주소에 ?발표 / ?분위기 가 있으면 그 프리셋이 Leva 저장값을 덮는다(발표.js).
  //   없으면 \`T원\` 그대로다 — 참조까지 같아서 아래 memo·effect 가 전혀 모른다.
  const T = use발표덮기(T원);
  const 선 = 선뽑기(T);`,
  ],
  [
    `          <mesh name="강조형.수면.지오" geometry={강조형.수면.지오} receiveShadow>`,
    `          {/* 물의 그림자 수신 — 프리셋(발표.js \`물그림자: false\`)만 끈다.
                 물가에서는 화면 절반이 물이라, 픽셀마다 PCF 9 탭이 물결보다 비싸다. */}
          <mesh name="강조형.수면.지오" geometry={강조형.수면.지오} receiveShadow={T.물그림자 !== false}>`,
  ],
  [
    `        intensity={T.햇빛 * T.밝기}
        shadow-mapSize={[2048, 2048]}`,
    `        intensity={T.햇빛 * T.밝기}
        /* 해 색 — 프리셋(발표.js)만 준다. 없으면 예전과 같은 흰빛이다. */
        color={T.해색 ?? "#ffffff"}
        shadow-mapSize={[2048, 2048]}`,
  ],
];

for (const [전, 후] of 바꿈) {
  if (글.includes(후)) {
    console.log("  이미 고쳐져 있다 — 건너뛴다");
    continue;
  }
  const n = 글.split(전).length - 1;
  if (n !== 1) {
    console.error(`  고칠 자리가 ${n} 곳이다(1 곳이어야 한다) — 파일이 바뀌었는지 보라:\n` + 전.slice(0, 80));
    process.exit(1);
  }
  글 = 글.replace(전, 후);
}
fs.writeFileSync(파일, 글, "utf8");
console.log("  공간그레이박스.jsx 에 발표 프리셋을 이었다.");
