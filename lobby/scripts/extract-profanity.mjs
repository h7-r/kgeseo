// 채팅 금칙어 판정기를 웹사이트 원본에서 로비로 복사한다(검토 14회차 — 판정기를 새로 만들지 않고 공유).
//   node scripts/extract-profanity.mjs           → src/generated/profanity/ 를 다시 쓴다
//   node scripts/extract-profanity.mjs --check   → 다시 쓰지 않고 원본과 다르면 실패(종료 코드 1)
//
// 원본: website/src/lib/koreanText.ts · website/src/lib/nicknamePolicy.ts · shared/nickname-policy.json(해랑 영역 — 고치지 않는다).
// 로비 tsconfig(noUncheckedIndexedAccess · NodeNext)로는 원본을 그대로 컴파일할 수 없어 두 가지만 바꾼다.
//   1) 맨 위에 `// @ts-nocheck` — 타입 검사를 끈다. 대신 test/profanity.test.ts 가 생성본을 실제로 돌려 본다.
//   2) import 경로 — NodeNext 는 상대 경로에 .js 를, JSON 에는 import 속성을 요구한다.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const outDir = resolve(here, "../src/generated/profanity");

const HEADER = (source) =>
  [
    "// @ts-nocheck",
    `// 자동 생성 — node scripts/extract-profanity.mjs. 원본: ${source}. 고치지 말 것(원본을 고치고 다시 생성한다).`,
    "// 로비 tsconfig 로는 원본을 그대로 컴파일할 수 없어 타입 검사를 끈다 — test/profanity.test.ts 가 생성본을 실제로 돌려 본다.",
    "",
  ].join("\n");

/** 한 번만 나와야 하는 구절을 바꾼다 — 원본 모양이 바뀌면 조용히 넘어가지 않고 실패한다 */
function replaceOnce(text, from, to, file) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${file}: 「${from}」 가 ${count}번 나온다(1번이어야 한다) — 원본이 바뀌었다`);
  return text.replace(from, to);
}

/** 생성할 파일들(경로 → 내용). 원본만 읽고 아무것도 쓰지 않는다 */
export function buildProfanityFiles() {
  const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");
  const korean = read("website/src/lib/koreanText.ts");
  let policy = read("website/src/lib/nicknamePolicy.ts");
  policy = replaceOnce(
    policy,
    'import POLICY from "../../../shared/nickname-policy.json";',
    'import POLICY from "./nickname-policy.json" with { type: "json" };',
    "nicknamePolicy.ts",
  );
  policy = replaceOnce(policy, 'from "./koreanText";', 'from "./koreanText.js";', "nicknamePolicy.ts");
  if (/from "\.\.?\//.test(policy.replace('from "./koreanText.js"', "").replace('from "./nickname-policy.json"', "")))
    throw new Error("nicknamePolicy.ts: 모르는 상대 import 가 생겼다 — 이 스크립트를 고친다");
  if (/^import .* from "\.\.?\//m.test(korean)) throw new Error("koreanText.ts: 상대 import 가 생겼다 — 이 스크립트를 고친다");
  return {
    "koreanText.ts": HEADER("website/src/lib/koreanText.ts") + korean,
    "nicknamePolicy.ts": HEADER("website/src/lib/nicknamePolicy.ts") + policy,
    "nickname-policy.json": read("shared/nickname-policy.json"),
  };
}

/** 생성본이 원본과 같은지 — 다른 파일 이름 목록 */
export function staleProfanityFiles() {
  const files = buildProfanityFiles();
  return Object.entries(files)
    .filter(([name, content]) => {
      try {
        return readFileSync(resolve(outDir, name), "utf8") !== content;
      } catch {
        return true;
      }
    })
    .map(([name]) => name);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleProfanityFiles();
    if (stale.length > 0) {
      console.error(`src/generated/profanity 가 원본과 다르다: ${stale.join(", ")} — node scripts/extract-profanity.mjs 로 다시 생성`);
      process.exit(1);
    }
    console.log("src/generated/profanity: 원본과 같다");
  } else {
    mkdirSync(outDir, { recursive: true });
    for (const [name, content] of Object.entries(buildProfanityFiles())) writeFileSync(resolve(outDir, name), content);
    console.log(`src/generated/profanity: ${Object.keys(buildProfanityFiles()).length}개 파일을 다시 썼다`);
  }
}
