// 모듈 최상단 const 선언 순서 검사
//
// [무엇을 잡는가]
//   const 는 '선언한 줄보다 앞'에서는 못 읽는다(Cannot access before initialization).
//   그런데 **빌드는 이걸 못 잡는다** — 파일을 실행하지 않기 때문이다.
//   실제로 복도잡동사니.jsx 에서 종류표가 아래쪽 종이칸을 읽어 화면이 통째로 죽었다.
//
// [함수 안은 왜 괜찮은가]
//   함수 본문은 나중에(불릴 때) 돌기 때문에 아래쪽 const 를 읽어도 된다.
//   그래서 '지금 바로 계산되는 초기값'만 본다 — 배열·객체·연산·호출.
import fs from "node:fs";

const 볼파일 = process.argv.length > 2 ? process.argv.slice(2) : [
  "src/소품/복도잡동사니.jsx",
  "src/소품/자판기.jsx",
  "src/소품/자판기상태.js",
  "src/로비/배치.js",
  "src/로비/배치.jsx",
  "src/로비/상호작용.js",
  "src/로비/강조.jsx",
  "src/로비/겨냥판정.jsx",
];

// 최상단(들여쓰기 없음) const 선언을 순서대로 뽑는다
const 선언뽑기 = (src) => {
  const 것 = [];
  const 줄들 = src.split("\n");
  for (let i = 0; i < 줄들.length; i++) {
    const m = 줄들[i].match(/^const\s+([A-Za-z_$가-힣][\w$가-힣]*)\s*=\s*(.*)$/);
    if (!m) continue;
    // 초기값 전체를 모은다 — 괄호 균형이 맞을 때까지
    let 몸 = m[2];
    let 깊이 = 0;
    const 세기 = (s) => {
      for (const ch of s) {
        if ("([{".includes(ch)) 깊이++;
        else if (")]}".includes(ch)) 깊이--;
      }
    };
    세기(몸);
    let j = i;
    while (깊이 > 0 && j + 1 < 줄들.length) {
      j++;
      몸 += "\n" + 줄들[j];
      세기(줄들[j]);
    }
    것.push({ 이름: m[1], 줄: i + 1, 몸, 함수: /^(\(|async\s|function\b|[\w$가-힣]+\s*=>)/.test(m[2].trim()) });
  }
  return 것;
};

let 실패 = 0;
for (const 파일 of 볼파일) {
  const src = fs.readFileSync(파일, "utf8");
  const 선언 = 선언뽑기(src);
  const 뒤에나오는 = (i) => 선언.slice(i + 1).map((d) => d.이름);
  let 문제 = [];
  선언.forEach((d, i) => {
    if (d.함수) return; // 함수 본문은 나중에 돈다 — 아래를 읽어도 된다
    // 주석은 빼고 본다
    const 몸 = d.몸.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const 뒷이름 of 뒤에나오는(i)) {
      const re = new RegExp(`(^|[^\\w$가-힣.])${뒷이름}([^\\w$가-힣]|$)`);
      if (re.test(몸)) 문제.push(`${d.줄}행 ${d.이름} → 아직 없는 ${뒷이름}`);
    }
  });
  const 이름겹침 = 선언.map((d) => d.이름).filter((n, i, a) => a.indexOf(n) !== i);
  if (문제.length || 이름겹침.length) {
    실패++;
    console.log("  ✗", 파일);
    문제.forEach((m) => console.log("      ", m));
    이름겹침.forEach((n) => console.log("       같은 이름 두 번 선언:", n));
  } else {
    console.log("  ✓", 파일, `최상단 const ${선언.length}개`);
  }
}
console.log(실패 === 0 ? "\n전부 통과" : `\n${실패}개 파일에 문제`);
process.exit(실패 ? 1 : 0);
