// 실행 중인 앱이 실제로 쓰고 있는 Leva 값 전부를 {"폴더/키": 값} 으로 뜬다.
//
//   node leva-dump.mjs <묶음 game|naju> <서버주소> <out.json> [--paths "/,/train"] [--pages 파일]
//
// 열 화면은 묶음의 suite.json leva.paths 가 정한다("{map}?leva" 처럼 페이지 이름표를 쓸 수 있다).
// 새 컨텍스트라 저장소가 빈 채로 시작하고, 첫 로드에 앱이 팀 기준값을 kgeseo.leva.v1 에 심는다.
//
// Leva 스토어는 모듈 싱글턴이다. 개발 서버가 앱에 준 /…/deps/leva.js?v=<해시> 주소를 그대로 page 안에서
// import() 하면 같은 모듈 인스턴스, 곧 같은 levaStore 가 나온다 — 게임 전역을 읽지 않고 값을 꺼내는 길.
import fs from "node:fs";
import path from "node:path";
import { goto, launch, newSession } from "./session.mjs";
import { loadSuite, option, resolvePageUrl } from "./suite.mjs";

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--paths", "--pages"]);
const [suiteName, baseArg, outFile] = args.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1]));
if (!suiteName || !baseArg || !outFile) {
  console.error('사용: node leva-dump.mjs <묶음 game|naju> <서버주소> <out.json> [--paths "/,/train"] [--pages 파일]');
  process.exit(2);
}
const base = baseArg.replace(/\/$/, "");
const suite = loadSuite(suiteName, { pages: option(args, "--pages") });
const levaConfig = suite.config.leva ?? {};
const pathsArg = option(args, "--paths", null);
const screens = (pathsArg ? pathsArg.split(",") : (levaConfig.paths ?? ["/"])).map((p) =>
  resolvePageUrl(p, suite.pages),
);
const readyTexts = levaConfig.readyText ?? {};

const LEVA_MODULE = /\/deps\/leva\.js(\?|$)/;
const SKIPPED_TYPES = new Set(["BUTTON", "BUTTON_GROUP", "MONITOR"]);

const browser = await launch();
const session = await newSession(browser);
const result = {
  meta: { url: base, paths: screens, at: new Date().toISOString() },
  values: {},
  inputs: {},
  byFolder: {},
  levaModuleUrl: null,
  localStorage: {},
};

// performance 리소스 버퍼는 250개에서 차 버리므로 네트워크 기록에서 먼저 잡는다
const levaUrls = [];
session.page.on("request", (r) => {
  if (LEVA_MODULE.test(r.url())) levaUrls.push(r.url());
});

async function readLevaStore() {
  const moduleUrl =
    levaUrls.at(-1) ??
    (await session.page.evaluate(
      (pattern) =>
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => new RegExp(pattern).test(n)) ?? null,
      LEVA_MODULE.source,
    ));
  if (!moduleUrl)
    throw new Error(
      "페이지가 불러온 leva 모듈 주소를 못 찾았다 (네트워크 기록·performance 리소스 둘 다에 /deps/leva.js 가 없음)",
    );
  result.levaModuleUrl = moduleUrl.replace(/^https?:\/\/[^/]+/, "");
  return session.page.evaluate(async (url) => {
    const { levaStore } = await import(url);
    if (!levaStore?.getData) throw new Error("levaStore.getData 가 없다");
    const plain = (value) => JSON.parse(JSON.stringify(value, (_, x) => (typeof x === "function" ? undefined : x)));
    const out = {};
    for (const [leafPath, input] of Object.entries(levaStore.getData())) {
      let value = input.value;
      if (typeof value === "function") value = "[function]";
      try {
        value = JSON.parse(JSON.stringify(value));
      } catch {
        value = String(value);
      }
      out[leafPath] = {
        type: input.type,
        value,
        label: input.label ?? null,
        settings: input.settings ? plain(input.settings) : null,
        disabled: !!input.disabled,
      };
    }
    return out;
  }, moduleUrl);
}

for (const screen of screens) {
  await goto(session, base + screen, { readyText: readyTexts[screen] ?? null, warmMs: 3000 });
  for (const [leafPath, input] of Object.entries(await readLevaStore())) {
    // leva 경로 "폴더.하위.키" → "폴더/하위/키"
    const parts = leafPath.split(".");
    const key = parts.pop();
    const folder = parts.join("/");
    const flat = folder ? `${folder}/${key}` : key;
    if (SKIPPED_TYPES.has(input.type)) {
      result.inputs[flat] = { ...input, folder, key, path: leafPath, skipped: true };
      continue;
    }
    // 여러 화면에 같은 입력이 뜨면 처음 본 값을 쓴다
    if (flat in result.values) continue;
    result.values[flat] = input.value;
    result.inputs[flat] = {
      type: input.type,
      label: input.label,
      folder,
      key,
      path: leafPath,
      settings: input.settings,
      seenAt: screen,
    };
  }
}
for (const flat of Object.keys(result.values)) {
  const folder = result.inputs[flat].folder || "(최상위)";
  result.byFolder[folder] = (result.byFolder[folder] ?? 0) + 1;
}

const stored = await session.page.evaluate(() => {
  const other = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (/leva/i.test(key) && key !== "kgeseo.leva.v1") other[key] = localStorage.getItem(key);
  }
  return { v1: localStorage.getItem("kgeseo.leva.v1"), pan: localStorage.getItem("kgeseo.leva.팀기준판"), other };
});
result.localStorage.otherLevaKeys = stored.other;
try {
  result.localStorage["kgeseo.leva.v1"] = JSON.parse(stored.v1);
} catch {
  result.localStorage["kgeseo.leva.v1"] = stored.v1;
}
result.localStorage["kgeseo.leva.팀기준판"] = stored.pan;

const v1 = result.localStorage["kgeseo.leva.v1"];
const isObject = v1 && typeof v1 === "object";
const storedValues = isObject
  ? Object.values(v1).reduce((n, x) => n + (x && typeof x === "object" ? Object.keys(x).length : 1), 0)
  : 0;
result.meta.counts = {
  values: Object.keys(result.values).length,
  folders: Object.keys(result.byFolder).length,
  skippedButtons: Object.values(result.inputs).filter((x) => x.skipped).length,
  storedFolders: v1 ? Object.keys(v1).length : 0,
  storedValues,
};
result.meta.logs = session.logs.filter((l) => l.kind === "pageerror").map((l) => l.text.slice(0, 300));
fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(result, null, 1));

const { counts } = result.meta;
console.log(
  `Leva: 값 ${counts.values}개 · 폴더 ${counts.folders}개 (버튼/모니터 ${counts.skippedButtons}개 제외) · ` +
    `저장소 kgeseo.leva.v1 폴더 ${counts.storedFolders}개/값 ${storedValues}개 · 판 ${stored.pan}`,
);
console.log(`모듈: ${result.levaModuleUrl}`);
console.log(`→ ${outFile}`);
await browser.close();
