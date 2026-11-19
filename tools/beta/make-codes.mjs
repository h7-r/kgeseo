// 베타 참여 코드 · 개인 링크 만들기 — node tools/beta/make-codes.mjs <개수> <출력.csv> [게임 주소]
// 코드는 헷갈리는 글자(0 · O · 1 · I · L)를 뺀 8자(4-4). 이름 · 연락처는 넣지 않는다 — 배정표(누구에게 어떤 코드)는 운영자가 따로 관리한다.
import { randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const [countArg, out, gameUrl = "https://play.k-escape.com/"] = process.argv.slice(2);
const count = Number(countArg);
if (!Number.isInteger(count) || count < 1 || count > 5000 || !out) {
  console.error("사용법: node tools/beta/make-codes.mjs <개수 1~5000> <출력.csv> [게임 주소]");
  process.exit(1);
}

const pick = (n) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const codes = new Set();
while (codes.size < count) codes.add(`${pick(4)}-${pick(4)}`);

const base = new URL(gameUrl);
const rows = ["순번,참여 코드,개인 링크"];
let index = 0;
for (const code of codes) {
  index += 1;
  const link = new URL(base);
  link.searchParams.set("pc", code);
  rows.push(`${index},${code},${link.toString()}`);
}
// 엑셀이 한글을 바로 읽게 BOM 을 붙인다
writeFileSync(out, `\uFEFF${rows.join("\n")}\n`, "utf8");
console.log(`${count}개 → ${out}`);
