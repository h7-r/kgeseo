/**
 * 웹사이트 크레딧(/credits) 데이터를 만든다 — 국가유산청 소품 대장 · 쓰는 오픈소스 · 글꼴.
 *
 *   node tools/website/build-credits.mjs           website/src/data/credits.generated.json 을 다시 쓴다
 *   node tools/website/build-credits.mjs --check   지금 파일이 원본과 같은지만 본다(다르면 1 로 끝남)
 *
 * 원본
 * - 국가유산청: tools/review/library-khs-ko.json(public/_sf_local/khs 경량본 대장). 퍼즐 단서가 섞인 설명 · 태그는 싣지 않고
 *   이름 · 원제 · 원본 주소만 옮긴다.
 * - 오픈소스: package.json 의 dependencies(브라우저로 나가는 게임 · 웹사이트 코드)를 package-lock.json 의 판 · 라이선스로.
 * - 글꼴: website/index.html 이 부르는 Google Fonts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "website/src/data/credits.generated.json");

const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

/** "\"A_frame_Carrier\" by KOREA HERITAGE SERVICE [KHS], CC-BY-4.0, modified" → A_frame_Carrier */
function originalTitle(credit, file) {
  const match = /^"(.+?)" by /.exec(credit);
  if (!match) throw new Error(`${file}: 출처 표기에서 원제를 못 읽었다 — ${credit}`);
  return match[1];
}

function heritageItems() {
  const { files } = readJson("tools/review/library-khs-ko.json");
  return Object.entries(files)
    .map(([file, item]) => {
      if (item.license !== "CC-BY-4.0") throw new Error(`${file}: 라이선스가 CC-BY-4.0 이 아니다 — ${item.license}`);
      if (!/^https:\/\/sketchfab\.com\/3d-models\/[0-9a-f]{32}$/.test(item.sourceUrl))
        throw new Error(`${file}: 원본 주소 모양이 다르다 — ${item.sourceUrl}`);
      return { name: item.nameKo, title: originalTitle(item.credit, file), url: item.sourceUrl };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko") || a.title.localeCompare(b.title));
}

function openSourcePackages() {
  const { dependencies } = readJson("package.json");
  const { packages } = readJson("package-lock.json");
  return Object.keys(dependencies)
    .sort()
    .map((name) => {
      const locked = packages[`node_modules/${name}`];
      if (!locked?.license) throw new Error(`${name}: package-lock.json 에 판 · 라이선스가 없다`);
      return { name, version: locked.version, license: locked.license, url: `https://www.npmjs.com/package/${name}` };
    });
}

/** Google Fonts 는 모두 SIL Open Font License 1.1 로 배포된다 */
function fonts() {
  const html = readFileSync(join(ROOT, "website/index.html"), "utf8");
  const families = new Set();
  for (const [, query] of html.matchAll(/fonts\.googleapis\.com\/css2\?([^"]+)/g))
    for (const [, family] of query.matchAll(/family=([^:&]+)/g)) families.add(family.replaceAll("+", " "));
  return [...families].sort().map((name) => ({
    name,
    license: "OFL-1.1",
    url: `https://fonts.google.com/specimen/${name.replaceAll(" ", "+")}`,
  }));
}

export function buildCredits() {
  return { heritage: heritageItems(), openSource: openSourcePackages(), fonts: fonts() };
}

export const serialize = (credits) => `${JSON.stringify(credits, null, 2)}\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const next = serialize(buildCredits());
  if (process.argv.includes("--check")) {
    const current = readFileSync(OUT, "utf8");
    if (current !== next) {
      console.error(
        "website/src/data/credits.generated.json 이 원본과 다르다 — node tools/website/build-credits.mjs 로 다시 만든다",
      );
      process.exit(1);
    }
    console.log("크레딧 데이터: 원본과 같다");
  } else {
    writeFileSync(OUT, next);
    console.log(`크레딧 데이터를 썼다 — ${OUT}`);
  }
}
