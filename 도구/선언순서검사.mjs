// 선언 순서 검사 — "아직 만들어지지도 않은 값을 지금 읽고 있지 않은가"
//
// [무엇을 잡는가]
//   const 는 선언한 줄보다 앞에서는 못 읽는다(Cannot access before initialization).
//   그런데 **빌드는 이걸 못 잡는다** — 번들만 만들고 파일을 실행하지 않는다.
//   실제로 두 번 당했다:
//     ① 복도잡동사니.jsx — 종류표가 아래쪽 '종이칸'을 읽어 앱 전체가 안 떴다.
//     ② 소화전내부.jsx  — useMemo 가 아래쪽 '걸이y' 를 읽어 같은 증상.
//
// [어디를 보는가]
//   · 들여쓰기 0 = 모듈 최상단. 파일을 읽는 순간 위에서 아래로 돈다.
//   · 들여쓰기 2 = 컴포넌트/함수 안. 그릴 때 위에서 아래로 돈다.
//   둘을 **따로** 본다. 컴포넌트가 모듈 아래쪽 값을 읽는 건 정상이기 때문이다
//   (그때는 이미 모듈 읽기가 끝나 있다).
//
// [함수 본문은 왜 건너뛰나]
//   나중에 불릴 때 도니까 아래쪽 값을 읽어도 된다.
//   단 useMemo·useCallback 은 **그리는 도중 바로** 돌아가므로 예외로 친다.
import fs from "node:fs";

const 볼파일 =
  process.argv.length > 2
    ? process.argv.slice(2)
    : [
        "src/소품/복도잡동사니.jsx",
        "src/소품/소화전내부.jsx",
        "src/소품/자판기.jsx",
        "src/소품/자판기상태.js",
        "src/소품/여닫이.js",
        "src/로비/배치.js",
        "src/로비/배치.jsx",
        "src/로비/상호작용.js",
        "src/로비/강조.jsx",
        "src/로비/겨냥판정.jsx",
      ];

function 선언뽑기(줄들, 들여) {
  const 앞 = " ".repeat(들여);
  const re = new RegExp(
    `^${앞}const\\s+([A-Za-z_$가-힣][\\w$가-힣]*)\\s*=\\s*(.*)$`,
  );
  const 것 = [];
  for (let i = 0; i < 줄들.length; i++) {
    const m = 줄들[i].match(re);
    if (!m) continue;
    if (줄들[i][들여] === " ") continue; // 더 깊이 들여쓴 줄 = 다른 자리

    // 초기값 전체를 모은다 — 괄호가 닫힐 때까지
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

    const 첫 = m[2].trim();
    const 즉시 = /^(useMemo|useCallback)\s*\(/.test(첫);
    const 함수 =
      !즉시 && /^(\(|async\s|function\b|[\w$가-힣]+\s*=>)/.test(첫);
    것.push({ 이름: m[1], 줄: i + 1, 몸, 함수 });
  }
  return 것;
}

let 실패 = 0;
for (const 파일 of 볼파일) {
  const 줄들 = fs.readFileSync(파일, "utf8").split("\n");
  const 문제 = [];
  let 센것 = 0;

  // 들여쓰기 2 는 '함수 하나' 단위로 봐야 한다.
  //   한 파일에 컴포넌트가 여럿이면(자판기.jsx 는 둘) 서로 남남이라,
  //   한 덩어리로 보면 A 의 변수가 B 의 변수를 '나중 것'이라고 잘못 잡는다.
  const 토막 = [];
  {
    const 시작 = [];
    for (let i = 0; i < 줄들.length; i++)
      if (/^(export\s+)?function\s|^const\s+\S+\s*=\s*(\(|function|async)/.test(줄들[i]))
        시작.push(i);
    for (let k = 0; k < 시작.length; k++)
      토막.push(줄들.slice(시작[k], 시작[k + 1] ?? 줄들.length));
  }

  for (const 무리 of [[줄들], 토막]) {
    const 들여 = 무리 === 토막 ? 2 : 0;
    const 선언 = 무리.flatMap((줄 , idx) => {
      const 것 = 선언뽑기(줄, 들여);
      return 무리 === 토막 ? [것] : [것];
    });
    센것 += 선언.reduce((n, 것) => n + 것.length, 0);
    for (const 것 of 선언)
      것.forEach((d, i) => {
        if (d.함수) return;
        // 주석과 **따옴표 문자열**을 걷어낸다.
        //   { 이름: "반환" } 처럼 이름이 글자로 들어 있으면 변수로 착각한다.
        //   백틱은 ${...} 로 진짜 값을 읽을 수 있어 그대로 둔다.
        const 몸 = d.몸
          .replace(/\/\/[^\n]*/g, "")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/"[^"\n]*"/g, '""')
          .replace(/'[^'\n]*'/g, "''");
        for (const 뒤 of 것.slice(i + 1)) {
          const re = new RegExp(`(^|[^\\w$가-힣.])${뒤.이름}([^\\w$가-힣]|$)`);
          if (re.test(몸)) 문제.push(`${d.이름} → 아직 없는 ${뒤.이름}`);
        }
      });
  }

  if (문제.length) {
    실패++;
    console.log("  ✗", 파일);
    문제.forEach((m) => console.log("      ", m));
  } else {
    console.log("  ✓", 파일, `const ${센것}개`);
  }
}
console.log(실패 === 0 ? "\n전부 통과" : `\n${실패}개 파일에 문제`);
process.exit(실패 ? 1 : 0);
