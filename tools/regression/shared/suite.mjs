// 검사 묶음(game · naju)의 설정을 읽는다. 묶음 폴더마다 suite.json 하나가 경로·페이지 이름표·Leva 화면을 정한다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REGRESSION_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/**
 * @param {string} name 묶음 이름(tools/regression/<name>)
 * @param {{ route?: string, pages?: string }} overrides 리팩터로 파일 이름이 바뀌었을 때 다른 경로·이름표를 끼운다
 */
export function loadSuite(name, overrides = {}) {
  const dir = path.join(REGRESSION_DIR, name ?? "");
  const configFile = path.join(dir, "suite.json");
  if (!name || !fs.existsSync(configFile)) {
    const known = fs
      .readdirSync(REGRESSION_DIR)
      .filter((d) => fs.existsSync(path.join(REGRESSION_DIR, d, "suite.json")));
    throw new Error(`검사 묶음 ${JSON.stringify(name)} 이 없다. 있는 것: ${known.join(", ")}`);
  }
  const config = readJson(configFile);
  const routeFile = overrides.route ?? path.join(dir, config.route ?? "route.json");
  const pagesFile = overrides.pages ?? (config.pages ? path.join(dir, config.pages) : null);
  return {
    name,
    dir,
    config,
    routeFile,
    route: readJson(routeFile),
    pages: pagesFile ? readJson(pagesFile) : {},
  };
}

/** "{map}?leva" 꼴 이름표 주소를 실제 주소로 바꾼다. */
export function resolvePageUrl(address, pages) {
  return address.replace(/^\{(\w+)\}/, (_, page) => {
    if (!(page in pages)) throw new Error(`페이지 이름표 ${page} 가 pages.json 에 없다`);
    return pages[page];
  });
}

/** 명령줄에서 `--name 값` 을 읽는다. */
export function option(args, name, fallback) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
}
