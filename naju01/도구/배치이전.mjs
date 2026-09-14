// ═══════════════════════════════════════════════════════════════
//  배치이전.mjs — 편집 배치를 **새 지형 위로 옮긴다**
// ═══════════════════════════════════════════════════════════════
//  쓰는 법:
//    node naju01/도구/배치이전.mjs <옛높이.bin> [--쓰기 <내보낼 경로>]
//    (--쓰기 를 안 주면 **재보기만** 하고 아무것도 안 쓴다)
//
// [무엇이 문제인가]
//   생성기가 놓은 자리는 런타임에 지형을 샘플링하므로 땅이 바뀌면 따라온다.
//   그런데 **편집기로 옮기거나 붙여넣은 것**은 `편집.json` 에 `y` 를 적어 둔다
//   (`배치.js` 의 `편집덧씌우기` 가 `{...원, ...덮}` 로 덮어쓴다). 그래서
//   지형을 갈면 그것만 공중에 뜨거나 땅에 박힌다. 코어 안 267 건이 그렇다.
//
// [★ 그냥 땅에 다시 떨어뜨리면 안 된다]
//   평상 위에 올려 둔 물건처럼 **일부러 띄운 것**까지 바닥에 처박힌다.
//   지면에서 띄운 만큼을 보존한다 —
//     새 y = 새 지면(x,z) + (저장 y − 옛 지면(x,z))
//   지면에 붙어 있던 것은 정확히 다시 앉고, 1.2 m 띄운 것은 1.2 m 띄운 채 오른다.
//
// [어느 면을 「지면」으로 보나]
//   **`지표.높이`** 다. 편집기는 수직 광선을 쏴서 그려진 메시에 물건을 붙이는데
//   (`편집기.jsx` 의 `땅이름` 목록), 그 메시가 곧 `지표` 면이다. `지형.지면`
//   을 쓰면 요철(±0.12 m)만큼 통째로 어긋난다.
//   새 쪽은 `지형높이.bin` 이다 — 새 지형에서는 요철을 0 으로 끄므로
//   (`공간그레이박스.jsx`) 그려지는 면이 곧 이 표다.
//
// [코어 밖은 안 건드린다]
//   원경(집·나무 등) 211 건은 x·z 가 코어(80×50) 밖이다. 새 지형은 코어만
//   덮으므로 그쪽은 옛 들판이 그대로 받친다 — 손대면 오히려 어긋난다.

import { readFileSync, writeFileSync } from "node:fs";

const 인자 = process.argv.slice(2);
const 옛경로 = 인자[0];
const 쓸곳 = 인자.includes("--쓰기") ? 인자[인자.indexOf("--쓰기") + 1] : null;
const 뿌리 = new URL("../", import.meta.url);
const 편집경로 = new URL("에셋/편집.json", 뿌리);

// ── 새 지형 높이표 ──────────────────────────────────────────
const 새버퍼 = readFileSync(new URL("에셋/지형높이.bin", 뿌리));
const 뷰 = new DataView(새버퍼.buffer, 새버퍼.byteOffset, 새버퍼.byteLength);
const nx = 뷰.getUint16(8, true), nz = 뷰.getUint16(10, true);
const 칸 = 뷰.getFloat32(20, true);
const 낮 = 뷰.getFloat32(28, true), 높 = 뷰.getFloat32(32, true);
const 새격자 = new Uint16Array(새버퍼.buffer.slice(새버퍼.byteOffset + 36, 새버퍼.byteOffset + 36 + nx * nz * 2));

// ── 옛 지형 (지면 · 지표 두 판) ─────────────────────────────
const 옛버퍼 = readFileSync(옛경로);
const 옛f = new Float32Array(옛버퍼.buffer, 옛버퍼.byteOffset, 옛버퍼.byteLength / 4);
const 옛지표 = 옛f.subarray(nx * nz, nx * nz * 2);   // 둘째 판이 지표(그려지는 면)

const 보간 = (판, x, z, 풀기) => {
  const u = x / 칸, v = z / 칸;
  let i = Math.floor(u), j = Math.floor(v);
  if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return null;
  const fu = u - i, fv = v - j, k = j * nx + i;
  const g = (n) => (풀기 ? 낮 + (판[n] / 65535) * (높 - 낮) : 판[n]);
  const 위 = g(k) + (g(k + 1) - g(k)) * fu;
  const 아래 = g(k + nx) + (g(k + nx + 1) - g(k + nx)) * fu;
  return 위 + (아래 - 위) * fv;
};

const 원문 = readFileSync(편집경로, "utf8");
const d = JSON.parse(원문);

let 안 = 0, 밖 = 0, 바뀜 = 0;
const 변화 = [], 큰것 = [];
for (const 갈래 of ["고침", "더함"]) {
  for (const [그룹, 값] of Object.entries(d[갈래] ?? {})) {
    for (const a of Array.isArray(값) ? 값 : Object.values(값)) {
      if (!a || typeof a !== "object") continue;
      if (!("x" in a && "y" in a && "z" in a)) continue;
      const 옛 = 보간(옛지표, a.x, a.z, false);
      const 새 = 보간(새격자, a.x, a.z, true);
      if (옛 === null || 새 === null) { 밖++; continue; }
      안++;
      const 띄움 = a.y - 옛;                 // 지면에서 띄운 만큼 — 이것을 지킨다
      const 새y = Math.round((새 + 띄움) * 1000) / 1000;
      const 차 = 새y - a.y;
      변화.push(차);
      // 5 mm 이하는 안 건드린다 — 의미 없는 차이로 파일을 어지럽히지 않는다
      if (Math.abs(차) > 0.005) { 큰것.push([그룹, a.x, a.z, a.y, 새y, 차, 띄움]); a.y = 새y; 바뀜++; }
    }
  }
}

const 절 = 변화.map(Math.abs).sort((p, q) => p - q);
const 백 = (t) => (절.length ? 절[Math.min(절.length - 1, Math.floor(절.length * t))] : 0);
console.log(`  코어 안 ${안} 건 · 코어 밖(원경, 안 건드림) ${밖} 건`);
console.log(`  y 를 고친 것 ${바뀜} 건 (5 mm 넘게 움직인 것만)`);
console.log(`  이동량  중앙 ${백(0.5).toFixed(3)} m · 90% ${백(0.9).toFixed(2)} m · 최대 ${백(1).toFixed(2)} m`);
console.log("  가장 많이 움직인 8:");
for (const [그룹, x, z, 앞, 뒤, 차, 띄움] of 큰것.sort((p, q) => Math.abs(q[5]) - Math.abs(p[5])).slice(0, 8))
  console.log(`    ${그룹.padEnd(16)} (${x.toFixed(1)}, ${z.toFixed(1)})  ${앞.toFixed(2)} → ${뒤.toFixed(2)}  (${차 > 0 ? "+" : ""}${차.toFixed(2)} · 띄움 ${띄움.toFixed(2)} m 유지)`);

if (쓸곳) {
  // ★ 개발 서버와 **똑같은 형식**으로 쓴다 — 들여쓰기 2, 끝 줄바꿈 없음.
  //   형식이 다르면 다음에 편집기가 저장할 때 파일 전체가 diff 로 뒤집힌다.
  writeFileSync(new URL(쓸곳, 뿌리), JSON.stringify(d, null, 2));
  console.log(`  → ${쓸곳} 에 썼다 (원본 편집.json 은 안 건드렸다)`);
} else {
  console.log("  (--쓰기 를 안 줘서 아무것도 안 썼다)");
}
