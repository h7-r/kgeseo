#!/usr/bin/env node
/**
 * test-account-guard.mjs — 웹사이트 배포본에 시연용 테스트 계정 자격 증명이 섞였는지 검사한다
 *
 * [왜]
 *   테스트 계정(website/src/services/account/testAccount.ts)은 개발 서버에서만 켜진다.
 *   배포 빌드는 import.meta.env.DEV 가 false 라 그 값이 번들에서 빠져야 한다.
 *   끄는 조건만 믿지 않고, 실제로 나온 파일에 이메일·비밀번호·해시 글자가 없는지 본다.
 *   (값을 조건식 밖으로 옮기거나, NODE_ENV=development 로 빌드하면 여기서 걸린다.)
 *
 * [사용]
 *   node tools/test-account-guard.mjs website/dist     (npm run web:build 끝에 자동으로 돈다 — package.json)
 *   찾으면 파일 목록을 보여 주고 종료 코드 1 로 멈춘다. 폴더가 없어도 1 이다(빌드를 안 했는데 통과한 것처럼 보이지 않게).
 */
import fs from "node:fs";
import path from "node:path";

// 이메일·비밀번호(test123)와 비밀번호 해시의 소금. 하나라도 나오면 자격 증명이 들어간 것이다.
const MARKERS = ["test123", "d08f5a8867fe0f56939831965d2d0fb2"];
// 그림·영상은 건너뛴다. 글자로 된 파일만 본다.
const TEXT_FILE = /\.(?:js|mjs|cjs|css|html|json|map|txt|svg|webmanifest)$/i;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (TEXT_FILE.test(entry.name)) yield full;
  }
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error("사용법: node tools/test-account-guard.mjs <배포 폴더>...");
  process.exit(1);
}

const found = [];
let scanned = 0;
for (const dir of dirs) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`[test-account-guard] 폴더가 없습니다: ${dir}`);
    process.exit(1);
  }
  for (const file of walk(dir)) {
    scanned += 1;
    const text = fs.readFileSync(file, "utf8");
    const hits = MARKERS.filter((marker) => text.includes(marker));
    if (hits.length) found.push(`${path.relative(process.cwd(), file)} (${hits.length}개 표지)`);
  }
}

if (found.length) {
  console.error("[test-account-guard] 배포본에 테스트 계정 자격 증명이 들어 있습니다:");
  for (const line of found) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`[test-account-guard] 통과 — 파일 ${scanned}개에 테스트 계정 자격 증명 없음`);
