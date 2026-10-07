// declaration-order.mjs — 아직 만들어지지 않은 const 를 먼저 읽고 있지 않은가
//
//   node tools/declaration-order.mjs [파일...]
//
// const 는 선언한 줄보다 앞에서 못 읽는다(Cannot access before initialization). 빌드는 이걸 못 잡는다.
// 옛 복도잡동사니·소화전내부에서 두 번 앱 전체가 안 떴다.
//
// tsc 와의 차이: 모듈 최상단의 선언 전 사용은 tsc 가 TS2448 로 잡는다. 하지만 컴포넌트 안에서
// useMemo·useCallback 이 아래쪽 값을 읽는 것은 tsc 가 「나중에 불리는 함수」로 보고 넘긴다.
// 둘 다 그리는 도중 바로 돌기 때문에 그게 이 검사가 더 잡는 몫이다. .js/.jsx 에는 tsc 가 없으니 전부 본다.
//
// · 들여쓰기 0 = 모듈 최상단, 들여쓰기 2 = 함수·컴포넌트 안. 둘을 따로 본다
//   (컴포넌트가 모듈 아래쪽 값을 읽는 건 정상이다 — 그때는 모듈 읽기가 끝나 있다).
// · 함수 본문은 건너뛴다. 나중에 불리니 아래쪽 값을 읽어도 된다. useMemo·useCallback 만 예외다.
import fs from "node:fs";

const DEFAULT_FILES = [
  "src/props/corridorClutter/CorridorClutter.tsx",
  "src/props/corridorClutter/CorridorCorrosion.tsx",
  "src/props/corridorClutter/Drips.tsx",
  "src/props/corridorClutter/geometry.ts",
  "src/props/corridorClutter/textures.ts",
  "src/props/hydrantCabinet/HydrantCabinetInterior.tsx",
  "src/props/hydrantCabinet/HoseValve.tsx",
  "src/props/hydrantCabinet/SaggingHose.tsx",
  "src/props/hydrantCabinet/hoseGeometry.ts",
  "src/props/vending/CanVendingMachine.tsx",
  "src/props/vending/CoffeeVendingMachine.tsx",
  "src/props/vending/common.ts",
  "src/props/vendingMachineState.ts",
  "src/props/hingeState.ts",
  "src/lobby/placement.ts",
  "src/lobby/PlacementViews.tsx",
  "src/lobby/interactions.ts",
  "src/lobby/Highlight.tsx",
  "src/lobby/AimTracker.tsx",
];
const files = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_FILES;

const IDENT = "[A-Za-z_$가-힣][\\w$가-힣]*";
// 타입 주석(`const x: Foo = ...`)도 받는다. 구조 분해(`const { a } = ...`)는 이름이 여럿이라 뺀다.
const declarationPattern = (indent) =>
  new RegExp(`^${" ".repeat(indent)}(?:export\\s+)?const\\s+(${IDENT})\\s*(?::[^=]+)?=\\s*(.*)$`);
// 들여쓰기 0 에서 함수·컴포넌트가 시작하는 줄
const FUNCTION_START =
  /^(export\s+)?(default\s+)?(async\s+)?function[\s*]|^(export\s+)?const\s+\S+\s*(:[^=]+)?=\s*(\(|function|async|memo\(|forwardRef\()/;
const IMMEDIATE = /^(useMemo|useCallback)\s*(<[^>]*>)?\s*\(/;
// JSX(`<div>`)는 바로 만들어지므로 함수로 치지 않는다.
const LAZY = /^(\(|async\s|function\b|[\w$가-힣]+\s*=>)/;

/** 괄호 깊이를 세며 초기값 전체를 모은다 */
function collectInitializer(lines, start, first) {
  let body = first;
  let depth = 0;
  const count = (s) => {
    for (const ch of s) {
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
    }
  };
  count(body);
  for (let j = start; depth > 0 && j + 1 < lines.length;) {
    j++;
    body += "\n" + lines[j];
    count(lines[j]);
  }
  return body;
}

function findDeclarations(lines, indent) {
  const re = declarationPattern(indent);
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m || lines[i][indent] === " ") continue; // 더 깊이 들여쓴 줄은 다른 자리다
    const head = m[2].trim();
    const lazy = !IMMEDIATE.test(head) && LAZY.test(head);
    found.push({ name: m[1], line: i + 1, body: collectInitializer(lines, i, m[2]), lazy });
  }
  return found;
}

// 주석과 따옴표 문자열을 걷어낸다 — { name: "x" } 의 글자를 변수로 착각하지 않게. 백틱은 ${} 가 있어 둔다.
const stripNoise = (code) =>
  code
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"[^"\n]*"/g, '""')
    .replace(/'[^'\n]*'/g, "''");

let failedFiles = 0;
for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const problems = [];
  let declarationCount = 0;

  // 들여쓰기 2 는 함수 하나 단위로 본다. 한 파일의 컴포넌트 둘은 남남이라 한 덩어리로 보면 잘못 잡는다.
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (FUNCTION_START.test(lines[i])) starts.push(i);
  const functionBodies = starts.map((s, k) => lines.slice(s, starts[k + 1] ?? lines.length));

  const scopes = [findDeclarations(lines, 0), ...functionBodies.map((chunk) => findDeclarations(chunk, 2))];
  for (const declarations of scopes) {
    declarationCount += declarations.length;
    declarations.forEach((decl, i) => {
      if (decl.lazy) return;
      const body = stripNoise(decl.body);
      for (const later of declarations.slice(i + 1)) {
        const use = new RegExp(`(^|[^\\w$가-힣.])${later.name.replace(/\$/g, "\\$")}([^\\w$가-힣]|$)`);
        if (use.test(body)) problems.push(`${decl.name} → 아직 없는 ${later.name}`);
      }
    });
  }

  if (problems.length) {
    failedFiles++;
    console.log("  ✗", file);
    for (const p of problems) console.log("      ", p);
  } else {
    console.log("  ✓", file, `const ${declarationCount}개`);
  }
}
console.log(failedFiles === 0 ? "\n전부 통과" : `\n${failedFiles}개 파일에 문제`);
process.exit(failedFiles ? 1 : 0);
