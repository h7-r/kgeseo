// 구글·네이버 로그인 설정을 값을 보여 주지 않고 점검한다. 실행: npm run check:social
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url);
const CALLBACK_PATH = "/로그인/콜백";
const PLACEHOLDER = /^(YOUR_|$)/;

function readEnv(path) {
  try {
    const entries = readFileSync(new URL(path, ROOT), "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim().replace(/^["']|["']$/g, "")]);
    return Object.fromEntries(entries);
  } catch {
    return null;
  }
}

const backend = readEnv("backend/.env");
const website = readEnv("website/.env");
const problems = [];

if (!backend) problems.push("backend/.env 가 없습니다. backend/.env.example 을 복사해 채워 주세요.");
if (!website) problems.push("website/.env 가 없습니다. website/.env.example 을 복사해 채워 주세요.");

if (backend && website) {
  const filled = (env, key, file) => {
    const ok = !PLACEHOLDER.test(env[key] ?? "");
    if (!ok) problems.push(`${file} 의 ${key} 가 비어 있습니다.`);
    return ok;
  };
  const same = (backendKey, websiteKey) => {
    const hasBoth = filled(backend, backendKey, "backend/.env") && filled(website, websiteKey, "website/.env");
    if (hasBoth && backend[backendKey] !== website[websiteKey]) {
      problems.push(`${backendKey} 와 ${websiteKey} 가 서로 다릅니다. 같은 값이어야 합니다.`);
    }
  };
  same("GOOGLE_CLIENT_ID", "VITE_GOOGLE_CLIENT_ID");
  same("NAVER_CLIENT_ID", "VITE_NAVER_CLIENT_ID");
  filled(backend, "NAVER_CLIENT_SECRET", "backend/.env");
  if (filled(backend, "NAVER_REDIRECT_URI", "backend/.env") && !backend.NAVER_REDIRECT_URI.endsWith(CALLBACK_PATH)) {
    problems.push(`NAVER_REDIRECT_URI 는 ${CALLBACK_PATH} 로 끝나야 합니다.`);
  }
}

if (problems.length) {
  console.error(`설정 문제 ${problems.length}건:`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log("파일 설정은 맞습니다. 구글·네이버 콘솔 등록은 docs/소셜로그인-설정.md 로 확인해 주세요.");
