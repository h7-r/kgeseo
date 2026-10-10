// 결과 폴더의 스크린샷을 1/4 크기 격자 한 장으로 모은다 — 한 판을 눈으로 훑어볼 때 쓴다.
//
//   node contact-sheet.mjs <결과폴더> [출력.png] [이름에 든 글자]
import fs from "node:fs";
import path from "node:path";
import utilsBundle from "playwright-core/lib/utilsBundle";

const { PNG } = utilsBundle;
const [dir, outFile = path.join(dir ?? ".", "_contact.png"), filter = ""] = process.argv.slice(2);
if (!dir) {
  console.error("사용: node contact-sheet.mjs <결과폴더> [출력.png] [이름에 든 글자]");
  process.exit(2);
}

const SCALE = 4;
const TILE_W = 1600 / SCALE;
const TILE_H = 900 / SCALE;
const COLUMNS = 4;

const files = fs
  .readdirSync(dir)
  .filter((f) => /^\d+-.*\.png$/.test(f) && f.includes(filter))
  .sort();
const sheet = new PNG({ width: TILE_W * COLUMNS, height: TILE_H * Math.ceil(files.length / COLUMNS) });
files.forEach((file, index) => {
  const src = PNG.sync.read(fs.readFileSync(path.join(dir, file)));
  const ox = (index % COLUMNS) * TILE_W;
  const oy = Math.floor(index / COLUMNS) * TILE_H;
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      const from = (y * SCALE * src.width + x * SCALE) * 4;
      const to = ((oy + y) * sheet.width + ox + x) * 4;
      src.data.copy(sheet.data, to, from, from + 4);
    }
});
fs.writeFileSync(outFile, PNG.sync.write(sheet));
console.log(`${files.length}장 → ${outFile}`);
