// migrate-placement.mjs — 편집 배치를 새 지형 위로 옮긴다.
// 쓰는 법
//   node naju01/tools/migrate-placement.mjs <옛높이.bin> [--write <내보낼 경로>]
//   (--write 를 안 주면 재보기만 하고 아무것도 안 쓴다. 옛 `--쓰기` 도 받는다. 경로는 naju01/ 기준)
//
// 편집기로 옮기거나 붙여넣은 것만 edits.json 에 y 를 적어 두어, 지형을 갈면 그것만 뜨거나 박힌다.
// 땅에 다시 떨어뜨리면 일부러 띄운 것까지 처박히므로 띄운 만큼을 지킨다: 새 y = 새 지면 + (저장 y − 옛 지면).
// 옛 지면은 그려지는 면(지표 판)이다 — 지형 판을 쓰면 요철(±0.12 m)만큼 통째로 어긋난다.
// 코어(80×50) 밖 원경은 옛 들판이 그대로 받치므로 안 건드린다.

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const oldPath = args[0];
const writeFlag = args.includes("--write") ? "--write" : args.includes("--쓰기") ? "--쓰기" : null;
const writeTo = writeFlag ? args[args.indexOf(writeFlag) + 1] : null;
const root = new URL("../", import.meta.url);
const editsPath = new URL("assets/edits.json", root);

// 새 지형 높이표
const newBuffer = readFileSync(new URL("assets/terrain-height.bin", root));
const view = new DataView(newBuffer.buffer, newBuffer.byteOffset, newBuffer.byteLength);
const nx = view.getUint16(8, true), nz = view.getUint16(10, true);
const cellSize = view.getFloat32(20, true);
const low = view.getFloat32(28, true), high = view.getFloat32(32, true);
const newGrid = new Uint16Array(newBuffer.buffer.slice(newBuffer.byteOffset + 36, newBuffer.byteOffset + 36 + nx * nz * 2));

// 옛 지형(지면 · 지표 두 판)
const oldBuffer = readFileSync(oldPath);
const oldFloats = new Float32Array(oldBuffer.buffer, oldBuffer.byteOffset, oldBuffer.byteLength / 4);
const oldSurface = oldFloats.subarray(nx * nz, nx * nz * 2); // 둘째 판이 지표(그려지는 면)

const sample = (grid, x, z, quantized) => {
  const u = x / cellSize, v = z / cellSize;
  let i = Math.floor(u), j = Math.floor(v);
  if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return null;
  const fu = u - i, fv = v - j, k = j * nx + i;
  const g = (n) => (quantized ? low + (grid[n] / 65535) * (high - low) : grid[n]);
  const top = g(k) + (g(k + 1) - g(k)) * fu;
  const bottom = g(k + nx) + (g(k + nx + 1) - g(k + nx)) * fu;
  return top + (bottom - top) * fv;
};

const text = readFileSync(editsPath, "utf8");
const d = JSON.parse(text);

let inside = 0, outside = 0, changed = 0;
const deltas = [], largest = [];
// 편집 파일 열쇠(고침·더함)는 저장 데이터라 한글 그대로다
for (const section of ["고침", "더함"]) {
  for (const [group, value] of Object.entries(d[section] ?? {})) {
    for (const a of Array.isArray(value) ? value : Object.values(value)) {
      if (!a || typeof a !== "object") continue;
      if (!("x" in a && "y" in a && "z" in a)) continue;
      const oldGround = sample(oldSurface, a.x, a.z, false);
      const newGround = sample(newGrid, a.x, a.z, true);
      if (oldGround === null || newGround === null) { outside++; continue; }
      inside++;
      const lift = a.y - oldGround; // 지면에서 띄운 만큼 — 이것을 지킨다
      const newY = Math.round((newGround + lift) * 1000) / 1000;
      const delta = newY - a.y;
      deltas.push(delta);
      // 5 mm 이하는 안 건드린다 — 의미 없는 차이로 파일을 어지럽히지 않는다
      if (Math.abs(delta) > 0.005) { largest.push([group, a.x, a.z, a.y, newY, delta, lift]); a.y = newY; changed++; }
    }
  }
}

const sortedAbs = deltas.map(Math.abs).sort((p, q) => p - q);
const percentile = (t) => (sortedAbs.length ? sortedAbs[Math.min(sortedAbs.length - 1, Math.floor(sortedAbs.length * t))] : 0);
console.log(`  코어 안 ${inside} 건 · 코어 밖(원경, 안 건드림) ${outside} 건`);
console.log(`  y 를 고친 것 ${changed} 건 (5 mm 넘게 움직인 것만)`);
console.log(`  이동량  중앙 ${percentile(0.5).toFixed(3)} m · 90% ${percentile(0.9).toFixed(2)} m · 최대 ${percentile(1).toFixed(2)} m`);
console.log("  가장 많이 움직인 8:");
for (const [group, x, z, before, after, delta, lift] of largest.sort((p, q) => Math.abs(q[5]) - Math.abs(p[5])).slice(0, 8))
  console.log(`    ${group.padEnd(16)} (${x.toFixed(1)}, ${z.toFixed(1)})  ${before.toFixed(2)} → ${after.toFixed(2)}  (${delta > 0 ? "+" : ""}${delta.toFixed(2)} · 띄움 ${lift.toFixed(2)} m 유지)`);

if (writeTo) {
  // 개발 서버와 똑같은 형식(들여쓰기 2, 끝 줄바꿈 없음) — 다르면 다음 편집기 저장 때 파일 전체가 diff 로 뒤집힌다
  writeFileSync(new URL(writeTo, root), JSON.stringify(d, null, 2));
  console.log(`  → ${writeTo} 에 썼다 (원본 edits.json 은 안 건드렸다)`);
} else {
  console.log("  (--write 를 안 줘서 아무것도 안 썼다)");
}
