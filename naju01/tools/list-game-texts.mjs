// 퍼즐이 화면에 띄우는 문장(알림 showNotice · 안내판 rule)을 소스에서 모은다.
//   node naju01/tools/list-game-texts.mjs          → 목록을 JSON 으로 출력
// 동행 대화창은 이 문장들을 동행의 말투로 바꿔 말한다(src/dialogue/gameVoiceLines.ts).
// 문장 속 ${…} 는 {1} · {2} 로 바꿔 적는다 — 말투 표의 자리 표시와 같은 모양이다.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const HAS_KOREAN = /[가-힣]/;

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "dialogue" || name === "npc" ? [] : filesUnder(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** start(여는 괄호 다음)부터 짝이 맞는 닫는 괄호까지 — 문자열 안의 괄호는 세지 않는다 */
function spanToClose(source, start) {
  let depth = 1;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      else if (quote === "`" && char === "$" && source[i + 1] === "{") {
        // 템플릿 안의 식은 건너뛴다
        let inner = 1;
        for (i += 2; i < source.length && inner > 0; i++) inner += source[i] === "{" ? 1 : source[i] === "}" ? -1 : 0;
        i--;
      }
    } else if (char === '"' || char === "`" || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return source.slice(start, i);
  }
  return source.slice(start);
}

/** 코드 조각 안의 한글 문자열 · 템플릿을 뽑는다. ${…} → {n} */
function literalsIn(code) {
  const found = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.|\$\{(?:[^{}]|\{[^{}]*\})*\})*)`/g;
  for (const match of code.matchAll(pattern)) {
    let text = match[1] ?? match[2];
    if (match[2] !== undefined) {
      let n = 0;
      text = text.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, () => `{${++n}}`);
    }
    text = text.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    if (HAS_KOREAN.test(text) && [...text].length >= 6) found.push(text);
  }
  return found;
}

export function listGameTexts() {
  const notices = new Map();
  const guides = new Map();
  for (const file of filesUnder(SRC)) {
    const source = readFileSync(file, "utf8");
    const where = relative(SRC, file);
    for (const call of source.matchAll(/\b(?:showNotice|noticeOnce)\(/g)) {
      const span = spanToClose(source, call.index + call[0].length);
      for (const text of literalsIn(span)) if (!notices.has(text)) notices.set(text, where);
    }
    // 알림으로 넘어가는 문장을 변수 · 표에 담아 둔 곳
    for (const named of source.matchAll(/\b(?:CURTAIN_NOTICE\s*=|note:|return\s+(?=["`])|\?\s*(?=["`][^"`]*[가-힣])|:\s*(?=["`][^"`]*[가-힣][^"`]*["`];))/g)) {
      if (!/stageGates|BoatBottles/.test(where)) continue;
      const line = source.slice(named.index, source.indexOf("\n", named.index + named[0].length + 1));
      for (const text of literalsIn(line)) if ([...text].length >= 12 && !notices.has(text)) notices.set(text, where);
    }
    for (const rule of source.matchAll(/\brule:\s*/g)) {
      // rule 값은 다음 속성(rows · distance · diagram) 앞까지
      const rest = source.slice(rule.index + rule[0].length);
      const end = rest.search(/,\s*\n\s*(?:rows|distance|diagram)\b/);
      for (const text of literalsIn(end < 0 ? rest.slice(0, 600) : rest.slice(0, end))) if (!guides.has(text)) guides.set(text, where);
    }
  }
  const toList = (map) => [...map].map(([text, file]) => ({ text, file }));
  return { notices: toList(notices), guides: toList(guides) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { notices, guides } = listGameTexts();
  console.log(JSON.stringify({ count: { notices: notices.length, guides: guides.length }, notices, guides }, null, 2));
}
